// Registry-prune tests for `vestra registry prune`.
// Fixture/temp directories only — never touches real Discord installs.
// Run with: bun test apps/installer  (also runs under `node --test`)
// Covers: stale 1156 vs active 1157, channel scoping, active-never-removed,
// missing-path pruning, custom-root retention, malformed/ambiguous retention,
// dry-run, atomic save, asar/receipt/backup mtime invariance.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BACKUP_SUFFIX, RECEIPT_FILE, packAsar, type DiscordChannel } from "@vestra/injector";
import { layoutHome } from "./home.js";
import { loadRegistry, saveRegistry, type InstallRegistry } from "./registry.js";
import { pruneStaleRecords, type OperationContext } from "./operations.js";
import { runCli, type CliIO } from "./cli.js";

interface Fixture {
  tmp: string;
  homeDir: string;
  registryPath: string;
  emptyEnvDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-prune-test-"));
  const homeDir = path.join(tmp, "home");
  const emptyEnvDir = path.join(tmp, "empty-env");
  await fs.promises.mkdir(homeDir, { recursive: true });
  await fs.promises.mkdir(emptyEnvDir, { recursive: true });
  return { tmp, homeDir, registryPath: layoutHome(homeDir).registryPath, emptyEnvDir };
}

/** Pack a minimal asar at <root>/app-<version>/resources/app.asar. Returns asarPath. */
async function makeVersionedAsar(rootDir: string, version: string): Promise<string> {
  const srcDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-asar-src-"));
  try {
    await fs.promises.writeFile(
      path.join(srcDir, "package.json"),
      JSON.stringify({ name: "fake-discord", version: "1.0.0", main: "index.js" }),
      "utf8",
    );
    await fs.promises.writeFile(path.join(srcDir, "index.js"), "module.exports = 42;\n", "utf8");
    const asarPath = path.join(rootDir, `app-${version}`, "resources", "app.asar");
    await fs.promises.mkdir(path.dirname(asarPath), { recursive: true });
    await packAsar(srcDir, asarPath);
    return asarPath;
  } finally {
    await fs.promises.rm(srcDir, { recursive: true, force: true });
  }
}

/** Isolated discovery env so real %LOCALAPPDATA%/Discord* installs never leak in. */
function isolatedEnv(fx: Fixture): Record<string, string | undefined> {
  return {
    LOCALAPPDATA: fx.emptyEnvDir,
    APPDATA: fx.emptyEnvDir,
    HOME: fx.emptyEnvDir,
    XDG_CONFIG_HOME: fx.emptyEnvDir,
  };
}

function ctxFor(fx: Fixture, extraRoots: Array<{ channel: DiscordChannel; rootDir: string }>): OperationContext {
  return { homeDir: fx.homeDir, discovery: { extraRoots, platform: "win32", env: isolatedEnv(fx) } };
}

function registryEntry(asarPath: string, channel: DiscordChannel, version: string) {
  const resourcesDir = path.dirname(asarPath);
  const appDir = path.dirname(resourcesDir);
  const base = path.basename(appDir);
  return {
    asarPath,
    channel,
    installVersion: version,
    payloadVersion: "0.0.0-test",
    at: new Date().toISOString(),
    appDir,
    rootDir: base.startsWith("app-") ? path.dirname(appDir) : appDir,
  };
}

function makeIO(): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    log: (m: string) => {
      lines.push(m);
    },
    error: (m: string) => {
      errors.push(m);
    },
  };
}

