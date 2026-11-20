import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DiscordLifecycle,
  belongsToRoot,
  type DiscordSystem,
  type DiscordProcess,
} from "../src/main/discordLifecycle.js";
import type { InstallerService, DiscordInstallation } from "@vestra/installer";

const target: DiscordInstallation = {
  channel: "stable",
  version: "1.0.1",
  rootDir: "C:\\Fixture\\Discord",
  appDir: "C:\\Fixture\\Discord\\app-1.0.1",
  asarPath: "C:\\Fixture\\Discord\\app-1.0.1\\resources\\app.asar",
  isActive: true,
};
function harness() {
  const calls: string[] = [];
  let running: DiscordProcess[] = [
    { pid: 1, executable: target.appDir + "\\Discord.exe" },
    {
      pid: 2,
      executable: "C:\\Fixture\\DiscordCanary\\app-1.0.1\\DiscordCanary.exe",
    },
  ];
  let healthy = true;
  let fail = false;
  let refuse = false;
  const result = {
    ok: true,
    results: [
      {
        asarPath: target.asarPath,
        channel: "stable",
        ok: true,
        action: "repaired",
      },
    ],
  };
  const service = {
    async discover() {
      return [target];
    },
    async install(args: { force?: boolean }) {
      calls.push("install:" + args.force);
      return result;
    },
    async repair() {
      calls.push("repair");
      if (fail) throw new Error("fixture failure");
      if (refuse)
        return {
          ok: false,
          results: [{ ...result.results[0], ok: false, action: "failed", detail: "refused" }],
        };
      return result;
    },
    async uninstall(args: { purge?: boolean }) {
      calls.push("uninstall:" + args.purge);
      healthy = false;
      return result;
    },
    async check() {
      calls.push("check");
      return {
        statuses: [
          {
            installation: target,
            health: healthy ? "healthy" : "not-installed",
            vestraInstalled: healthy,
          },
        ],
        stale: [],
      };
    },
  } as unknown as InstallerService;
  const system: DiscordSystem = {
    async processes() {
      return [...running];
    },
    async stop(proc) {
      calls.push("stop:" + proc.pid);
      running = running.filter((item) => item.pid !== proc.pid);
    },
    async launch() {
      calls.push("launch");
    },
    exists: () => true,
    async wait() {
      calls.push("wait");
      running = running.filter(
        (proc) => !proc.executable.endsWith("Update.exe"),
      );
    },
  };
  return {
    calls,
    service,
    system,
    lifecycle: new DiscordLifecycle(service, system),
    update() {
      running.push({ pid: 3, executable: target.rootDir + "\\Update.exe" });
    },
    fail() {
      fail = true;
    },
    refuse() {
      refuse = true;
    },
    breakVerification() {
      healthy = false;
    },
  };
}

