import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { DiscordInstallation, InstallerService } from "@vestra/installer";
import {
  RecoveryMonitor,
  isInUse,
  reasonCode,
  repairFailure,
} from "../src/main/recovery/monitor.js";
import {
  readRecoveryState,
  writeRecoveryState,
} from "../src/main/recovery/state.js";
import {
  classifyResourcesEvent,
  classifyRootEvent,
  watchRoots,
} from "../src/main/recovery/watch.js";
import {
  processesUnder,
  type DiscordSystem,
} from "../src/main/discordLifecycle.js";
import type { DiscordChannel } from "../src/shared/channels.js";
import { withInstallLock } from "@vestra/installer";
import { createRecoveryLoop } from "../src/main/recovery/loop.js";
import {
  RecoveryNotices,
  type NoticeContent,
} from "../src/main/recovery/notices.js";

const VERSION = "1.0.9";
const enabled = { enabled: true, channels: ["stable" as DiscordChannel] };

interface Options {
  registryRoot?: string | null;
}

async function harness(options: Options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-recovery-test-"));
  const home = path.join(base, "home");
  const rootDir = path.join(base, "Discord");
  const appDir = path.join(rootDir, `app-${VERSION}`);
  const asarPath = path.join(appDir, "resources", "app.asar");
  await fs.mkdir(path.dirname(asarPath), { recursive: true });
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(asarPath, "unpatched");
  await fs.writeFile(path.join(home, "maintenance.json"), JSON.stringify(enabled));
  const registryRoot =
    options.registryRoot === undefined ? rootDir : options.registryRoot;
  await fs.writeFile(
    path.join(home, "installs.json"),
    JSON.stringify(
      registryRoot === null
        ? {}
        : {
            old: {
              asarPath: path.join(rootDir, "app-1.0.8", "resources", "app.asar"),
              rootDir: registryRoot,
              channel: "stable",
              payloadVersion: "1",
            },
          },
    ),
  );
  const target: DiscordInstallation = {
    channel: "stable",
    version: VERSION,
    rootDir,
    appDir,
    asarPath,
    isActive: true,
  };
  const h = {
    base,
    home,
    rootDir,
    target,
    time: 0,
    healthy: false,
    pids: [] as number[],
    alive: new Set<number>(),
    waits: [] as number[],
    gate: undefined as Promise<void> | undefined,
    onWait: undefined as ((ms: number) => Promise<void> | void) | undefined,
    patchError: undefined as (() => Error) | undefined,
    onPatch: undefined as (() => Promise<void>) | undefined,
    attemptsSeen: [] as number[],
    phasesSeen: [] as string[],
    /** Per-call answers for processesFor; falls back to `pids` when empty. */
    pidsSequence: [] as number[][],
    healAfterPatch: true,
    processesError: undefined as (() => Error) | undefined,
    /** Throws from the health check that follows a patch. */
    checkErrorAfterPatch: undefined as (() => Error) | undefined,
    lifecycleResult: { ok: true, results: [] } as {
      ok: boolean;
      results: Array<{ ok: boolean; detail?: string }>;
    },
    failures: [] as string[],
    phases: [] as string[],
    calls: { discover: 0, check: 0, patch: 0, processes: 0, lifecycle: 0 },
    notified: [] as string[],
  };
  const service = {
    context: { homeDir: home },
    async discover(args?: { channels?: DiscordChannel[] }) {
      h.calls.discover++;
      return (args?.channels ?? ["stable"]).includes("stable") ? [target] : [];
    },
    async check() {
      h.calls.check++;
      if (h.calls.patch > 0 && h.checkErrorAfterPatch) throw h.checkErrorAfterPatch();
      return {
        statuses: [
          {
            installation: target,
            health: h.healthy ? "healthy" : "not-installed",
            vestraInstalled: h.healthy,
            repairable: !h.healthy,
          },
        ],
        stale: [],
      };
    },
  } as unknown as InstallerService;
  const lifecycle = {
    async run() {
      h.calls.lifecycle++;
      if (h.lifecycleResult.ok) h.healthy = true;
      return h.lifecycleResult as never;
    },
  };
  const monitor = new RecoveryMonitor(
    {
      service,
      async processesFor() {
        h.calls.processes++;
        if (h.processesError) throw h.processesError();
        return [...(h.pidsSequence.shift() ?? h.pids)];
      },
      isAlive: (pid) => h.alive.has(pid),
      async patch() {
        h.calls.patch++;
        const before = (await readRecoveryState(home)).stable;
        h.attemptsSeen.push(before?.attempts ?? 0);
        h.phasesSeen.push(`${before?.phase ?? "none"}/${before?.detail ?? ""}`);
        await h.onPatch?.();
        if (h.patchError) throw h.patchError();
        if (h.healAfterPatch) h.healthy = true;
      },
      notify: (channel, version) => h.notified.push(`${channel}:${version}`),
      notifyFailed: (channel, version) => h.failures.push(`${channel}:${version}`),
      onPhase: (channel, phase) => h.phases.push(`${channel}:${phase}`),
      now: () => h.time,
      async wait(ms) {
        h.waits.push(ms);
        h.time += ms;
        await h.onWait?.(ms);
      },
    },
    lifecycle,
  );
  return {
    h,
    monitor,
    async cleanup() {
      await fs.rm(base, { recursive: true, force: true });
    },
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

test("a version staged while the old one runs is patched ahead, without a restart", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    await monitor.evaluate(enabled, "staged");
    await monitor.settled();
    assert.equal(h.calls.patch, 1);
    assert.equal(h.calls.lifecycle, 0);
    assert.ok(h.waits.includes(1000), "staged folders settle for 1 s");
    assert.deepEqual(h.notified, []);
    const state = await readRecoveryState(h.home);
    assert.equal(state.stable?.phase, "patched");
    assert.equal(state.stable?.version, VERSION);
    assert.equal(state.stable?.attempts, 0);
  } finally {
    await cleanup();
  }
});

