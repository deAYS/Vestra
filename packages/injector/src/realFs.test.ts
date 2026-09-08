// @vestra/injector — realFs regression tests.
// Proves the Electron ASAR-shim fix without requiring Electron:
//   - fallback (no original-fs) uses node:fs semantics
//   - simulated patched fs misreports app.asar (isFile=false) → discovery fails
//   - simulated original fs reports correctly → Stable + Canary discovered
// Fixture/temp directories only — never touches real Discord installs.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listInstalls, isInjected, readAsarMain, packAsar } from "./index.js";
import { getRealFs, __setRealFsForTests, __resetRealFsForTests, type RealFs } from "./realFs.js";
import { RECEIPT_FILE, BACKUP_SUFFIX } from "./patch.js";

afterEach(() => {
  __resetRealFsForTests();
});

/** Temp base mimicking %LOCALAPPDATA% with Stable + Canary versioned layouts. */
async function makeLocalAppData(): Promise<{ base: string; cleanup: () => Promise<void> }> {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-realfs-"));
  const layouts: Array<[string, string]> = [
    ["Discord", "1.0.9256"],
    ["DiscordCanary", "1.0.1157"],
  ];
  for (const [dir, version] of layouts) {
    const asarPath = path.join(base, dir, `app-${version}`, "resources", "app.asar");
    await fs.promises.mkdir(path.dirname(asarPath), { recursive: true });
    await fs.promises.writeFile(asarPath, "fake-asar-bytes", "utf8");
  }
  return { base, cleanup: () => fs.promises.rm(base, { recursive: true, force: true }) };
}

function asPatchedFs(): RealFs {
  const real = fs as unknown as RealFs;
  return {
    ...real,
    promises: fs.promises,
    statSync: ((p: string) => {
      const st = fs.statSync(p);
      // Simulate Electron's patched fs: .asar physical files misreport isFile()=false.
      if (p.endsWith("app.asar") || p.endsWith(`app.asar${BACKUP_SUFFIX}`)) {
        return { ...st, isFile: () => false, isDirectory: () => false } as unknown as fs.Stats;
      }
      return st;
    }) as RealFs["statSync"],
  };
}

function asOriginalFs(): RealFs {
  return fs as unknown as RealFs;
}

describe("realFs fallback (Node/Bun, no original-fs)", () => {
  test("getRealFs returns node:fs semantics outside Electron", () => {
    const rfs = getRealFs();
    assert.equal(typeof rfs.statSync, "function");
    assert.equal(typeof rfs.readdirSync, "function");
    // Real file probe works.
    const tmp = path.join(os.tmpdir(), `vestra-realfs-probe-${Date.now()}`);
    fs.writeFileSync(tmp, "x");
    try {
      assert.equal(rfs.statSync(tmp).isFile(), true);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  test("CLI-like discovery works with fallback fs (no mocks)", async () => {
    const { base, cleanup } = await makeLocalAppData();
    try {
      const found = listInstalls({ platform: "win32", env: { LOCALAPPDATA: base } });
      const channels = found.map((f) => f.channel).sort();
      assert.deepEqual(channels, ["canary", "stable"]);
    } finally {
      await cleanup();
    }
  });
});

describe("realFs Electron regression (Stable + Canary)", () => {
  test("patched fs alone reproduces the bug (no installs found)", async () => {
    const { base, cleanup } = await makeLocalAppData();
    try {
      __setRealFsForTests(asPatchedFs());
      // Sanity: the mock really misreports.
      const asar = path.join(base, "Discord", "app-1.0.9256", "resources", "app.asar");
      assert.equal(getRealFs().statSync(asar).isFile(), false);
      const found = listInstalls({ platform: "win32", env: { LOCALAPPDATA: base } });
      assert.equal(found.length, 0);
    } finally {
      await cleanup();
    }
  });

  test("original fs fixes discovery: stable + canary found", async () => {
    const { base, cleanup } = await makeLocalAppData();
    try {
      __setRealFsForTests(asOriginalFs());
      const found = listInstalls({ platform: "win32", env: { LOCALAPPDATA: base } });
      const channels = found.map((f) => f.channel).sort();
      assert.deepEqual(channels, ["canary", "stable"]);
      // No receipt/registry required for discovery.
      for (const f of found) {
        assert.equal(fs.existsSync(path.join(f.resourcesDir, RECEIPT_FILE)), false);
      }
    } finally {
      await cleanup();
    }
  });

  test("isInjected uses real fs even when patched fs is present", async () => {
    const { base, cleanup } = await makeLocalAppData();
    try {
      const asarPath = path.join(base, "Discord", "app-1.0.9256", "resources", "app.asar");
      const resourcesDir = path.dirname(asarPath);
      const install = {
        channel: "stable" as const,
        rootDir: path.join(base, "Discord"),
        appDir: path.join(base, "Discord", "app-1.0.9256"),
        resourcesDir,
        asarPath,
        version: "1.0.9256",
      };
      // Fake injected state: receipt + backup next to app.asar.
      await fs.promises.writeFile(
        path.join(resourcesDir, RECEIPT_FILE),
        JSON.stringify({ tool: "vestra-injector", version: 1 }),
        "utf8",
      );
      await fs.promises.copyFile(asarPath, `${asarPath}${BACKUP_SUFFIX}`);

      __setRealFsForTests(asPatchedFs());
      assert.equal(isInjected(install), false, "patched fs misreports backup");
      __setRealFsForTests(asOriginalFs());
      assert.equal(isInjected(install), true, "real fs sees backup");
    } finally {
      await cleanup();
    }
  });

  test("asar driver still reads archive contents (not rewritten)", async () => {
    const srcDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-asar-src-"));
    const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-asar-out-"));
    try {
      await fs.promises.writeFile(
        path.join(srcDir, "package.json"),
        JSON.stringify({ name: "fake", main: "index.js" }),
        "utf8",
      );
      await fs.promises.writeFile(path.join(srcDir, "index.js"), "module.exports = 1;\n", "utf8");
      const asarPath = path.join(outDir, "app.asar");
      await packAsar(srcDir, asarPath);
      __setRealFsForTests(asOriginalFs());
      assert.equal(readAsarMain(asarPath), "index.js");
    } finally {
      await fs.promises.rm(srcDir, { recursive: true, force: true });
      await fs.promises.rm(outDir, { recursive: true, force: true });
    }
  });
});
