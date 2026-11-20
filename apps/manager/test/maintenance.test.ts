import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { withInstallLock } from "@vestra/installer";
import { RecoveryMonitor } from "../src/main/maintenance.js";
import type { InstallerService } from "@vestra/installer";
import type { DiscordLifecycle } from "../src/main/discordLifecycle.js";

test("background recovery waits for stable files, follows only opted-in roots and respects disabling", async () => {
  const home = await fs.mkdtemp(
    path.join(os.tmpdir(), "vestra-recovery-test-"),
  );
  const rootDir = "C:\\Fixture\\Discord";
  const config = { enabled: true, channels: ["stable" as const] };
  let updating = false;
  let signature = "first";
  let repairs = 0;
  let healthy = false;
  const service = {
    context: { homeDir: home },
    async discover() {
      return [
        {
          channel: "stable",
          rootDir,
          asarPath: rootDir + "\\app-2\\resources\\app.asar",
        },
      ];
    },
    async check() {
      return { statuses: [{ health: healthy ? "healthy" : "not-installed" }] };
    },
  } as unknown as InstallerService;
  const lifecycle = {
    async updaterBusy() {
      return updating;
    },
    async run() {
      repairs++;
      return { ok: true };
    },
  } as unknown as DiscordLifecycle;
  try {
    await fs.writeFile(
      path.join(home, "maintenance.json"),
      JSON.stringify(config),
    );
    await fs.writeFile(
      path.join(home, "installs.json"),
      JSON.stringify({
        old: {
          asarPath: "old",
          rootDir,
          channel: "stable",
          payloadVersion: "1",
        },
      }),
    );
    const monitor = new RecoveryMonitor(
      service,
      lifecycle,
      async () => signature,
    );
    await monitor.tick(config, 0);
    assert.equal(repairs, 0);
    updating = true;
    await monitor.tick(config, 15000);
    assert.equal(repairs, 0);
    updating = false;
    signature = "second";
    await monitor.tick(config, 30000);
    assert.equal(repairs, 0);
    await monitor.tick(config, 45000);
    assert.equal(repairs, 1);
    await monitor.tick(config, 60000);
    assert.equal(repairs, 1, "failure/retry backoff prevents restart loops");
    healthy = true;
    await monitor.tick(config, 400000);
    await monitor.tick(config, 415000);
    assert.equal(
      repairs,
      1,
      "healthy installations are never automatically restarted",
    );
    healthy = false;
    await fs.writeFile(
      path.join(home, "maintenance.json"),
      JSON.stringify({ ...config, enabled: false }),
    );
    await monitor.tick(config, 430000);
    assert.equal(repairs, 1, "disable is rechecked before writing");
    await fs.writeFile(
      path.join(home, "installs.json"),
      JSON.stringify({
        old: {
          asarPath: "old",
          rootDir: "C:\\Different",
          channel: "stable",
          payloadVersion: "1",
        },
      }),
    );
    await monitor.tick(config, 800000);
    assert.equal(repairs, 1, "another root is never patched");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("foreground and background operations cannot mutate archives concurrently", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-lock-test-"));
  try {
    await withInstallLock(home, () => withInstallLock(home, async () => {}));
    await withInstallLock(home, async () => {});
    await assert.rejects(
      () =>
        withInstallLock(home, async () => {
          throw new Error("fixture failure");
        }),
      /fixture failure/,
    );
    await withInstallLock(home, async () => {});
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

import { composeNotice } from "../src/shared/flows.js";
import { MaintenanceController, trackAfterOperation } from "../src/main/maintenance.js";

test("a failing keep-installed step becomes a warning on a successful operation", async () => {
  const failing = {
    async track() {
      throw new Error("registry denied");
    },
  };
  const result = await trackAfterOperation(failing, "install", "stable", {
    ok: true,
    results: [],
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.warning,
    "Installed. Keep Vestra installed couldn't be turned on: registry denied",
  );
});

async function stagingFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-stage-test-"));
  const home = path.join(root, "home");
  const localAppData = path.join(root, "local");
  const app = path.join(root, "app");
  await fs.mkdir(path.join(app, "resources"), { recursive: true });
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(app, "resources", "app.asar"), "asar-1");
  await fs.writeFile(path.join(app, "Vestra.exe"), "exe");
  await fs.writeFile(path.join(root, "bundle.js"), "bundle");
  const service = {
    context: { homeDir: home, bundlePath: path.join(root, "bundle.js") },
  } as unknown as InstallerService;
  return { root, home, localAppData, app, service };
}
const onWindows = process.platform === "win32" ? test : test.skip;

onWindows("a failed registration keeps the previous maintenance config", async () => {
  const f = await stagingFixture();
  try {
    const before = JSON.stringify({ enabled: true, channels: ["ptb"] });
    await fs.writeFile(path.join(f.home, "maintenance.json"), before);
    const controller = new MaintenanceController(
      f.service,
      {
        packaged: true,
        executable: path.join(f.app, "Vestra.exe"),
        localAppData: f.localAppData,
      },
      {
        exec: async () => {
          throw new Error("reg add failed");
        },
        launch: async () => {},
      },
    );
    await assert.rejects(() => controller.track("stable", true), /reg add failed/);
    assert.equal(
      await fs.readFile(path.join(f.home, "maintenance.json"), "utf8"),
      before,
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

onWindows("staging a new runtime removes older copies", async () => {
  const f = await stagingFixture();
  try {
    const parent = path.join(f.localAppData, "Vestra", "maintenance");
    await fs.mkdir(path.join(parent, "oldhash0000000000"), { recursive: true });
    await fs.writeFile(path.join(parent, "oldhash0000000000", "x"), "x");
    const controller = new MaintenanceController(
      f.service,
      {
        packaged: true,
        executable: path.join(f.app, "Vestra.exe"),
        localAppData: f.localAppData,
      },
      { exec: async () => ({}), launch: async () => {} },
    );
    await controller.track("stable", true);
    const left = await fs.readdir(parent);
    assert.equal(left.length, 1);
    assert.notEqual(left[0], "oldhash0000000000");
    const saved = JSON.parse(
      await fs.readFile(path.join(f.home, "maintenance.json"), "utf8"),
    );
    assert.deepEqual(saved.channels, ["stable"]);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("track warnings combine with an existing warning and read naturally in the notice", async () => {
  const failing = {
    async track() {
      throw new Error("denied");
    },
  };
  const result = await trackAfterOperation(failing, "install", "stable", {
    ok: true,
    results: [],
    warning: "Discord didn't reopen. Open it manually.",
  });
  assert.equal(
    result.warning,
    "Discord didn't reopen. Open it manually. Installed. Keep Vestra installed couldn't be turned on: denied",
  );
  assert.equal(
    composeNotice("Vestra installed successfully.", result.warning),
    "Vestra installed successfully. Discord didn't reopen. Open it manually. Keep Vestra installed couldn't be turned on: denied",
  );
  assert.equal(
    composeNotice(
      "Vestra installed successfully.",
      "Installed. Keep Vestra installed couldn't be turned on: x",
    ),
    "Vestra installed successfully. Keep Vestra installed couldn't be turned on: x",
  );
  assert.equal(composeNotice("Done."), "Done.");
});

onWindows("old runtimes survive a failed registration and go after a successful one", async () => {
  const f = await stagingFixture();
  try {
    const parent = path.join(f.localAppData, "Vestra", "maintenance");
    const old = path.join(parent, "oldhash0000000000");
    await fs.mkdir(old, { recursive: true });
    const host = {
      packaged: true,
      executable: path.join(f.app, "Vestra.exe"),
      localAppData: f.localAppData,
    };
    const failing = new MaintenanceController(f.service, host, {
      exec: async () => {
        throw new Error("reg add failed");
      },
      launch: async () => {},
    });
    await assert.rejects(() => failing.track("stable", true), /reg add failed/);
    await fs.access(old);
    const ok = new MaintenanceController(f.service, host, {
      exec: async () => ({}),
      launch: async () => {},
    });
    await ok.track("stable", true);
    await assert.rejects(() => fs.access(old));
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
