import * as path from "node:path";
import { getRealFs } from "@vestra/injector";
import {
  layoutHome,
  loadRegistry,
  toErrorCode,
  withInstallLock,
  type DiscordInstallation,
  type InstallerService,
  type OperationSummary,
} from "@vestra/installer";
import type { DiscordChannel } from "../../shared/channels.js";
import { DiscordLifecycle } from "../discordLifecycle.js";
import { readMaintenance, type MaintenanceConfig } from "../maintenance.js";
import {
  readRecoveryState,
  writeRecoveryState,
  type ChannelRecovery,
  type RecoveryPhase,
} from "./state.js";

export type RecoveryTrigger = "sweep" | "staged" | "asar-changed";
/** Follow-ups: after Discord exited (no settle needed) or after a backoff. */
type Step = RecoveryTrigger | "exit" | "retry";

export const SETTLE_MS = 1000;
export const STABLE_MS = 3000;
export const POLL_MS = 5000;
export const BACKOFF_MS = [60_000, 300_000, 1_800_000] as const;
export const MAX_ATTEMPTS = 3;
/** Recorded when the process lookup or the post-patch check itself failed. */
export const PROCESS_CHECK_FAILED = "process-check-failed";

export interface RecoveryDeps {
  service: InstallerService;
  /** PIDs of the channel exe under target.appDir (CIM query via systemTool). */
  processesFor(target: DiscordInstallation): Promise<number[]>;
  /** process.kill(pid, 0) wrapper. */
  isAlive(pid: number): boolean;
  /** Repair without stopping Discord, under withInstallLock. */
  patch(channel: DiscordChannel): Promise<void>;
  /** Called once per (channel, version) when a running version waits for exit. */
  notify(channel: DiscordChannel, version: string): void;
  /** Called once per (channel, archive) when recovery records `failed`. */
  notifyFailed?(channel: DiscordChannel, version: string): void;
  /** Every recorded phase, so notifications can be released when stale. */
  onPhase?(
    channel: DiscordChannel,
    phase: RecoveryPhase,
    version: string | undefined,
  ): void;
  now(): number;
  wait(ms: number): Promise<void>;
  /** Failures of background follow-ups, which have no caller to throw to. */
  onError?(error: unknown): void;
}

interface Task {
  cancelled: boolean;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Discord holds its running archive open: the atomic rename cannot replace it. */
export function isInUse(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code === "EBUSY" ||
    code === "EPERM" ||
    /being used by another process/i.test(errorMessage(error))
  );
}

/** Another operation owns the install lock, or recovery was turned off meanwhile. */
function isDeferred(error: unknown): boolean {
  return (
    errorCode(error) === "ECANCELED" ||
    /Another installation operation/i.test(errorMessage(error))
  );
}

/** Short code for the state file; messages can carry paths. */
export function reasonCode(error: unknown): string {
  const code = errorCode(error);
  // Errno codes (EBUSY) and installer codes (invalid-asar) are both path-free.
  if (
    typeof code === "string" &&
    /^(?:E[A-Z0-9]{2,15}|[a-z]+(?:-[a-z]+){0,3})$/.test(code)
  )
    return code;
  return toErrorCode(errorMessage(error));
}

/**
 * Turns a failed repair summary into an error the monitor can classify. The
 * installer reports `Inject failed for <path>: EBUSY: …`; the errno code is
 * kept and the path is dropped.
 */
export function repairFailure(summary: OperationSummary): Error {
  const detail = summary.results.find((item) => !item.ok)?.detail ?? "";
  const code = /being used by another process/i.test(detail)
    ? "EBUSY"
    : (/\b(E[A-Z0-9]{2,15}):/.exec(detail)?.[1] ?? toErrorCode(detail));
  return Object.assign(new Error(`Automatic repair failed (${code}).`), {
    code,
  });
}

export function versionOf(target: DiscordInstallation): string {
  return target.version ?? path.basename(target.appDir).replace(/^app-/i, "");
}