test("a sweep patches only an archive that is stable across two reads 3 s apart", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.onWait = async (ms) => {
      if (ms === 3000) await fs.writeFile(h.target.asarPath, "still writing");
    };
    await monitor.evaluate(enabled, "sweep");
    await monitor.settled();
    assert.deepEqual(h.waits, [3000]);
    assert.equal(h.calls.patch, 0, "a changing archive is not ready");
    h.onWait = undefined;
    await monitor.evaluate(enabled, "sweep");
    await monitor.settled();
    assert.equal(h.calls.patch, 1);
  } finally {
    await cleanup();
  }
});

test("a healthy installation is left alone and recorded as idle", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.healthy = true;
    await monitor.evaluate(enabled, "staged");
    assert.equal(h.calls.patch, 0);
    assert.equal(h.calls.processes, 0);
    assert.equal((await readRecoveryState(h.home)).stable?.phase, "idle");
  } finally {
    await cleanup();
  }
});

test("a running unpatched version waits for exit, notifies once and patches when Discord closes", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.pids = [11, 12];
    h.alive = new Set([11, 12]);
    let poll = deferred();
    h.onWait = (ms) => (ms === 5000 ? poll.promise : undefined);
    await monitor.evaluate(enabled, "staged");
    await monitor.evaluate(enabled, "staged");
    await monitor.evaluate(enabled, "sweep");
    assert.deepEqual(h.notified, [`stable:${VERSION}`]);
    assert.equal(h.calls.patch, 0, "a running version is never patched");
    assert.equal(h.calls.processes, 1, "the CIM query runs once");
    assert.equal((await readRecoveryState(h.home)).stable?.phase, "waiting-for-exit");
    // One poll while Discord is still open.
    const first = poll;
    poll = deferred();
    first.release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(h.calls.patch, 0);
    h.alive.delete(11);
    h.alive.delete(12);
    h.pids = [];
    poll.release();
    await monitor.settled();
    assert.equal(h.calls.patch, 1);
    assert.equal(h.calls.lifecycle, 0);
    assert.ok(h.waits.filter((ms) => ms === 5000).length >= 2);
    assert.deepEqual(h.notified, [`stable:${VERSION}`]);
    assert.equal((await readRecoveryState(h.home)).stable?.phase, "patched");
  } finally {
    await cleanup();
  }
});

