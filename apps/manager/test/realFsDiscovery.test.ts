// Manager realFs regression: the Electron ASAR-shim bug lived in the bundled
// main process, so this contract test guards both halves:
//   1. `original-fs` stays external in the main bundle build.
//   2. InstallerService discovery returns Stable + Canary when the real-fs
//      provider is selected, even with a simulated patched fs present.
// Fixture/temp directories only — never touches real Discord installs.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInstallerService } from "@vestra/installer";
import {
  __setRealFsForTests,
  __resetRealFsForTests,
  type RealFs,
} from "../../../packages/injector/src/realFs.js";

const ROOT = path.join(import.meta.dirname, "..");

afterEach(() => {
  __resetRealFsForTests();
});

async function makeLocalAppData(): Promise<{ base: string; cleanup: () => Promise<void> }> {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-manager-realfs-"));
  for (const [dir, version] of [["Discord", "1.0.9256"], ["DiscordCanary", "1.0.1157"]] as const) {
    const asarPath = path.join(base, dir, `app-${version}`, "resources", "app.asar");
    await fs.promises.mkdir(path.dirname(asarPath), { recursive: true });
    await fs.promises.writeFile(asarPath, "fake-asar-bytes", "utf8");
  }
  return { base, cleanup: () => fs.promises.rm(base, { recursive: true, force: true }) };
}

describe("manager realFs regression", () => {
  test("main bundle keeps original-fs external", () => {
    const build = fs.readFileSync(path.join(ROOT, "scripts", "build.mjs"), "utf8");
    assert.match(build, /original-fs/, "build.mjs must reference original-fs");
    assert.match(build, /external:\s*\[[^\]]*original-fs[^\]]*\]/, "original-fs must be external");
  });

  test("Manager service discovery finds stable + canary via real fs", async () => {
    const { base, cleanup } = await makeLocalAppData();
    try {
      // Simulate Electron's patched fs misreporting .asar files, then select
      // the unpatched provider (as the fixed main process does).
      const patched: RealFs = {
        ...(fs as unknown as RealFs),
        promises: fs.promises,
        statSync: ((p: string) => {
          const st = fs.statSync(p);
          if (p.endsWith("app.asar")) {
            return { ...st, isFile: () => false, isDirectory: () => false } as unknown as fs.Stats;
          }
          return st;
        }) as RealFs["statSync"],
      };
      assert.equal(patched.statSync(path.join(base, "Discord", "app-1.0.9256", "resources", "app.asar")).isFile(), false);
      __setRealFsForTests(fs as unknown as RealFs);

      const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-manager-home-"));
      try {
        const service = createInstallerService({
          homeDir: home,
          testMode: true,
          discovery: { platform: "win32", env: { LOCALAPPDATA: base, APPDATA: base, HOME: base } },
        });
        const found = await service.discover();
        const channels = found.map((f) => f.channel).sort();
        assert.deepEqual(channels, ["canary", "stable"]);
      } finally {
        await fs.promises.rm(home, { recursive: true, force: true });
      }
    } finally {
      await cleanup();
    }
  });
});
