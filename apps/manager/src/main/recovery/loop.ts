import type { DiscordInstallation } from "@vestra/installer";
import type { MaintenanceConfig } from "../maintenance.js";
import type { RecoveryTrigger } from "./monitor.js";
import type { WatchKind } from "./watch.js";

export const SWEEP_MS = 600_000;
export const ASAR_DEBOUNCE_MS = 5_000;
const TRIGGER_RANK: Record<RecoveryTrigger, number> = {
  staged: 0,
  "asar-changed": 1,
  sweep: 2,
};

export interface RecoveryLoopDeps {
  readConfig(): Promise<MaintenanceConfig>;
  evaluate(config: MaintenanceConfig, trigger: RecoveryTrigger): Promise<void>;
  targets(config: MaintenanceConfig): Promise<DiscordInstallation[]>;
  watch(
    targets: DiscordInstallation[],
    onEvent: (root: string, kind: WatchKind) => void,
  ): () => void;
  /** True when the configured runtime is not this executable. */
  isOtherRuntime(runtime: string): boolean;
  /** Releases this process's instance lock and starts `runtime`; rejects on failure. */
  handoff(runtime: string): Promise<void>;
  /** Takes the instance lock back after a failed handoff; false when lost. */
  reacquire(): boolean;
  quit(): void;
  log(error: unknown): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface RecoveryLoop {
  run(trigger: RecoveryTrigger): Promise<void>;
  stop(): void;
}

/**
 * Evaluates on start, on watcher events (staged at once, archive changes
 * debounced 5 s) and every 10 min. One run at a time; a burst collapses into
 * one queued run. Watchers are rebuilt after each sweep and staged run.
 */
export function createRecoveryLoop(deps: RecoveryLoopDeps): RecoveryLoop {
  let stopWatching = (): void => {};
  let stopped = false;
  let busy = false;
  let handoffFailed = false;
  let queued: RecoveryTrigger | undefined;
  let debounce: unknown;
  let current: Promise<void> = Promise.resolve();

  const stop = (): void => {
    stopped = true;
    stopWatching();
    if (debounce !== undefined) deps.clearTimeout(debounce);
    deps.clearInterval(sweepTimer);
  };
  const finish = (): void => {
    stop();
    deps.quit();
  };
  const onEvent = (_root: string, kind: WatchKind): void => {
    // Discord's own completion signal: act at once (the monitor settles 1 s).
    if (kind === "staged") {
      void run("staged");
      return;
    }
    if (debounce !== undefined) deps.clearTimeout(debounce);
    debounce = deps.setTimeout(() => {
      debounce = undefined;
      void run("asar-changed");
    }, ASAR_DEBOUNCE_MS);
  };

  const once = async (trigger: RecoveryTrigger): Promise<void> => {
    const config = await deps.readConfig();
    if (!config.enabled || config.channels.length === 0) {
      finish();
      return;
    }
    if (config.runtime && !handoffFailed && deps.isOtherRuntime(config.runtime)) {
      try {
        await deps.handoff(config.runtime);
        finish();
        return;
      } catch (error) {
        // Keep recovering here rather than leaving a process with no loop.
        deps.log(error);
        handoffFailed = true;
        if (!deps.reacquire()) {
          finish();
          return;
        }
      }
    }
    try {
      await deps.evaluate(config, trigger);
    } catch (error) {
      deps.log(error);
    }
    // Version folders come and go; follow the current ones.
    if (trigger !== "asar-changed" && !stopped) {
      const targets = await deps.targets(config);
      stopWatching();
      stopWatching = deps.watch(targets, onEvent);
    }
  };

  const run = (trigger: RecoveryTrigger): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (busy) {
      if (!queued || TRIGGER_RANK[trigger] > TRIGGER_RANK[queued])
        queued = trigger;
      return current;
    }
    busy = true;
    current = (async () => {
      try {
        await once(trigger);
      } catch (error) {
        deps.log(error);
      } finally {
        busy = false;
        const next = queued;
        queued = undefined;
        if (next) void run(next);
      }
    })();
    return current;
  };

  const sweepTimer = deps.setInterval(() => void run("sweep"), SWEEP_MS);
  return { run, stop };
}
