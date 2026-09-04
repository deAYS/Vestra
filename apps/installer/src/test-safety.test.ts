// Test-safety tests for the centralized destructive-test guard.
// Fixture/temp directories only — never touches real Discord installs.
// All discovery roots are faked (fake LocalAppData, empty sandbox envs).
// Run with: bun test apps/installer  (also runs under `node --test`)
//
// Covers the required matrix:
//  1. sentinel fixture => allowed
//  2. temp path without sentinel => denied (+ override off by default)
//  3-5. simulated %LOCALAPPDATA% Discord/DiscordPTB/DiscordCanary => denied
//  6. nested version path => denied
//  7. direct low-level applyInject bypassing the CLI => denied
//  8. read-only check => allowed
//  9. read-only status => allowed (function + CLI)
//  10. registry prune --dry-run => allowed, registry unchanged
//  11. VESTRA_ALLOW_LIVE_TESTS=1 => permits + warns
//  12. production/non-test context => normal installer behavior unchanged
//  13. Windows path case differences => still denied
//  14. `..` path spellings => still denied
// Plus: explicit-first test-mode detection, env-fallback denial, Vestra
// home protection (real home / arbitrary home denied, sandbox allowed),
// and a CLI `check --repair` accident reproduction against default
// discovery (the incident class that motivated this guard).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BACKUP_SUFFIX,
  RECEIPT_FILE,
  applyInject,
  isInjected,
  listInstalls,
  packAsar,
  planInject,
  uninject,
  type DiscordChannel,
  type DiscordInstall,
  type InjectPlan,
  type PayloadSources,
} from "@vestra/injector";
import {
  LIVE_OVERRIDE_WARNING,
  TEST_SENTINEL,
  assertDestructiveTestTargetAllowed,
  assertTestHomeAllowed,
  isLiveOverrideEnabled,
  isTestMode,
} from "@vestra/shared/node/testSafety.js";
import { checkHealth, installAll, pruneStaleRecords, statusAll, type OperationContext } from "./operations.js";
import { runCli, type CliIO } from "./cli.js";
import { layoutHome } from "./home.js";
import { loadRegistry, saveRegistry } from "./registry.js";
import { createTestDiscordInstall, isolatedEnv, writeTestBundle } from "./test-fixtures.js";

const ENV_KEYS = [
  "VESTRA_TEST",
  "VESTRA_ALLOW_LIVE_TESTS",
  "LOCALAPPDATA",
  "APPDATA",
  "HOME",
  "XDG_CONFIG_HOME",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) out[k] = process.env[k];
  return out;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearSafetyEnv(): void {
  delete process.env["VESTRA_TEST"];
  delete process.env["VESTRA_ALLOW_LIVE_TESTS"];
}

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function testPayload(): PayloadSources {
  return {
    bundleSource: "// vestra test bundle",
    preloadSource: "// vestra test preload",
    mainHookSource: "// vestra test hook",
    loaderSource: "// vestra test loader",
  };
}

/** Pack a minimal asar WITHOUT a sentinel (negative-identity fixture). */
async function packBareAsar(root: string, version: string): Promise<string> {
  const srcDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-asar-src-"));
  try {
    await fs.promises.writeFile(
      path.join(srcDir, "package.json"),
      JSON.stringify({ name: "fake-discord", version: "1.0.0", main: "index.js" }),
      "utf8",
    );
    await fs.promises.writeFile(path.join(srcDir, "index.js"), "module.exports = 42;\n", "utf8");
    const asarPath = path.join(root, `app-${version}`, "resources", "app.asar");
    await fs.promises.mkdir(path.dirname(asarPath), { recursive: true });
    await packAsar(srcDir, asarPath);
    return asarPath;
  } finally {
    await fs.promises.rm(srcDir, { recursive: true, force: true });
  }
}

interface FakeLocal {
  base: string;
  local: string;
  asar: Record<"stable" | "ptb" | "canary", string>;
  cleanup(): Promise<void>;
}