test("in-use failures while Discord runs never count toward the retry cap", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    const errors = [
      () => Object.assign(new Error("busy"), { code: "EBUSY" }),
      () => Object.assign(new Error("denied"), { code: "EPERM" }),
      () => new Error("The process cannot access the file because it is being used by another process."),
      () => Object.assign(new Error("busy"), { code: "EBUSY" }),
      () => Object.assign(new Error("busy"), { code: "EBUSY" }),
    ];
    // Each time: no Discord at first, the patch hits the lock, Discord is found, then exits.
    h.pidsSequence = errors.flatMap(() => [[], [7]]);
    h.onPatch = async () => {
      h.patchError = errors[h.calls.patch - 1];
    };
    await monitor.evaluate(enabled, "staged");
    await monitor.settled();
    assert.equal(h.calls.patch, 6, "five in-use failures, then success");
    assert.deepEqual(h.attemptsSeen, [0, 0, 0, 0, 0, 0]);
    assert.ok(h.phasesSeen.slice(1).every((seen) => seen.startsWith("waiting-for-exit/")));
    assert.deepEqual(h.notified, [`stable:${VERSION}`], "one notice per version");
    assert.deepEqual(h.failures, []);
    const state = await readRecoveryState(h.home);
    assert.equal(state.stable?.phase, "patched");
  } finally {
    await cleanup();
  }
});

test("an in-use failure with no Discord running is blocked and capped", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.patchError = () => Object.assign(new Error("busy"), { code: "EBUSY" });
    await monitor.evaluate(enabled, "staged");
    await monitor.settled();
    assert.equal(h.calls.patch, 3);
    assert.deepEqual(h.attemptsSeen, [0, 1, 2]);
    assert.deepEqual(h.phasesSeen.slice(1), ["idle/blocked", "idle/blocked"]);
    const state = await readRecoveryState(h.home);
    assert.equal(state.stable?.phase, "failed");
    assert.equal(state.stable?.detail, "blocked");
    assert.equal(state.stable?.attempts, 3);
    assert.deepEqual(h.notified, [], "nothing to restart");
    assert.deepEqual(h.failures, [`stable:${VERSION}`]);
    await monitor.evaluate(enabled, "sweep");
    await monitor.settled();
    assert.equal(h.calls.patch, 3);
  } finally {
    await cleanup();
  }
});

test("a failing process check is recorded as a capped failed attempt", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.processesError = () => new Error("CIM query failed for C:\\Fixture");
    await monitor.evaluate(enabled, "staged");
    let state = await readRecoveryState(h.home);
    assert.equal(state.stable?.phase, "idle");
    assert.equal(state.stable?.detail, "process-check-failed");
    assert.equal(state.stable?.attempts, 1);
    await monitor.settled();
    state = await readRecoveryState(h.home);
    assert.equal(state.stable?.phase, "failed");
    assert.equal(state.stable?.detail, "process-check-failed");
    assert.equal(state.stable?.attempts, 3);
    assert.equal(h.calls.processes, 3);
    assert.equal(h.calls.patch, 0, "never patches without knowing Discord is closed");
    assert.deepEqual(h.failures, [`stable:${VERSION}`]);
    await monitor.evaluate(enabled, "sweep");
    await monitor.settled();
    assert.equal(h.calls.processes, 3, "capped: no more checks for this archive");
  } finally {
    await cleanup();
  }
});

test("an in-use failure whose process check fails is a failed attempt, not a throw", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.pidsSequence = [[]];
    h.patchError = () => Object.assign(new Error("busy"), { code: "EBUSY" });
    h.onPatch = async () => {
      h.processesError = () => new Error("CIM query failed");
    };
    await monitor.evaluate(enabled, "staged");
    const state = await readRecoveryState(h.home);
    assert.equal(state.stable?.detail, "process-check-failed");
    assert.equal(state.stable?.attempts, 1);
  } finally {
    await cleanup();
  }
});

test("a throwing health check after a patch is a failed attempt", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.checkErrorAfterPatch = () => new Error("check backend down");
    await monitor.evaluate(enabled, "staged");
    const state = await readRecoveryState(h.home);
    assert.equal(state.stable?.phase, "idle");
    assert.equal(state.stable?.detail, "process-check-failed");
    assert.equal(state.stable?.attempts, 1);
  } finally {
    await cleanup();
  }
});

test("a patch that reports success but does not verify counts as a failed attempt", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.healAfterPatch = false;
    await monitor.evaluate(enabled, "staged");
    await monitor.settled();
    assert.equal(h.calls.patch, 3);
    assert.deepEqual(h.attemptsSeen, [0, 1, 2]);
    const state = await readRecoveryState(h.home);
    assert.equal(state.stable?.phase, "failed");
    assert.equal(state.stable?.detail, "verification-failed");
    assert.deepEqual(h.failures, [`stable:${VERSION}`]);
  } finally {
    await cleanup();
  }
});

