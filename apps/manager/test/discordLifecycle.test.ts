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