/** Run the CLI with real-install discovery sandboxed to an empty temp dir. */
async function runCliSandboxed(fx: Fixture, argv: string[], io: CliIO): Promise<number> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ["LOCALAPPDATA", "APPDATA", "HOME", "XDG_CONFIG_HOME"] as const) {
    saved[key] = process.env[key];
    process.env[key] = fx.emptyEnvDir;
  }
  try {
    return await runCli(argv, io);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

async function mtimeMs(p: string): Promise<number> {
  return (await fs.promises.stat(p)).mtimeMs;
}

describe("registry prune (metadata-only)", () => {
  test("removes stale Canary 1156, keeps active 1157, no Discord writes", async () => {
    const fx = await makeFixture();
    try {
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const oldAsar = await makeVersionedAsar(canaryRoot, "1.0.1156");
      const newAsar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      await saveRegistry(fx.registryPath, {
        [oldAsar]: registryEntry(oldAsar, "canary", "1.0.1156"),
        [newAsar]: registryEntry(newAsar, "canary", "1.0.1157"),
      });
      const beforeOld = await mtimeMs(oldAsar);
      const beforeNew = await mtimeMs(newAsar);

      const result = await pruneStaleRecords(ctxFor(fx, [{ channel: "canary", rootDir: canaryRoot }]), {
        channels: ["canary"],
      });
      assert.deepEqual(result.removed.map((r) => r.key), [oldAsar]);
      assert.equal(result.removed[0]?.reason, "superseded-version");
      assert.deepEqual(result.active, [newAsar]);

      const after = await loadRegistry(fx.registryPath);
      assert.deepEqual(Object.keys(after), [newAsar]);
      assert.equal(after[newAsar]?.installVersion, "1.0.1157");
      // Superseded dir still on disk (metadata-only); asar untouched.
      assert.equal(fs.existsSync(oldAsar), true);
      assert.equal(await mtimeMs(oldAsar), beforeOld);
      assert.equal(await mtimeMs(newAsar), beforeNew);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("--channel canary leaves Stable record logically unchanged", async () => {
    const fx = await makeFixture();
    try {
      const stableRoot = path.join(fx.tmp, "stable-root");
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const stableAsar = await makeVersionedAsar(stableRoot, "1.0.9001");
      const canaryAsar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      const goneAsar = path.join(fx.tmp, "canary-gone", "app-1.0.1156", "resources", "app.asar");
      const stableBefore = registryEntry(stableAsar, "stable", "1.0.9001");
      await saveRegistry(fx.registryPath, {
        [stableAsar]: stableBefore,
        [canaryAsar]: registryEntry(canaryAsar, "canary", "1.0.1157"),
        [goneAsar]: registryEntry(goneAsar, "canary", "1.0.1156"),
      });

      const io = makeIO();
      const code = await runCliSandboxed(
        fx,
        ["registry", "prune", "--home", fx.homeDir, "--root", `stable:${stableRoot}`, "--root", `canary:${canaryRoot}`, "--channel", "canary"],
        io,
      );
      assert.equal(code, 0);
      const after = await loadRegistry(fx.registryPath);
      assert.deepEqual(after[stableAsar], stableBefore);
      assert.ok(after[canaryAsar] !== undefined);
      assert.ok(after[goneAsar] === undefined);
      assert.ok(io.lines.some((l) => l.includes("Removed 1 stale registry record.")));
      assert.ok(io.lines.some((l) => l.includes("No Discord files modified.")));
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("active record is never removed", async () => {
    const fx = await makeFixture();
    try {
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const asar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      await saveRegistry(fx.registryPath, { [asar]: registryEntry(asar, "canary", "1.0.1157") });
      const result = await pruneStaleRecords(ctxFor(fx, [{ channel: "canary", rootDir: canaryRoot }]));
      assert.deepEqual(result.removed, []);
      assert.deepEqual(result.active, [asar]);
      assert.deepEqual(Object.keys(await loadRegistry(fx.registryPath)), [asar]);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("historical path that no longer exists is pruned", async () => {
    const fx = await makeFixture();
    try {
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const activeAsar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      const goneAsar = path.join(fx.tmp, "wiped", "app-1.0.1156", "resources", "app.asar");
      await saveRegistry(fx.registryPath, {
        [activeAsar]: registryEntry(activeAsar, "canary", "1.0.1157"),
        [goneAsar]: registryEntry(goneAsar, "canary", "1.0.1156"),
      });
      const result = await pruneStaleRecords(ctxFor(fx, [{ channel: "canary", rootDir: canaryRoot }]));
      assert.deepEqual(result.removed.map((r) => r.key), [goneAsar]);
      assert.equal(result.removed[0]?.reason, "installation-missing");
      assert.deepEqual(Object.keys(await loadRegistry(fx.registryPath)), [activeAsar]);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("custom explicit root that still exists is kept despite a newer version elsewhere", async () => {
    const fx = await makeFixture();
    try {
      const rootA = path.join(fx.tmp, "portable-a");
      const rootB = path.join(fx.tmp, "portable-b");
      const oldAsar = await makeVersionedAsar(rootA, "1.0.1156");
      const newAsar = await makeVersionedAsar(rootB, "1.0.1157");
      await saveRegistry(fx.registryPath, {
        [oldAsar]: registryEntry(oldAsar, "canary", "1.0.1156"),
        [newAsar]: registryEntry(newAsar, "canary", "1.0.1157"),
      });
      const result = await pruneStaleRecords(
        ctxFor(fx, [
          { channel: "canary", rootDir: rootA },
          { channel: "canary", rootDir: rootB },
        ]),
      );
      assert.deepEqual(result.removed, []);
      assert.deepEqual(new Set(result.active), new Set([oldAsar, newAsar]));
      assert.deepEqual(new Set(Object.keys(await loadRegistry(fx.registryPath))), new Set([oldAsar, newAsar]));
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("malformed/legacy ambiguous records are retained and reported", async () => {
    const fx = await makeFixture();
    try {
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const activeAsar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      const goneAsar = path.join(fx.tmp, "wiped", "app-1.0.1156", "resources", "app.asar");
      await fs.promises.writeFile(
        fx.registryPath,
        JSON.stringify(
          {
            [activeAsar]: registryEntry(activeAsar, "canary", "1.0.1157"),
            [goneAsar]: registryEntry(goneAsar, "canary", "1.0.1156"),
            "garbage-key": "not-an-object",
            "C:\\weird\\location.dat": { asarPath: "C:\\weird\\location.dat", channel: "canary" },
          },
          null,
          2,
        ),
        "utf8",
      );
      const result = await pruneStaleRecords(ctxFor(fx, [{ channel: "canary", rootDir: canaryRoot }]));
      assert.deepEqual(result.removed.map((r) => r.key), [goneAsar]);
      const reasons = new Map(result.skipped.map((s) => [s.key, s.reason]));
      assert.equal(reasons.get("garbage-key"), "malformed");
      assert.equal(reasons.get("C:\\weird\\location.dat"), "ambiguous");
      const raw = JSON.parse(await fs.promises.readFile(fx.registryPath, "utf8")) as Record<string, unknown>;
      assert.ok("garbage-key" in raw);
      assert.ok("C:\\weird\\location.dat" in raw);
      assert.ok(!(goneAsar in raw));
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("--dry-run reports stale but changes nothing", async () => {
    const fx = await makeFixture();
    try {
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const activeAsar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      const goneAsar = path.join(fx.tmp, "wiped", "app-1.0.1156", "resources", "app.asar");
      await saveRegistry(fx.registryPath, {
        [activeAsar]: registryEntry(activeAsar, "canary", "1.0.1157"),
        [goneAsar]: registryEntry(goneAsar, "canary", "1.0.1156"),
      });
      const contentBefore = await fs.promises.readFile(fx.registryPath, "utf8");
      const mtimeBefore = await mtimeMs(fx.registryPath);

      const io = makeIO();
      const code = await runCliSandboxed(
        fx,
        ["registry", "prune", "--home", fx.homeDir, "--root", `canary:${canaryRoot}`, "--dry-run"],
        io,
      );
      assert.equal(code, 0);
      assert.ok(io.lines.some((l) => l.startsWith("would remove:")));
      assert.ok(io.lines.some((l) => l.includes("No changes made (dry run).")));
      assert.equal(await fs.promises.readFile(fx.registryPath, "utf8"), contentBefore);
      assert.equal(await mtimeMs(fx.registryPath), mtimeBefore);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("registry save remains atomic (no tmp leftovers, valid JSON)", async () => {
    const fx = await makeFixture();
    try {
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const activeAsar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      const goneAsar = path.join(fx.tmp, "wiped", "app-1.0.1156", "resources", "app.asar");
      await saveRegistry(fx.registryPath, {
        [activeAsar]: registryEntry(activeAsar, "canary", "1.0.1157"),
        [goneAsar]: registryEntry(goneAsar, "canary", "1.0.1156"),
      });
      await pruneStaleRecords(ctxFor(fx, [{ channel: "canary", rootDir: canaryRoot }]));
      const names = await fs.promises.readdir(fx.homeDir);
      assert.ok(!names.some((n) => n.endsWith(".tmp")));
      const parsed = JSON.parse(await fs.promises.readFile(fx.registryPath, "utf8")) as InstallRegistry;
      assert.deepEqual(Object.keys(parsed), [activeAsar]);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("app.asar bytes are unchanged during prune", async () => {
    const fx = await makeFixture();
    try {
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const oldAsar = await makeVersionedAsar(canaryRoot, "1.0.1156");
      const newAsar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      await saveRegistry(fx.registryPath, {
        [oldAsar]: registryEntry(oldAsar, "canary", "1.0.1156"),
        [newAsar]: registryEntry(newAsar, "canary", "1.0.1157"),
      });
      const hashOld = sha256File(oldAsar);
      const hashNew = sha256File(newAsar);
      const mtimeOld = await mtimeMs(oldAsar);
      const mtimeNew = await mtimeMs(newAsar);
      await pruneStaleRecords(ctxFor(fx, [{ channel: "canary", rootDir: canaryRoot }]), { channels: ["canary"] });
      assert.equal(sha256File(oldAsar), hashOld);
      assert.equal(sha256File(newAsar), hashNew);
      assert.equal(await mtimeMs(oldAsar), mtimeOld);
      assert.equal(await mtimeMs(newAsar), mtimeNew);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("receipt/backup files remain unchanged during prune", async () => {
    const fx = await makeFixture();
    try {
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const activeAsar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      const resourcesDir = path.dirname(activeAsar);
      const receiptPath = path.join(resourcesDir, RECEIPT_FILE);
      const backupPath = `${activeAsar}${BACKUP_SUFFIX}`;
      await fs.promises.writeFile(receiptPath, JSON.stringify({ v: 1 }), "utf8");
      await fs.promises.copyFile(activeAsar, backupPath);
      const goneAsar = path.join(fx.tmp, "wiped", "app-1.0.1156", "resources", "app.asar");
      await saveRegistry(fx.registryPath, {
        [activeAsar]: registryEntry(activeAsar, "canary", "1.0.1157"),
        [goneAsar]: registryEntry(goneAsar, "canary", "1.0.1156"),
      });
      const hashReceipt = sha256File(receiptPath);
      const hashBackup = sha256File(backupPath);
      const mtimeReceipt = await mtimeMs(receiptPath);
      const mtimeBackup = await mtimeMs(backupPath);
      await pruneStaleRecords(ctxFor(fx, [{ channel: "canary", rootDir: canaryRoot }]));
      assert.equal(sha256File(receiptPath), hashReceipt);
      assert.equal(sha256File(backupPath), hashBackup);
      assert.equal(await mtimeMs(receiptPath), mtimeReceipt);
      assert.equal(await mtimeMs(backupPath), mtimeBackup);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("nothing stale reports success; invalid usage exits 2", async () => {
    const fx = await makeFixture();
    try {
      const canaryRoot = path.join(fx.tmp, "canary-root");
      const activeAsar = await makeVersionedAsar(canaryRoot, "1.0.1157");
      await saveRegistry(fx.registryPath, { [activeAsar]: registryEntry(activeAsar, "canary", "1.0.1157") });

      const ioClean = makeIO();
      const cleanCode = await runCliSandboxed(
        fx,
        ["registry", "prune", "--home", fx.homeDir, "--root", `canary:${canaryRoot}`],
        ioClean,
      );
      assert.equal(cleanCode, 0);
      assert.ok(ioClean.lines.some((l) => l.includes("No stale registry records found.")));

      for (const argv of [
        ["registry"],
        ["registry", "frobnicate", "--home", fx.homeDir],
        ["registry", "prune", "--home", fx.homeDir, "--bogus"],
        ["registry", "prune", "--home", fx.homeDir, "--force"],
      ]) {
        const io = makeIO();
        assert.equal(await runCliSandboxed(fx, argv, io), 2);
      }
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });
});