test("other failures back off 1 min then 5 min and stop after three attempts", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.patchError = () => new Error("Inject failed for C:\\Fixture\\app.asar: boom");
    await monitor.evaluate(enabled, "staged");
    await monitor.settled();
    assert.equal(h.calls.patch, 3);
    assert.deepEqual(h.attemptsSeen, [0, 1, 2]);
    assert.ok(h.waits.includes(60000));
    assert.ok(h.waits.includes(300000));
    const state = await readRecoveryState(h.home);
    assert.equal(state.stable?.phase, "failed");
    assert.equal(state.stable?.attempts, 3);
    assert.ok(state.stable?.detail);
    assert.doesNotMatch(state.stable!.detail!, /[\\/:]/, "reason codes only");
    assert.deepEqual(h.failures, [`stable:${VERSION}`], "one failure notice");
    await monitor.evaluate(enabled, "sweep");
    await monitor.evaluate(enabled, "staged");
    await monitor.settled();
    assert.equal(h.calls.patch, 3, "no fourth attempt for the same archive");
    assert.deepEqual(h.failures, [`stable:${VERSION}`], "no repeat failure notice");
  } finally {
    await cleanup();
  }
});

test("a failed repair that rewrites the archive still stops after three attempts", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    let restores = 0;
    h.patchError = () => new Error("boom");
    // The installer restores the backup on failure: new size and mtime each time.
    h.onPatch = async () => {
      restores++;
      await fs.writeFile(h.target.asarPath, "restored".repeat(restores));
    };
    await monitor.evaluate(enabled, "staged");
    await monitor.settled();
    await monitor.evaluate(enabled, "sweep");
    await monitor.settled();
    assert.equal(h.calls.patch, 3);
    assert.equal((await readRecoveryState(h.home)).stable?.phase, "failed");
  } finally {
    await cleanup();
  }
});

test("failed repair summaries keep the errno code and drop paths", () => {
  const summary = (detail: string) => ({
    ok: false,
    results: [
      { asarPath: "x", channel: "stable" as const, ok: false, action: "failed" as const, detail },
    ],
  });
  const busy = repairFailure(
    summary(
      "Inject failed for C:\\Fixture\\Discord\\app-1.0.9\\resources\\app.asar: EBUSY: resource busy or locked, rename 'C:\\Fixture\\a' -> 'C:\\Fixture\\b'",
    ),
  );
  assert.equal((busy as { code?: string }).code, "EBUSY");
  assert.ok(isInUse(busy));
  assert.doesNotMatch(busy.message, /Fixture/);
  const denied = repairFailure(
    summary("Inject failed for C:\\Fixture\\app.asar: EPERM: operation not permitted, rename"),
  );
  assert.ok(isInUse(denied));
  const used = repairFailure(
    summary("The process cannot access the file because it is being used by another process."),
  );
  assert.ok(isInUse(used));
  const other = repairFailure(summary("Inject failed for C:\\Fixture\\app.asar: invalid asar header"));
  assert.equal(isInUse(other), false);
  assert.equal(reasonCode(other), "invalid-asar");
  assert.doesNotMatch(other.message, /Fixture/);
});

test("a folder Discord is still installing is left alone", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    await fs.mkdir(path.join(h.rootDir, `.app-${VERSION}.installing`));
    await monitor.evaluate(enabled, "staged");
    await monitor.evaluate(enabled, "sweep");
    await monitor.settled();
    assert.equal(h.calls.patch, 0);
    assert.equal(h.calls.processes, 0);
    assert.deepEqual(await readRecoveryState(h.home), {});
  } finally {
    await cleanup();
  }
});

test("only channels with a registry record for that root are followed", async () => {
  for (const registryRoot of [null, "C:\\Fixture\\ElsewhereDiscord"]) {
    const { h, monitor, cleanup } = await harness({ registryRoot });
    try {
      await monitor.evaluate(enabled, "staged");
      await monitor.evaluate(
        { enabled: true, channels: ["stable", "ptb"] },
        "sweep",
      );
      await monitor.settled();
      assert.equal(h.calls.patch, 0);
      assert.equal(h.calls.check, 0);
      assert.deepEqual(await readRecoveryState(h.home), {});
    } finally {
      await cleanup();
    }
  }
});

test("disabled recovery makes no calls", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    await monitor.evaluate({ enabled: false, channels: ["stable"] }, "sweep");
    await monitor.evaluate({ enabled: true, channels: [] }, "staged");
    await monitor.settled();
    assert.deepEqual(h.calls, {
      discover: 0,
      check: 0,
      patch: 0,
      processes: 0,
      lifecycle: 0,
    });
  } finally {
    await cleanup();
  }
});