/** Simulated %LOCALAPPDATA% with all three channels (fake dirs, fake asars). */
async function makeFakeLocalAppData(version = "1.0.2000"): Promise<FakeLocal> {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-fake-local-"));
  const local = path.join(base, "LocalAppData");
  const names = { stable: "Discord", ptb: "DiscordPTB", canary: "DiscordCanary" } as const;
  const asar = {} as Record<"stable" | "ptb" | "canary", string>;
  for (const channel of Object.keys(names) as Array<"stable" | "ptb" | "canary">) {
    asar[channel] = await packBareAsar(path.join(local, names[channel]), version);
  }
  return { base, local, asar, cleanup: () => fs.promises.rm(base, { recursive: true, force: true }) };
}

/** Discovery simulating default Windows discovery against the fake LocalAppData. */
function fakeLocalDiscovery(fake: FakeLocal): {
  platform: string;
  env: Record<string, string | undefined>;
} {
  return { platform: "win32", env: { LOCALAPPDATA: fake.local } };
}

function findChannelInstalls(discovery: {
  platform: string;
  env: Record<string, string | undefined>;
}): DiscordInstall[] {
  return listInstalls(discovery);
}

function mustFind(installs: DiscordInstall[], channel: DiscordChannel): DiscordInstall {
  const found = installs.find((i) => i.channel === channel);
  assert.ok(found !== undefined, `expected a ${channel} install in discovery`);
  return found;
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

describe("test-safety guard", () => {
  test("test mode detection is explicit-first; override off by default", async () => {
    const saved = snapshotEnv();
    try {
      clearSafetyEnv();
      assert.equal(isTestMode(undefined), false);
      assert.equal(isLiveOverrideEnabled(), false);
      process.env["VESTRA_TEST"] = "1";
      assert.equal(isTestMode(undefined), true);
      assert.equal(isTestMode(false), false);
      assert.equal(isTestMode(true), true);
      // Override is never default true, even in test mode.
      assert.equal(isLiveOverrideEnabled(), false);
      process.env["VESTRA_ALLOW_LIVE_TESTS"] = "0";
      assert.equal(isLiveOverrideEnabled(), false);
      process.env["VESTRA_ALLOW_LIVE_TESTS"] = "1";
      assert.equal(isLiveOverrideEnabled(), true);
    } finally {
      restoreEnv(saved);
    }
  });

  test("1. safe fixture with sentinel: destructive operation allowed", async () => {
    const saved = snapshotEnv();
    const fx = await createTestDiscordInstall({ channel: "canary", version: "1.0.0" });
    try {
      clearSafetyEnv();
      // Positive fixture identity: the sentinel exists.
      assert.equal(fs.statSync(path.join(fx.root, TEST_SENTINEL)).isFile(), true);
      // Env-only discovery (no extraRoots): the sentinel alone must allow.
      const emptyDir = path.join(fx.base, "empty-env");
      await fs.promises.mkdir(emptyDir, { recursive: true });
      const safety = { testMode: true, discovery: { platform: "win32", env: isolatedEnv(emptyDir) } };
      const { plan } = planInject(
        {
          channel: fx.channel,
          rootDir: fx.root,
          appDir: fx.appDir,
          resourcesDir: fx.resourcesDir,
          asarPath: fx.asarPath,
          version: fx.version,
        },
        testPayload(),
        safety,
      );
      await applyInject(plan, testPayload(), safety);
      assert.equal(isInjected(plan.install), true);
      await uninject(plan.install, safety);
      assert.equal(isInjected(plan.install), false);
    } finally {
      await fx.cleanup();
      restoreEnv(saved);
    }
  });

  test("2. temp path without sentinel: destructive operation denied", async () => {
    const saved = snapshotEnv();
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-no-sentinel-"));
    try {
      clearSafetyEnv();
      const asarPath = await packBareAsar(path.join(base, "bare-root"), "1.0.0");
      const hashBefore = sha256File(asarPath);
      const emptyDir = path.join(base, "empty-env");
      await fs.promises.mkdir(emptyDir, { recursive: true });
      const discovery = { platform: "win32", env: isolatedEnv(emptyDir) };
      const install: DiscordInstall = {
        channel: "canary",
        rootDir: path.join(base, "bare-root"),
        appDir: path.join(base, "bare-root", "app-1.0.0"),
        resourcesDir: path.join(base, "bare-root", "app-1.0.0", "resources"),
        asarPath,
        version: "1.0.0",
      };
      assert.throws(
        () => assertDestructiveTestTargetAllowed(asarPath, { testMode: true, discovery }),
        /no .*fixture identity/,
      );
      assert.throws(() => planInject(install, testPayload(), { testMode: true, discovery }), /Refusing destructive test write/);
      assert.equal(sha256File(asarPath), hashBefore);
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });

  test("3. simulated %LOCALAPPDATA%\\Discord (stable): denied", async () => {
    const saved = snapshotEnv();
    const fake = await makeFakeLocalAppData();
    try {
      clearSafetyEnv();
      const discovery = fakeLocalDiscovery(fake);
      const install = mustFind(findChannelInstalls(discovery), "stable");
      const hashBefore = sha256File(install.asarPath);
      assert.throws(
        () => planInject(install, testPayload(), { testMode: true, discovery }),
        /real Discord install/,
      );
      assert.equal(sha256File(install.asarPath), hashBefore);
      assert.equal(fs.existsSync(`${install.asarPath}${BACKUP_SUFFIX}`), false);
    } finally {
      await fake.cleanup();
      restoreEnv(saved);
    }
  });

  test("4. simulated %LOCALAPPDATA%\\DiscordPTB (ptb): denied", async () => {
    const saved = snapshotEnv();
    const fake = await makeFakeLocalAppData();
    try {
      clearSafetyEnv();
      const discovery = fakeLocalDiscovery(fake);
      const install = mustFind(findChannelInstalls(discovery), "ptb");
      const hashBefore = sha256File(install.asarPath);
      assert.throws(
        () => planInject(install, testPayload(), { testMode: true, discovery }),
        /real Discord install/,
      );
      assert.equal(sha256File(install.asarPath), hashBefore);
    } finally {
      await fake.cleanup();
      restoreEnv(saved);
    }
  });

  test("5. simulated %LOCALAPPDATA%\\DiscordCanary (canary): denied", async () => {
    const saved = snapshotEnv();
    const fake = await makeFakeLocalAppData();
    try {
      clearSafetyEnv();
      const discovery = fakeLocalDiscovery(fake);
      const install = mustFind(findChannelInstalls(discovery), "canary");
      const hashBefore = sha256File(install.asarPath);
      assert.throws(
        () => planInject(install, testPayload(), { testMode: true, discovery }),
        /real Discord install/,
      );
      assert.equal(sha256File(install.asarPath), hashBefore);
    } finally {
      await fake.cleanup();
      restoreEnv(saved);
    }
  });

  test("6. nested version path DiscordCanary/app-*/resources/app.asar: denied", async () => {
    const saved = snapshotEnv();
    const fake = await makeFakeLocalAppData("1.0.2000");
    try {
      clearSafetyEnv();
      const discovery = fakeLocalDiscovery(fake);
      const install = mustFind(findChannelInstalls(discovery), "canary");
      assert.ok(install.asarPath.includes(path.join("app-1.0.2000", "resources")));
      const hashBefore = sha256File(install.asarPath);
      assert.throws(
        () => planInject(install, testPayload(), { testMode: true, discovery }),
        /real Discord install/,
      );
      // Direct uninject against the nested path is denied even with no CLI.
      await assert.rejects(uninject(install, { testMode: true, discovery }), /Refusing destructive test write/);
      assert.equal(sha256File(install.asarPath), hashBefore);
    } finally {
      await fake.cleanup();
      restoreEnv(saved);
    }
  });

  test("7. direct low-level applyInject bypassing the CLI: denied", async () => {
    const saved = snapshotEnv();
    const fake = await makeFakeLocalAppData();
    try {
      clearSafetyEnv();
      const discovery = fakeLocalDiscovery(fake);
      const install = mustFind(findChannelInstalls(discovery), "canary");
      const hashBefore = sha256File(install.asarPath);
      const plan: InjectPlan = {
        install,
        mainEntry: "index.js",
        backupPath: `${install.asarPath}${BACKUP_SUFFIX}`,
        receiptPath: path.join(install.resourcesDir, RECEIPT_FILE),
        receipt: {
          tool: "vestra-injector",
          version: 1,
          channel: install.channel,
          installVersion: install.version,
          mainEntry: "index.js",
          backedUp: true,
          at: new Date().toISOString(),
        },
        hookLines: ["// __VESTRA_HOOK__"],
      };
      await assert.rejects(
        applyInject(plan, testPayload(), { testMode: true, discovery }),
        /real Discord install/,
      );
      // Nothing was written: no backup, no receipt, asar bytes identical.
      assert.equal(fs.existsSync(plan.backupPath), false);
      assert.equal(fs.existsSync(plan.receiptPath), false);
      assert.equal(sha256File(install.asarPath), hashBefore);
    } finally {
      await fake.cleanup();
      restoreEnv(saved);
    }
  });

  test("8. read-only check is allowed in test mode", async () => {
    const saved = snapshotEnv();
    const fx = await createTestDiscordInstall({ channel: "stable", version: "1.0.0" });
    try {
      clearSafetyEnv();
      const emptyDir = path.join(fx.base, "empty-env");
      await fs.promises.mkdir(emptyDir, { recursive: true });
      const homeDir = path.join(fx.base, "home");
      const bundlePath = await writeTestBundle(path.join(fx.base, "bundle"));
      const discovery = {
        extraRoots: [{ channel: fx.channel, rootDir: fx.root }],
        platform: "win32",
        env: isolatedEnv(emptyDir),
      };
      const installed = await installAll({ homeDir, bundlePath, discovery });
      assert.equal(installed.results.length, 1);
      assert.equal(installed.results[0]?.ok, true);
      // Read-only health check with explicit test mode: allowed, healthy.
      const testCtx: OperationContext = { homeDir, bundlePath, discovery, testMode: true };
      const installs = listInstalls(discovery);
      assert.equal(installs.length, 1);
      const first = installs[0];
      assert.ok(first !== undefined);
      const report = await checkHealth(testCtx, first);
      assert.equal(report.healthy, true);
    } finally {
      await fx.cleanup();
      restoreEnv(saved);
    }
  });

  test("9. read-only status is allowed in test mode (function + CLI)", async () => {
    const saved = snapshotEnv();
    const fx = await createTestDiscordInstall({ channel: "canary", version: "1.0.0" });
    try {
      clearSafetyEnv();
      const emptyDir = path.join(fx.base, "empty-env");
      await fs.promises.mkdir(emptyDir, { recursive: true });
      const homeDir = path.join(fx.base, "home");
      const bundlePath = await writeTestBundle(path.join(fx.base, "bundle"));
      const discovery = {
        extraRoots: [{ channel: fx.channel, rootDir: fx.root }],
        platform: "win32",
        env: isolatedEnv(emptyDir),
      };
      await installAll({ homeDir, bundlePath, discovery });
      const testCtx: OperationContext = { homeDir, bundlePath, discovery, testMode: true };
      const { health } = await statusAll(testCtx);
      assert.equal(health.length, 1);
      assert.equal(health.every((h) => h.healthy), true);
      // CLI status under VESTRA_TEST=1 with sandboxed process env: allowed.
      for (const key of ["LOCALAPPDATA", "APPDATA", "HOME", "XDG_CONFIG_HOME"] as const) {
        process.env[key] = emptyDir;
      }
      process.env["VESTRA_TEST"] = "1";
      const io = makeIO();
      const code = await runCli(
        ["status", "--home", homeDir, "--bundle", bundlePath, "--root", `canary:${fx.root}`],
        io,
      );
      assert.equal(code, 0);
    } finally {
      await fx.cleanup();
      restoreEnv(saved);
    }
  });

  test("10. registry prune --dry-run is allowed and changes nothing", async () => {
    const saved = snapshotEnv();
    const fx = await createTestDiscordInstall({ channel: "canary", version: "1.0.0" });
    try {
      clearSafetyEnv();
      const emptyDir = path.join(fx.base, "empty-env");
      await fs.promises.mkdir(emptyDir, { recursive: true });
      const homeDir = path.join(fx.base, "home");
      await fs.promises.mkdir(homeDir, { recursive: true });
      const { registryPath } = layoutHome(homeDir);
      const goneAsar = path.join(fx.base, "wiped", "app-1.0.2000", "resources", "app.asar");
      await saveRegistry(registryPath, {
        [fx.asarPath]: registryEntry(fx.asarPath, "canary", "1.0.0"),
        [goneAsar]: registryEntry(goneAsar, "canary", "1.0.2000"),
      });
      const contentBefore = await fs.promises.readFile(registryPath, "utf8");
      const discovery = {
        extraRoots: [{ channel: fx.channel, rootDir: fx.root }],
        platform: "win32",
        env: isolatedEnv(emptyDir),
      };
      const dry = await pruneStaleRecords({ homeDir, discovery, testMode: true }, { dryRun: true });
      assert.deepEqual(dry.removed.map((r) => r.key), [goneAsar]);
      assert.equal(await fs.promises.readFile(registryPath, "utf8"), contentBefore);
      // CLI dry-run under VESTRA_TEST=1: allowed, exit 0.
      for (const key of ["LOCALAPPDATA", "APPDATA", "HOME", "XDG_CONFIG_HOME"] as const) {
        process.env[key] = emptyDir;
      }
      process.env["VESTRA_TEST"] = "1";
      const io = makeIO();
      const code = await runCli(
        ["registry", "prune", "--home", homeDir, "--root", `canary:${fx.root}`, "--dry-run"],
        io,
      );
      assert.equal(code, 0);
      assert.ok(io.lines.some((l) => l.includes("No changes made (dry run).")));
      assert.equal(await fs.promises.readFile(registryPath, "utf8"), contentBefore);
    } finally {
      await fx.cleanup();
      restoreEnv(saved);
    }
  });

  test("11. VESTRA_ALLOW_LIVE_TESTS=1 permits live-test writes with a warning", async () => {
    const saved = snapshotEnv();
    const fake = await makeFakeLocalAppData();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      clearSafetyEnv();
      process.env["VESTRA_ALLOW_LIVE_TESTS"] = "1";
      assert.equal(isLiveOverrideEnabled(), true);
      const discovery = fakeLocalDiscovery(fake);
      const install = mustFind(findChannelInstalls(discovery), "canary");
      const safety = { testMode: true, discovery };
      const { plan } = planInject(install, testPayload(), safety);
      await applyInject(plan, testPayload(), safety);
      assert.equal(isInjected(plan.install), true);
      await uninject(plan.install, safety);
      assert.equal(isInjected(plan.install), false);
      assert.ok(warnings.some((w) => w.includes(LIVE_OVERRIDE_WARNING)));
    } finally {
      console.warn = originalWarn;
      await fake.cleanup();
      restoreEnv(saved);
    }
  });

  test("12. production context: normal installer behavior unchanged (no sentinel needed)", async () => {
    const saved = snapshotEnv();
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-prod-check-"));
    try {
      clearSafetyEnv();
      const asarPath = await packBareAsar(path.join(base, "prod-root"), "1.0.0");
      void asarPath;
      const emptyDir = path.join(base, "empty-env");
      await fs.promises.mkdir(emptyDir, { recursive: true });
      const homeDir = path.join(base, "home");
      const bundlePath = await writeTestBundle(path.join(base, "bundle"));
      const discovery = {
        extraRoots: [{ channel: "canary" as DiscordChannel, rootDir: path.join(base, "prod-root") }],
        platform: "win32",
        env: isolatedEnv(emptyDir),
      };
      // No testMode, no VESTRA_TEST: bare tmp install without sentinel works.
      const batch = await installAll({ homeDir, bundlePath, discovery });
      assert.equal(batch.results.length, 1);
      assert.equal(batch.results[0]?.ok, true);
      assert.equal(batch.results[0]?.action, "installed");
      // Explicit testMode:false wins over VESTRA_TEST=1 (authoritative).
      process.env["VESTRA_TEST"] = "1";
      const prodCtx: OperationContext = { homeDir, bundlePath, discovery, testMode: false };
      const forced = await installAll(prodCtx, { force: true });
      assert.equal(forced.results[0]?.ok, true);
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });

  test("env fallback: VESTRA_TEST=1 denies unsafe targets without explicit context", async () => {
    const saved = snapshotEnv();
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-env-fallback-"));
    try {
      clearSafetyEnv();
      process.env["VESTRA_TEST"] = "1";
      const asarPath = await packBareAsar(path.join(base, "bare-root"), "1.0.0");
      const install: DiscordInstall = {
        channel: "canary",
        rootDir: path.join(base, "bare-root"),
        appDir: path.join(base, "bare-root", "app-1.0.0"),
        resourcesDir: path.join(base, "bare-root", "app-1.0.0", "resources"),
        asarPath,
        version: "1.0.0",
      };
      // No testMode in context: env fallback activates the guard.
      assert.throws(() => planInject(install, testPayload()), /Refusing destructive test write/);
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });

  test("13. Windows path case differences cannot bypass protection", async () => {
    const saved = snapshotEnv();
    const fake = await makeFakeLocalAppData();
    try {
      clearSafetyEnv();
      const discovery = fakeLocalDiscovery(fake);
      const install = mustFind(findChannelInstalls(discovery), "canary");
      assert.ok(install.asarPath.includes("DiscordCanary"));
      const casedAsar = install.asarPath.replace("DiscordCanary", "DISCORDCANARY");
      assert.notEqual(casedAsar, install.asarPath);
      const cased: DiscordInstall = { ...install, asarPath: casedAsar };
      assert.throws(
        () => planInject(cased, testPayload(), { testMode: true, discovery }),
        /real Discord install/,
      );
    } finally {
      await fake.cleanup();
      restoreEnv(saved);
    }
  });

  test("14. `..` path spellings cannot bypass protection", async () => {
    const saved = snapshotEnv();
    const fake = await makeFakeLocalAppData("1.0.2000");
    try {
      clearSafetyEnv();
      const discovery = fakeLocalDiscovery(fake);
      const install = mustFind(findChannelInstalls(discovery), "canary");
      // Build the raw string manually: path.join() would normalize the
      // `..` away, but a hostile/odd spelling can arrive as a raw string.
      const dotted =
        `${fake.local}\\DiscordCanary\\..\\DiscordCanary\\app-1.0.2000\\resources\\app.asar`;
      assert.ok(dotted.includes("..")); // the traversal spelling is literal here
      assert.notEqual(dotted, install.asarPath);
      const traversed: DiscordInstall = { ...install, asarPath: dotted };
      assert.throws(
        () => planInject(traversed, testPayload(), { testMode: true, discovery }),
        /real Discord install/,
      );
    } finally {
      await fake.cleanup();
      restoreEnv(saved);
    }
  });

  test("15. Vestra home protection: real home denied, sandbox allowed", async () => {
    const saved = snapshotEnv();
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-home-guard-"));
    try {
      clearSafetyEnv();
      const fakeAppData = path.join(base, "Roaming");
      await fs.promises.mkdir(fakeAppData, { recursive: true });
      const fakeRealHome = path.join(fakeAppData, "Vestra");
      await fs.promises.mkdir(fakeRealHome, { recursive: true });
      const discovery = { platform: "win32", env: { APPDATA: fakeAppData, LOCALAPPDATA: base } };
      // Real home (syntactic, faked): denied.
      assert.throws(
        () => assertTestHomeAllowed(fakeRealHome, { testMode: true, discovery }),
        /real Vestra home/,
      );
      // Sandbox home under os.tmpdir(): allowed.
      const sandboxHome = path.join(base, "sandbox-home");
      await fs.promises.mkdir(sandboxHome, { recursive: true });
      assert.doesNotThrow(() => assertTestHomeAllowed(sandboxHome, { testMode: true, discovery }));
      // Arbitrary non-tmpdir location: denied (fail closed).
      const arbitrary = path.join(path.dirname(os.tmpdir()), "vestra-arbitrary-home-probe");
      assert.throws(
        () => assertTestHomeAllowed(arbitrary, { testMode: true, discovery }),
        /outside sandbox home/,
      );
      // Override permits the real home, but warns.
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };
      try {
        process.env["VESTRA_ALLOW_LIVE_TESTS"] = "1";
        assert.doesNotThrow(() => assertTestHomeAllowed(fakeRealHome, { testMode: true, discovery }));
        assert.ok(warnings.some((w) => w.includes(LIVE_OVERRIDE_WARNING)));
      } finally {
        console.warn = originalWarn;
      }
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });

  test("16. registry writes to a real home are denied in test mode", async () => {
    const saved = snapshotEnv();
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-home-prune-"));
    try {
      clearSafetyEnv();
      const fakeAppData = path.join(base, "Roaming");
      await fs.promises.mkdir(fakeAppData, { recursive: true });
      const fakeRealHome = path.join(fakeAppData, "Vestra");
      await fs.promises.mkdir(fakeRealHome, { recursive: true });
      const discovery = { platform: "win32", env: { APPDATA: fakeAppData, LOCALAPPDATA: base } };
      const goneAsar = path.join(base, "wiped", "app-1.0.2000", "resources", "app.asar");
      await saveRegistry(layoutHome(fakeRealHome).registryPath, {
        [goneAsar]: registryEntry(goneAsar, "canary", "1.0.2000"),
      });
      await assert.rejects(
        pruneStaleRecords({ homeDir: fakeRealHome, discovery, testMode: true }, {}),
        /real Vestra home/,
      );
      // Registry untouched.
      const after = await loadRegistry(layoutHome(fakeRealHome).registryPath);
      assert.deepEqual(Object.keys(after), [goneAsar]);
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });

  test("17. CLI check --repair in test mode cannot patch default-discovered installs", async () => {
    const saved = snapshotEnv();
    const fake = await makeFakeLocalAppData();
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-repair-accident-"));
    try {
      clearSafetyEnv();
      const homeDir = path.join(work, "home");
      const bundlePath = await writeTestBundle(path.join(work, "bundle"));
      const emptyDir = path.join(work, "empty-env");
      await fs.promises.mkdir(emptyDir, { recursive: true });
      const hashesBefore = new Map<string, string>();
      for (const asar of Object.values(fake.asar)) hashesBefore.set(asar, sha256File(asar));
      // Simulate the original accident: test-mode process, default discovery
      // pointed at "real" installs, destructive `check --repair`, no --root.
      process.env["LOCALAPPDATA"] = fake.local;
      process.env["APPDATA"] = fake.local;
      process.env["HOME"] = emptyDir;
      process.env["XDG_CONFIG_HOME"] = emptyDir;
      process.env["VESTRA_TEST"] = "1";
      const io = makeIO();
      const code = await runCli(["check", "--repair", "--home", homeDir, "--bundle", bundlePath], io);
      assert.equal(code, 1);
      assert.ok(io.lines.some((l) => l.includes("Refusing destructive test write")));
      for (const [asar, hash] of hashesBefore) {
        assert.equal(sha256File(asar), hash);
        assert.equal(fs.existsSync(`${asar}${BACKUP_SUFFIX}`), false);
        assert.equal(fs.existsSync(path.join(path.dirname(asar), RECEIPT_FILE)), false);
      }
    } finally {
      await fake.cleanup();
      await fs.promises.rm(work, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });
});
