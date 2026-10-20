import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RecoveryMonitor, withInstallLock } from "../src/main/maintenance.js";
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
    await withInstallLock(home, async () => {
      await assert.rejects(
        () => withInstallLock(home, async () => {}),
        /Another installation operation/,
      );
    });
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