test("a corrupt recovery state reads as empty and is rewritten on the next action", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    const file = path.join(h.home, "recovery-state.json");
    await fs.writeFile(file, "{not json");
    assert.deepEqual(await readRecoveryState(h.home), {});
    await fs.writeFile(file, JSON.stringify({ stable: { phase: "bogus" }, nope: {} }));
    assert.deepEqual(await readRecoveryState(h.home), {});
    await monitor.evaluate(enabled, "staged");
    assert.equal((await readRecoveryState(h.home)).stable?.phase, "patched");
  } finally {
    await cleanup();
  }
});

test("recovery state round-trips and keeps only valid channel records", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-recovery-state-"));
  try {
    assert.deepEqual(await readRecoveryState(home), {});
    await writeRecoveryState(home, {
      stable: { phase: "failed", version: "1", at: 5, attempts: 3, detail: "EIO" },
      ptb: { phase: "idle", at: 1, attempts: 0 },
    });
    assert.deepEqual(await readRecoveryState(home), {
      stable: { phase: "failed", version: "1", at: 5, attempts: 3, detail: "EIO" },
      ptb: { phase: "idle", at: 1, attempts: 0 },
    });
    const left = await fs.readdir(home);
    assert.deepEqual(left, ["recovery-state.json"], "no temp files remain");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("Restart Discord stops the waiter and repairs through the lifecycle", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.pids = [21];
    h.alive = new Set([21]);
    const poll = deferred();
    h.onWait = (ms) => (ms === 5000 ? poll.promise : undefined);
    await monitor.evaluate(enabled, "staged");
    assert.equal((await readRecoveryState(h.home)).stable?.phase, "waiting-for-exit");
    await monitor.restartAndRepair("stable");
    assert.equal(h.calls.lifecycle, 1);
    // Even if the archive looked unhooked again, the old waiter must not act.
    h.healthy = false;
    h.alive.clear();
    h.pids = [];
    poll.release();
    await monitor.settled();
    assert.equal(h.calls.patch, 0, "the cancelled waiter does not patch again");
    assert.equal((await readRecoveryState(h.home)).stable?.phase, "patched");
  } finally {
    await cleanup();
  }
});

test("process lookup returns only the channel's executable inside that version folder", async () => {
  const system = {
    async processes() {
      return [
        { pid: 1, executable: "C:\\Fixture\\Discord\\app-1.0.9\\Discord.exe" },
        { pid: 2, executable: "C:\\Fixture\\Discord\\app-1.0.8\\Discord.exe" },
        { pid: 3, executable: "C:\\Fixture\\Discord\\Update.exe" },
        { pid: 4, executable: "C:\\Fixture\\Discord\\app-1.0.9\\DiscordPTB.exe" },
        { pid: 5, executable: "C:\\Fixture\\Discord\\app-1.0.9\\discord.EXE" },
      ];
    },
  } as unknown as DiscordSystem;
  assert.deepEqual(
    await processesUnder(
      {
        channel: "stable",
        version: "1.0.9",
        rootDir: "C:\\Fixture\\Discord",
        appDir: "C:\\Fixture\\Discord\\app-1.0.9",
        asarPath: "C:\\Fixture\\Discord\\app-1.0.9\\resources\\app.asar",
        isActive: true,
      },
      system,
    ),
    [1, 5],
  );
});

test("watch events map to staged folders and replaced archives only", () => {
  assert.equal(classifyRootEvent("rename", "app-1.0.10"), "staged");
  assert.equal(classifyRootEvent("rename", ".app-1.0.10.installing"), null);
  assert.equal(classifyRootEvent("change", "app-1.0.10"), null);
  assert.equal(classifyRootEvent("rename", "Update.exe"), null);
  assert.equal(classifyRootEvent("rename", null), null);
  assert.equal(classifyResourcesEvent("rename", "app.asar"), "asar-changed");
  assert.equal(classifyResourcesEvent("change", "APP.ASAR"), "asar-changed");
  assert.equal(classifyResourcesEvent("rename", "app.asar.vestra-tmp"), null);
  assert.equal(classifyResourcesEvent("change", null), null);
});