function isActive(config: MaintenanceConfig): boolean {
  return config.enabled && config.channels.length > 0;
}

/**
 * Patch-ahead recovery: a new Discord version is patched while it is not
 * running, so it starts with Vestra. A running version is never touched; it is
 * patched once its processes are gone, or when the user clicks Restart Discord.
 */
export class RecoveryMonitor {
  private readonly lifecycle: Pick<DiscordLifecycle, "run">;
  private readonly tasks = new Map<DiscordChannel, Task>();
  private readonly running = new Set<Promise<void>>();
  private readonly notified = new Set<string>();
  private readonly notifiedFailures = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: RecoveryDeps,
    lifecycle?: Pick<DiscordLifecycle, "run">,
  ) {
    this.lifecycle = lifecycle ?? new DiscordLifecycle(deps.service);
  }

  private get home(): string {
    return this.deps.service.context.homeDir;
  }

  /** Tracked installations: opted-in channels, scoped to their recorded root. */
  async targets(config: MaintenanceConfig): Promise<DiscordInstallation[]> {
    if (!isActive(config)) return [];
    const records = Object.values(
      await loadRegistry(layoutHome(this.home).registryPath),
    );
    return (
      await this.deps.service.discover({ channels: config.channels })
    ).filter(
      (target) =>
        config.channels.includes(target.channel) &&
        records.some(
          (record) =>
            record.channel === target.channel &&
            typeof record.rootDir === "string" &&
            record.rootDir.toLowerCase() === target.rootDir.toLowerCase(),
        ),
    );
  }

  evaluate(config: MaintenanceConfig, trigger: RecoveryTrigger): Promise<void> {
    if (!isActive(config)) return Promise.resolve();
    return this.exclusive(async () => {
      const errors: unknown[] = [];
      for (const target of await this.targets(config)) {
        try {
          await this.consider(target, trigger);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw errors[0];
    });
  }

  /** The user's click: stop Discord, repair, verify, reopen if it was open. */
  async restartAndRepair(channel: DiscordChannel): Promise<void> {
    await this.exclusive(() =>
      withInstallLock(this.home, async () => {
        // Only once the lock is ours: a refused click keeps the waiter.
        const task = this.tasks.get(channel);
        if (task) {
          task.cancelled = true;
          this.tasks.delete(channel);
        }
        const previous = (await readRecoveryState(this.home))[channel];
        const target = (
          await this.deps.service.discover({ channels: [channel] })
        )[0];
        const version = target ? versionOf(target) : previous?.version;
        const fail = async (detail: string): Promise<void> => {
          // Keep the archive's attempt budget: a click never resets the cap.
          const signature =
            (target ? await this.signature(target) : null) ??
            previous?.signature;
          await this.record(channel, {
            phase: "failed",
            ...(version === undefined ? {} : { version }),
            at: this.deps.now(),
            attempts: previous?.attempts ?? 0,
            detail,
            ...(signature === undefined ? {} : { signature }),
          });
        };
        try {
          const result = await this.lifecycle.run("repair", channel);
          if (!result.ok) {
            const detail = result.results.find((item) => !item.ok)?.detail;
            await fail(toErrorCode(detail));
            return;
          }
        } catch (error) {
          await fail(reasonCode(error));
          throw error;
        }
        await this.record(channel, {
          phase: "patched",
          ...(version === undefined ? {} : { version }),
          at: this.deps.now(),
          attempts: 0,
        });
      }),
    );
  }

  /** Resolves once queued evaluations and background follow-ups have finished. */
  async settled(): Promise<void> {
    for (;;) {
      await this.chain;
      if (this.running.size === 0) return;
      await Promise.all(this.running);
    }
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private async consider(
    target: DiscordInstallation,
    step: Step,
  ): Promise<void> {
    const { channel } = target;
    // A waiter or backoff already owns this channel.
    if (this.tasks.has(channel)) return;
    const version = versionOf(target);
    if (this.installing(target, version)) return;
    const signature = await this.ready(target, step);
    if (signature === null || this.installing(target, version)) return;
    const previous = (await readRecoveryState(this.home))[channel];
    if (await this.healthy(target)) {
      const settled =
        previous?.version === version &&
        previous.attempts === 0 &&
        (previous.phase === "idle" || previous.phase === "patched");
      if (!settled)
        await this.record(channel, {
          phase: "idle",
          version,
          at: this.deps.now(),
          attempts: 0,
        });
      return;
    }
    const attempts =
      previous?.signature === signature ? previous.attempts : 0;
    if (attempts >= MAX_ATTEMPTS) return;
    if (attempts > 0 && previous) {
      const due = previous.at + BACKOFF_MS[attempts - 1]!;
      const remaining = due - this.deps.now();
      if (remaining > 0) {
        this.schedule(channel, "retry", () => this.deps.wait(remaining));
        return;
      }
    }
    const pids = await this.processes(target);
    if (pids === null) {
      await this.failedAttempt(target, version, signature, attempts, PROCESS_CHECK_FAILED);
      return;
    }
    if (pids.length > 0) {
      await this.waitForExit(target, version, signature, attempts, pids);
      return;
    }
    await this.patch(target, version, signature, attempts);
  }

  /** Running PIDs, or null when the lookup failed (reported, then counted). */
  private async processes(target: DiscordInstallation): Promise<number[] | null> {
    try {
      return await this.deps.processesFor(target);
    } catch (error) {
      this.deps.onError?.(error);
      return null;
    }
  }

  private async patch(
    target: DiscordInstallation,
    version: string,
    signature: string,
    attempts: number,
  ): Promise<void> {
    const { channel } = target;
    try {
      await this.deps.patch(channel);
    } catch (error) {
      if (isDeferred(error)) return;
      // A failed repair can still rewrite the archive (restoring its backup);
      // the attempts stay with what is on disk now, or the cap would reset.
      const current = (await this.signature(target)) ?? signature;
      if (isInUse(error)) {
        // Discord started meanwhile: wait for it, without spending an attempt.
        const pids = await this.processes(target);
        if (pids === null) {
          await this.failedAttempt(target, version, current, attempts, PROCESS_CHECK_FAILED);
          return;
        }
        if (pids.length > 0) {
          await this.waitForExit(target, version, current, attempts, pids);
          return;
        }
        // Locked with no Discord running (scanner, another tool): capped.
        await this.failedAttempt(target, version, current, attempts, "blocked");
        return;
      }
      await this.failedAttempt(
        target,
        version,
        current,
        attempts,
        reasonCode(error),
      );
      return;
    }
    // A repair that reports success must also verify; otherwise it counts.
    let verified: boolean;
    try {
      verified = await this.healthy(target);
    } catch (error) {
      this.deps.onError?.(error);
      const current = (await this.signature(target)) ?? signature;
      await this.failedAttempt(target, version, current, attempts, PROCESS_CHECK_FAILED);
      return;
    }
    if (!verified) {
      const current = (await this.signature(target)) ?? signature;
      await this.failedAttempt(
        target,
        version,
        current,
        attempts,
        "verification-failed",
      );
      return;
    }
    await this.record(channel, {
      phase: "patched",
      version,
      at: this.deps.now(),
      attempts: 0,
    });
  }

  /** Spends one attempt: back off while retries remain, else record `failed`. */
  private async failedAttempt(
    target: DiscordInstallation,
    version: string,
    signature: string,
    attempts: number,
    detail: string,
  ): Promise<void> {
    const { channel } = target;
    const next = attempts + 1;
    const failed = next >= MAX_ATTEMPTS;
    await this.record(channel, {
      phase: failed ? "failed" : "idle",
      version,
      at: this.deps.now(),
      attempts: next,
      detail,
      signature,
    });
    if (!failed)
      this.schedule(channel, "retry", () =>
        this.deps.wait(BACKOFF_MS[next - 1]!),
      );
  }

  private async waitForExit(
    target: DiscordInstallation,
    version: string,
    signature: string,
    attempts: number,
    pids: number[],
  ): Promise<void> {
    const { channel } = target;
    await this.record(channel, {
      phase: "waiting-for-exit",
      version,
      at: this.deps.now(),
      attempts,
      signature,
    });
    const key = `${channel}:${version}`;
    if (!this.notified.has(key)) {
      this.notified.add(key);
      try {
        this.deps.notify(channel, version);
      } catch (error) {
        this.deps.onError?.(error);
      }
    }
    this.schedule(channel, "exit", async (task) => {
      while (!task.cancelled && pids.some((pid) => this.deps.isAlive(pid)))
        await this.deps.wait(POLL_MS);
    });
  }

  /** Runs `body` in the background, then re-evaluates the channel. */
  private schedule(
    channel: DiscordChannel,
    step: Step,
    body: (task: Task) => Promise<void>,
  ): void {
    const task: Task = { cancelled: false };
    this.tasks.set(channel, task);
    const done = (async () => {
      try {
        await body(task);
        if (task.cancelled) return;
        if (this.tasks.get(channel) === task) this.tasks.delete(channel);
        const config = await readMaintenance(this.home);
        await this.exclusive(async () => {
          if (task.cancelled || this.tasks.has(channel)) return;
          const target = (await this.targets(config)).find(
            (candidate) => candidate.channel === channel,
          );
          if (target) await this.consider(target, step);
        });
      } catch (error) {
        this.deps.onError?.(error);
      } finally {
        if (this.tasks.get(channel) === task) this.tasks.delete(channel);
      }
    })();
    this.running.add(done);
    void done.finally(() => this.running.delete(done));
  }

  private installing(target: DiscordInstallation, version: string): boolean {
    return getRealFs().existsSync(
      path.join(target.rootDir, `.app-${version}.installing`),
    );
  }

  /** Sweeps need two equal reads 3 s apart; a finished rename only settles 1 s. */
  private async ready(
    target: DiscordInstallation,
    step: Step,
  ): Promise<string | null> {
    const first = await this.signature(target);
    if (first === null || step === "exit") return first;
    if (step === "staged") {
      await this.deps.wait(SETTLE_MS);
      return this.signature(target);
    }
    await this.deps.wait(STABLE_MS);
    const second = await this.signature(target);
    return second === first ? second : null;
  }

  private async signature(target: DiscordInstallation): Promise<string | null> {
    try {
      const stat = await getRealFs().promises.stat(target.asarPath);
      if (!stat.isFile()) return null;
      return `${path.basename(target.appDir)}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
  }

  private async healthy(target: DiscordInstallation): Promise<boolean> {
    const summary = await this.deps.service.check({
      channels: [target.channel],
    });
    return summary.statuses.some(
      (status) =>
        status.installation.asarPath.toLowerCase() ===
          target.asarPath.toLowerCase() && status.health === "healthy",
    );
  }

  private async record(
    channel: DiscordChannel,
    entry: ChannelRecovery,
  ): Promise<void> {
    const state = await readRecoveryState(this.home);
    state[channel] = entry;
    await writeRecoveryState(this.home, state);
    this.observe(() => this.deps.onPhase?.(channel, entry.phase, entry.version));
    if (entry.phase !== "failed") return;
    const key = `${channel}:${entry.signature ?? entry.version ?? ""}`;
    if (this.notifiedFailures.has(key)) return;
    this.notifiedFailures.add(key);
    this.observe(() =>
      this.deps.notifyFailed?.(channel, entry.version ?? ""),
    );
  }

  /** Observers (notifications) never break recovery. */
  private observe(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.deps.onError?.(error);
    }
  }
}