test("path scoping cannot close another channel or sibling-prefix directory", () => {
  assert.equal(
    belongsToRoot("C:\\Fixture\\DiscordCanary\\Discord.exe", target.rootDir),
    false,
  );
  assert.equal(
    belongsToRoot("C:\\Fixture\\Discord-evil\\Discord.exe", target.rootDir),
    false,
  );
  assert.equal(
    belongsToRoot("C:\\Fixture\\Discord\\app-1\\Discord.exe", target.rootDir),
    true,
  );
  assert.equal(belongsToRoot("Discord.exe", target.rootDir), false);
});
test("Install closes only the selected Discord, force installs, verifies and relaunches", async () => {
  const h = harness();
  await h.lifecycle.run("install", "stable");
  assert.deepEqual(h.calls, ["stop:1", "install:true", "check", "launch"]);
});
test("Repair really replaces a healthy installation and waits for its updater", async () => {
  const h = harness();
  h.update();
  await h.lifecycle.run("repair", "stable");
  assert.deepEqual(h.calls, ["wait", "stop:1", "repair", "check", "launch"]);
});
test("a failed patch reopens the user's Discord without claiming success", async () => {
  const h = harness();
  h.fail();
  await assert.rejects(
    () => h.lifecycle.run("repair", "stable"),
    /fixture failure/,
  );
  assert.deepEqual(h.calls, ["stop:1", "repair", "launch"]);
});
test("failed post-install verification cannot report success", async () => {
  const h = harness();
  h.breakVerification();
  await assert.rejects(
    () => h.lifecycle.run("install", "stable"),
    /verification failed/,
  );
  assert.deepEqual(h.calls, ["stop:1", "install:true", "check", "launch"]);
});
test("Uninstall preserves settings, verifies removal and reopens native Discord", async () => {
  const h = harness();
  await h.lifecycle.run("uninstall", "stable");
  assert.deepEqual(h.calls, ["stop:1", "uninstall:false", "check", "launch"]);
});
test("Discord that was not running is never launched", async () => {
  const h = harness();
  await h.system.stop({ pid: 1, executable: target.appDir + "\Discord.exe" });
  h.calls.length = 0;
  const result = await h.lifecycle.run("uninstall", "stable");
  assert.deepEqual(h.calls, ["uninstall:false", "check"]);
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
});
test("a relaunch failure keeps the operation successful with a warning", async () => {
  const h = harness();
  const system: DiscordSystem = {
    ...h.system,
    async launch() {
      throw new Error("spawn failed");
    },
  };
  const lifecycle = new DiscordLifecycle(h.service, system);
  const result = await lifecycle.run("install", "stable");
  assert.equal(result.ok, true);
  assert.equal(result.warning, "Discord didn't reopen. Open it manually.");
});
test("isRunning sees only this channel's Discord and never stops it", async () => {
  const h = harness();
  assert.equal(await h.lifecycle.isRunning("stable"), true);
  await h.system.stop({ pid: 1, executable: target.appDir + "\\Discord.exe" });
  h.calls.length = 0;
  // The Canary fixture process (another root) does not count for Stable.
  assert.equal(await h.lifecycle.isRunning("stable"), false);
  assert.deepEqual(h.calls, [], "a query never stops, launches or patches");
});
test("afterVerify runs after verification and before Discord reopens", async () => {
  const h = harness();
  await h.lifecycle.run("install", "stable", undefined, {
    afterVerify: async () => {
      h.calls.push("afterVerify");
    },
  });
  assert.deepEqual(h.calls, ["stop:1", "install:true", "check", "afterVerify", "launch"]);
});
test("afterVerify never runs for a failed operation, and its failure is ignored", async () => {
  const h = harness();
  h.breakVerification();
  let ran = false;
  await assert.rejects(() =>
    h.lifecycle.run("install", "stable", undefined, {
      afterVerify: async () => {
        ran = true;
      },
    }),
  );
  assert.equal(ran, false);
  const ok = harness();
  const result = await ok.lifecycle.run("repair", "stable", undefined, {
    afterVerify: async () => {
      throw new Error("fixture cleanup failure");
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(ok.calls, ["stop:1", "repair", "check", "launch"]);
});

function failingLaunch(h: ReturnType<typeof harness>): DiscordLifecycle {
  return new DiscordLifecycle(h.service, {
    ...h.system,
    async launch() {
      h.calls.push("launch-failed");
      throw new Error("spawn failed");
    },
  });
}
test("a failed operation whose relaunch also fails says Discord didn't reopen", async () => {
  const h = harness();
  h.fail();
  await assert.rejects(
    () => failingLaunch(h).run("repair", "stable"),
    (error: Error) =>
      error.message === "fixture failure Discord didn't reopen. Open it manually.",
  );
  assert.deepEqual(h.calls, ["stop:1", "repair", "launch-failed"]);
});
test("a refused operation whose relaunch fails carries the warning", async () => {
  const h = harness();
  h.refuse();
  const result = await failingLaunch(h).run("repair", "stable");
  assert.equal(result.ok, false);
  assert.equal(result.warning, "Discord didn't reopen. Open it manually.");
  const reopened = harness();
  reopened.refuse();
  const plain = await reopened.lifecycle.run("repair", "stable");
  assert.equal(plain.warning, undefined);
  assert.deepEqual(reopened.calls, ["stop:1", "repair", "launch"]);
});
test("alwaysRelaunch opens Discord after success even when it was closed", async () => {
  const h = harness();
  await h.system.stop({ pid: 1, executable: target.appDir + "\Discord.exe" });
  h.calls.length = 0;
  const result = await h.lifecycle.run("repair", "stable", undefined, { alwaysRelaunch: true });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls, ["repair", "check", "launch"]);
});
test("alwaysRelaunch never opens a closed Discord after a failure", async () => {
  const h = harness();
  await h.system.stop({ pid: 1, executable: target.appDir + "\Discord.exe" });
  h.fail();
  h.calls.length = 0;
  await assert.rejects(() =>
    h.lifecycle.run("repair", "stable", undefined, { alwaysRelaunch: true }),
  );
  assert.deepEqual(h.calls, ["repair"]);
});
test("onVerified receives the installation that was repaired and verified", async () => {
  const h = harness();
  const seen: string[] = [];
  await h.lifecycle.run("repair", "stable", undefined, {
    onVerified: (installation) => {
      seen.push(installation.appDir);
      h.calls.push("verified");
    },
  });
  assert.deepEqual(seen, [target.appDir]);
  assert.deepEqual(h.calls, ["stop:1", "repair", "check", "verified", "launch"]);
});