test("watchers cover each tracked root and only its current version folder", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-watch-test-"));
  try {
    const root = path.join(base, "Discord");
    await fs.mkdir(path.join(root, "app-1.0.8", "resources"), { recursive: true });
    await fs.mkdir(path.join(root, "app-1.0.9", "resources"), { recursive: true });
    await fs.mkdir(path.join(root, ".app-1.0.10.installing", "resources"), {
      recursive: true,
    });
    await fs.writeFile(path.join(root, "Update.exe"), "");
    const missing = path.join(base, "missing");
    const watched: string[] = [];
    const closed: string[] = [];
    const listeners = new Map<string, (event: string, name: string | null) => void>();
    const events: string[] = [];
    const stop = watchRoots(
      [
        { rootDir: root, appDir: path.join(root, "app-1.0.9") },
        { rootDir: root, appDir: path.join(root, "app-1.0.9") },
        { rootDir: missing, appDir: path.join(missing, "app-1") },
      ],
      (where, kind) => events.push(`${path.basename(where)}:${kind}`),
      ((dir: string, listener: (event: string, name: string | null) => void) => {
        if (dir.startsWith(missing)) throw new Error("ENOENT");
        watched.push(path.relative(base, dir));
        listeners.set(path.relative(base, dir), listener);
        return {
          on() {
            return this;
          },
          close() {
            closed.push(path.relative(base, dir));
          },
        };
      }) as never,
    );
    assert.deepEqual(watched.sort(), [
      "Discord",
      path.join("Discord", "app-1.0.9", "resources"),
    ]);
    listeners.get("Discord")!("rename", "app-1.0.10");
    listeners.get(path.join("Discord", "app-1.0.9", "resources"))!("rename", "app.asar");
    listeners.get("Discord")!("change", "Update.exe");
    assert.deepEqual(events, ["Discord:staged", "Discord:asar-changed"]);
    stop();
    assert.equal(closed.length, 2);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("Restart Discord runs under the install lock", async () => {
  const { h, monitor, cleanup } = await harness();
  const gate = deferred();
  try {
    // A holder outside this call chain owns the lock.
    const holder = withInstallLock(h.home, () => gate.promise);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(
      () => monitor.restartAndRepair("stable"),
      /Another installation operation/,
    );
    assert.equal(h.calls.lifecycle, 0);
    gate.release();
    await holder;
    await monitor.restartAndRepair("stable");
    assert.equal(h.calls.lifecycle, 1);
  } finally {
    gate.release();
    await cleanup();
  }
});

test("a Restart Discord click refused by a busy lock keeps the waiter", async () => {
  const { h, monitor, cleanup } = await harness();
  const gate = deferred();
  try {
    h.pids = [31];
    h.alive = new Set([31]);
    const poll = deferred();
    h.onWait = (ms) => (ms === 5000 ? poll.promise : undefined);
    await monitor.evaluate(enabled, "staged");
    const holder = withInstallLock(h.home, () => gate.promise);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(
      () => monitor.restartAndRepair("stable"),
      /Another installation operation/,
    );
    gate.release();
    await holder;
    // Discord closes later: the surviving waiter patches it.
    h.alive.clear();
    h.pids = [];
    h.onWait = undefined;
    poll.release();
    await monitor.settled();
    assert.equal(h.calls.patch, 1);
    assert.equal((await readRecoveryState(h.home)).stable?.phase, "patched");
  } finally {
    gate.release();
    await cleanup();
  }
});

test("a failed Restart Discord keeps the archive's attempt budget", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    h.patchError = () => new Error("boom");
    await monitor.evaluate(enabled, "staged");
    await monitor.settled();
    const before = (await readRecoveryState(h.home)).stable;
    assert.equal(before?.attempts, 3);
    h.lifecycleResult = {
      ok: false,
      results: [{ ok: false, detail: "Inject failed for C:\\Fixture\\app.asar: invalid asar" }],
    };
    await monitor.restartAndRepair("stable");
    const after = (await readRecoveryState(h.home)).stable;
    assert.equal(after?.phase, "failed");
    assert.equal(after?.attempts, 3);
    assert.equal(after?.signature, before?.signature);
    assert.equal(after?.detail, "invalid-asar");
    await monitor.evaluate(enabled, "sweep");
    await monitor.settled();
    assert.equal(h.calls.patch, 3, "the click does not reset the cap");
    assert.deepEqual(h.failures, [`stable:${VERSION}`], "same archive, one notice");
  } finally {
    await cleanup();
  }
});

