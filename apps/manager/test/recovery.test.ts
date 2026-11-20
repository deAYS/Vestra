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
      h.healthy = true;
      return { ok: true, results: [] };
    },
  };
  const monitor = new RecoveryMonitor(
    {
      service,
      async processesFor() {
        h.calls.processes++;
        return [...h.pids];
      },
      isAlive: (pid) => h.alive.has(pid),
      async patch() {
        h.calls.patch++;
        h.attemptsSeen.push((await readRecoveryState(home)).stable?.attempts ?? 0);
        await h.onPatch?.();
        if (h.patchError) throw h.patchError();
        h.healthy = true;
      },
      notify: (channel, version) => h.notified.push(`${channel}:${version}`),
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

test("in-use failures never count toward the retry cap", async () => {
  const { h, monitor, cleanup } = await harness();
  try {
    const errors = [
      () => Object.assign(new Error("busy"), { code: "EBUSY" }),
      () => Object.assign(new Error("denied"), { code: "EPERM" }),
      () => new Error("The process cannot access the file because it is being used by another process."),
      () => Object.assign(new Error("busy"), { code: "EBUSY" }),
      () => Object.assign(new Error("busy"), { code: "EBUSY" }),
    ];
    for (const error of errors) {
      h.patchError = error;
      await monitor.evaluate(enabled, "staged");
      await monitor.settled();
    }
    assert.equal(h.calls.patch, 5);
    const state = await readRecoveryState(h.home);
    assert.equal(state.stable?.phase, "waiting-for-exit");
    assert.equal(state.stable?.attempts, 0);
    assert.deepEqual(h.attemptsSeen, [0, 0, 0, 0, 0]);
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
    await monitor.evaluate(enabled, "sweep");
    await monitor.evaluate(enabled, "staged");
    await monitor.settled();
    assert.equal(h.calls.patch, 3, "no fourth attempt for the same archive");
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

test("watchers cover each root and its version folders, survive errors and close", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-watch-test-"));
  try {
    const root = path.join(base, "Discord");
    await fs.mkdir(path.join(root, "app-1.0.9", "resources"), { recursive: true });
    await fs.mkdir(path.join(root, ".app-1.0.10.installing", "resources"), {
      recursive: true,
    });
    await fs.writeFile(path.join(root, "Update.exe"), "");
    const watched: string[] = [];
    const closed: string[] = [];
    const listeners = new Map<string, (event: string, name: string | null) => void>();
    const events: string[] = [];
    const stop = watchRoots(
      [root, path.join(base, "missing")],
      (where, kind) => events.push(`${path.basename(where)}:${kind}`),
      ((dir: string, listener: (event: string, name: string | null) => void) => {
        if (dir.endsWith("missing")) throw new Error("ENOENT");
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