function fakeNotices(
  options: { restartError?: () => Error; openError?: () => Error } = {},
) {
  const shown: Array<{
    content: NoticeContent;
    listeners: Map<string, () => void>;
    closed: boolean;
  }> = [];
  const clicks: string[] = [];
  const errors: string[] = [];
  const notices = new RecoveryNotices(
    (content) => {
      const entry = { content, listeners: new Map<string, () => void>(), closed: false };
      shown.push(entry);
      return {
        on(event: "click" | "action", listener: () => void) {
          entry.listeners.set(event, listener);
          return this;
        },
        show() {},
        close() {
          entry.closed = true;
        },
      };
    },
    {
      async restart(channel) {
        clicks.push(`restart:${channel}`);
        if (options.restartError) throw options.restartError();
      },
      async openManager() {
        clicks.push("open-manager");
        if (options.openError) throw options.openError();
      },
      onError: (error) => errors.push(reasonCode(error)),
    },
  );
  return { notices, shown, clicks, errors };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("notifications stay clickable after Windows closes the toast, until clicked", () => {
  const { notices, shown, clicks } = fakeNotices();
  notices.show("stable", "waiting-for-exit", VERSION);
  notices.show("stable", "waiting-for-exit", VERSION);
  assert.equal(shown.length, 1, "one notice per channel and version");
  assert.equal(shown[0]!.content.title, "Discord updated");
  assert.equal(shown[0]!.content.body, "Click to restart Discord and bring Vestra back.");
  assert.equal(shown[0]!.listeners.has("close"), false, "close does not release");
  assert.equal(notices.size, 1);
  notices.phase("stable", "waiting-for-exit", VERSION);
  assert.equal(notices.size, 1, "still waiting: kept");
  shown[0]!.listeners.get("click")!();
  shown[0]!.listeners.get("action")!();
  assert.deepEqual(clicks, ["restart:stable"], "one restart per notice");
  assert.equal(notices.size, 0);
});

test("notifications are withdrawn when the channel leaves their phase or version", () => {
  const { notices, shown, clicks } = fakeNotices();
  notices.show("stable", "waiting-for-exit", "1");
  notices.show("ptb", "waiting-for-exit", "1");
  notices.phase("stable", "patched", "1");
  assert.equal(shown[0]!.closed, true);
  assert.equal(shown[1]!.closed, false, "other channels are untouched");
  notices.phase("ptb", "waiting-for-exit", "2");
  assert.equal(shown[1]!.closed, true, "a newer version replaces the notice");
  notices.show("stable", "failed", "1");
  assert.equal(shown[2]!.content.title, "Vestra couldn't re-install");
  notices.phase("stable", "failed", "1");
  assert.equal(notices.size, 1);
  notices.phase("stable", "idle", "1");
  assert.equal(notices.size, 0);
  assert.deepEqual(clicks, []);
});

test("clicking the failure notice opens the Manager and never restarts Discord", async () => {
  const { notices, shown, clicks, errors } = fakeNotices();
  notices.show("stable", "failed", VERSION);
  assert.equal(shown[0]!.content.title, "Vestra couldn't re-install");
  assert.equal(
    shown[0]!.content.body,
    "Vestra couldn't re-install after Discord updated. Click to open Vestra Manager.",
  );
  assert.deepEqual(shown[0]!.content.actions, [{ type: "button", text: "Open Vestra Manager" }]);
  shown[0]!.listeners.get("click")!();
  await flush();
  assert.deepEqual(clicks, ["open-manager"]);
  assert.deepEqual(errors, []);
});

test("a restart click while another operation holds the lock shows a follow-up", async () => {
  const { notices, shown, clicks, errors } = fakeNotices({
    restartError: () => new Error("Another installation operation is already running."),
  });
  notices.show("stable", "waiting-for-exit", VERSION);
  shown[0]!.listeners.get("click")!();
  await flush();
  assert.deepEqual(clicks, ["restart:stable"]);
  assert.equal(shown.length, 2, "the click is not swallowed silently");
  assert.equal(
    shown[1]!.content.body,
    "Another Vestra operation is running. Try again in a moment.",
  );
  assert.deepEqual(errors, [], "a busy lock is not a failure");
});

test("other click failures are reported without a follow-up", async () => {
  const { notices, shown, errors } = fakeNotices({
    restartError: () => Object.assign(new Error("spawn failed"), { code: "ENOENT" }),
    openError: () => Object.assign(new Error("spawn failed"), { code: "EACCES" }),
  });
  notices.show("stable", "waiting-for-exit", VERSION);
  notices.show("stable", "failed", VERSION);
  shown[0]!.listeners.get("click")!();
  shown[1]!.listeners.get("click")!();
  await flush();
  assert.equal(shown.length, 2);
  assert.deepEqual(errors, ["ENOENT", "EACCES"]);
});

type LoopConfig = { enabled: boolean; channels: DiscordChannel[]; runtime?: string };

function fakeLoop(config: LoopConfig) {
  const calls: string[] = [];
  const timers: Array<{ ms: number; callback: () => void }> = [];
  let handoff: () => Promise<void> = async () => {};
  let reacquire = true;
  let onEvent: ((root: string, kind: "staged" | "asar-changed") => void) | undefined;
  const loop = createRecoveryLoop({
    readConfig: async () => config,
    evaluate: async (_config, trigger) => {
      calls.push(`evaluate:${trigger}`);
    },
    targets: async () => [],
    watch: (_targets, listener) => {
      onEvent = listener;
      calls.push("watch");
      return () => calls.push("unwatch");
    },
    isOtherRuntime: (runtime) => runtime !== "self.exe",
    handoff: async (runtime) => {
      calls.push(`handoff:${runtime}`);
      await handoff();
    },
    reacquire: () => {
      calls.push("reacquire");
      return reacquire;
    },
    quit: () => calls.push("quit"),
    log: (error) => calls.push(`log:${reasonCode(error)}`),
    setTimeout: (callback, ms) => {
      timers.push({ ms, callback });
      return timers.length;
    },
    clearTimeout: () => {},
    setInterval: (callback, ms) => {
      timers.push({ ms, callback });
      return 0;
    },
    clearInterval: () => calls.push("clear-interval"),
  });
  return {
    loop,
    calls,
    timers,
    event(kind: "staged" | "asar-changed") {
      onEvent!("root", kind);
    },
    failHandoff(error: Error, keepLock = true) {
      handoff = async () => {
        throw error;
      };
      reacquire = keepLock;
    },
  };
}

test("a failed handoff to the configured runtime keeps recovering in this process", async () => {
  const f = fakeLoop({ enabled: true, channels: ["stable"], runtime: "other.exe" });
  f.failHandoff(Object.assign(new Error("spawn failed"), { code: "ENOENT" }));
  await f.loop.run("sweep");
  assert.deepEqual(f.calls, [
    "handoff:other.exe",
    "log:ENOENT",
    "reacquire",
    "evaluate:sweep",
    "watch",
  ]);
  f.calls.length = 0;
  await f.loop.run("sweep");
  assert.deepEqual(f.calls, ["evaluate:sweep", "unwatch", "watch"], "no second handoff");
  assert.ok(f.timers.some((timer) => timer.ms === 600000), "10 min sweep");
});

test("a handoff that loses the instance lock quits; a successful one quits too", async () => {
  const lost = fakeLoop({ enabled: true, channels: ["stable"], runtime: "other.exe" });
  lost.failHandoff(new Error("spawn failed"), false);
  await lost.loop.run("sweep");
  assert.ok(lost.calls.includes("quit"));
  assert.ok(!lost.calls.includes("evaluate:sweep"));
  const ok = fakeLoop({ enabled: true, channels: ["stable"], runtime: "other.exe" });
  await ok.loop.run("sweep");
  assert.deepEqual(ok.calls, ["handoff:other.exe", "clear-interval", "quit"]);
  const same = fakeLoop({ enabled: true, channels: ["stable"], runtime: "self.exe" });
  await same.loop.run("sweep");
  assert.deepEqual(same.calls, ["evaluate:sweep", "watch"]);
  const off = fakeLoop({ enabled: false, channels: ["stable"] });
  await off.loop.run("sweep");
  assert.deepEqual(off.calls, ["clear-interval", "quit"]);
});

test("archive changes are debounced 5 s; staged folders run at once", async () => {
  const f = fakeLoop({ enabled: true, channels: ["stable"] });
  await f.loop.run("sweep");
  f.calls.length = 0;
  f.event("asar-changed");
  f.event("asar-changed");
  const debounces = f.timers.filter((timer) => timer.ms === 5000);
  assert.equal(debounces.length, 2);
  assert.deepEqual(f.calls, [], "nothing before the debounce fires");
  debounces.at(-1)!.callback();
  await f.loop.run("staged");
  f.event("staged");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(
    f.calls.filter((call) => call.startsWith("evaluate")),
    ["evaluate:asar-changed", "evaluate:staged", "evaluate:staged"],
  );
});
