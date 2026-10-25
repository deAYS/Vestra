// Installer service tests (programmatic API over the same engine as the CLI).
// Fixture/temp directories only — never touches real Discord installs.
// Run with: bun test apps/installer  (also runs under `node --test`)

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { packAsar, type DiscordChannel } from "@vestra/injector";
import { layoutHome } from "./home.js";
import { loadRegistry, saveRegistry } from "./registry.js";
import { runCli, type CliIO } from "./cli.js";
import {
  createInstallerService,
  type InstallerProgressEvent,
  type InstallerServiceContext,
} from "./service.js";
import {
  createTestDiscordInstall,
  isolatedEnv,
  writeTestBundle,
  type TestDiscordInstall,
} from "./test-fixtures.js";

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
async function runCliSandboxed(
  emptyDir: string,
  argv: string[],
  io: CliIO,
): Promise<number> {
  const saved = snapshotEnv();
  for (const key of [
    "LOCALAPPDATA",
    "APPDATA",
    "HOME",
    "XDG_CONFIG_HOME",
  ] as const) {
    process.env[key] = emptyDir;
  }
  process.env["VESTRA_TEST"] = "1";
  try {
    return await runCli(argv, io);
  } finally {
    restoreEnv(saved);
  }
}

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/** Pack a minimal asar WITHOUT a sentinel (negative-identity target). */
async function packBareAsar(root: string, version: string): Promise<string> {
  const srcDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "vestra-asar-src-"),
  );
  try {
    await fs.promises.writeFile(
      path.join(srcDir, "package.json"),
      JSON.stringify({
        name: "fake-discord",
        version: "1.0.0",
        main: "index.js",
      }),
      "utf8",
    );
    await fs.promises.writeFile(
      path.join(srcDir, "index.js"),
      "module.exports = 42;\n",
      "utf8",
    );
    const asarPath = path.join(root, `app-${version}`, "resources", "app.asar");
    await fs.promises.mkdir(path.dirname(asarPath), { recursive: true });
    await packAsar(srcDir, asarPath);
    return asarPath;
  } finally {
    await fs.promises.rm(srcDir, { recursive: true, force: true });
  }
}

interface Harness {
  fx: TestDiscordInstall[];
  emptyDir: string;
  homeDir: string;
  bundlePath: string;
  ctx: InstallerServiceContext;
  cleanup(): Promise<void>;
}

/** Two sentinel fixtures (stable + canary) sharing one sandbox home. */
async function makeHarness(): Promise<Harness> {
  const stable = await createTestDiscordInstall({
    channel: "stable",
    version: "1.0.0",
  });
  const canary = await createTestDiscordInstall({
    channel: "canary",
    version: "1.0.0",
  });
  const fx = [stable, canary];
  const emptyDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "vestra-svc-empty-"),
  );
  const homeDir = path.join(stable.base, "home");
  const bundlePath = await writeTestBundle(path.join(stable.base, "bundle"));
  const discovery = {
    extraRoots: fx.map((f) => ({ channel: f.channel, rootDir: f.root })),
    platform: "win32",
    env: isolatedEnv(emptyDir),
  };
  const ctx: InstallerServiceContext = {
    homeDir,
    bundlePath,
    discovery,
    testMode: true,
  };
  return {
    fx,
    emptyDir,
    homeDir,
    bundlePath,
    ctx,
    cleanup: async () => {
      await stable.cleanup();
      await canary.cleanup();
      await fs.promises.rm(emptyDir, { recursive: true, force: true });
    },
  };
}

describe("installer service", () => {
  test("1. discover() returns fixture installation metadata", async () => {
    const h = await makeHarness();
    try {
      const installer = createInstallerService(h.ctx);
      const found = await installer.discover();
      assert.equal(found.length, 2);
      const canary = found.find((f) => f.channel === "canary");
      assert.ok(canary !== undefined);
      assert.equal(canary.version, "1.0.0");
      assert.equal(canary.rootDir, h.fx[1]?.root);
      assert.equal(canary.appDir, h.fx[1]?.appDir);
      assert.equal(canary.asarPath, h.fx[1]?.asarPath);
      assert.equal(canary.isActive, true);
      for (const f of found) assert.equal(f.isActive, true);
    } finally {
      await h.cleanup();
    }
  });

  test("2. channel filtering excludes stable when canary requested", async () => {
    const h = await makeHarness();
    try {
      const installer = createInstallerService(h.ctx);
      const found = await installer.discover({ channels: ["canary"] });
      assert.equal(found.length, 1);
      assert.equal(found[0]?.channel, "canary");
    } finally {
      await h.cleanup();
    }
  });

  test("3. status() returns structured results (shallow, no CLI parsing)", async () => {
    const h = await makeHarness();
    try {
      const installer = createInstallerService(h.ctx);
      const before = await installer.status({ channels: ["canary"] });
      assert.equal(before.statuses.length, 1);
      const s = before.statuses[0];
      assert.ok(s !== undefined);
      assert.equal(s.health, "not-installed");
      assert.equal(s.vestraInstalled, false);
      assert.equal(s.repairable, true);
      assert.equal(s.installation.channel, "canary");
      // No process exit codes on the service contract.
      assert.ok(
        !("exitCode" in (before as unknown as Record<string, unknown>)),
      );

      await installer.install({ channels: ["canary"] });
      const after = await installer.status({ channels: ["canary"] });
      const installed = after.statuses[0];
      assert.ok(installed !== undefined);
      assert.equal(installed.health, "healthy");
      assert.equal(installed.vestraInstalled, true);
      assert.equal(installed.repairable, false);
    } finally {
      await h.cleanup();
    }
  });

  test("4. check() returns deep health; status stays shallow when payload corrupts", async () => {
    const h = await makeHarness();
    try {
      const installer = createInstallerService(h.ctx);
      await installer.install({ channels: ["canary"] });
      const healthy = await installer.check({ channels: ["canary"] });
      assert.equal(healthy.statuses[0]?.health, "healthy");

      // Corrupt the staged payload bytes (manifest hash mismatch).
      const { payloadRoot } = layoutHome(h.homeDir);
      const versions = await fs.promises.readdir(payloadRoot);
      assert.ok(versions.length > 0);
      const payloadFile = path.join(
        payloadRoot,
        versions[0] as string,
        "vestra.js",
      );
      await fs.promises.writeFile(payloadFile, "// corrupted\n", "utf8");

      const status = await installer.status({ channels: ["canary"] });
      assert.equal(status.statuses[0]?.health, "healthy"); // shallow: injected+registered
      const check = await installer.check({ channels: ["canary"] });
      assert.equal(check.statuses[0]?.health, "drifted"); // deep: hash mismatch
      assert.equal(check.statuses[0]?.code, "verification-failed");
    } finally {
      await h.cleanup();
    }
  });

  test("5. service install and CLI install share the engine path", async () => {
    const h = await makeHarness();
    try {
      const installer = createInstallerService(h.ctx);
      const viaService = await installer.install({ channels: ["canary"] });
      assert.equal(viaService.ok, true);
      assert.equal(viaService.results[0]?.action, "installed");

      // CLI observes the same registry/engine state: already injected => skipped.
      const io = makeIO();
      const code = await runCliSandboxed(
        h.emptyDir,
        [
          "install",
          "--home",
          h.homeDir,
          "--bundle",
          h.bundlePath,
          "--root",
          `stable:${h.fx[0]?.root as string}`,
          "--root",
          `canary:${h.fx[1]?.root as string}`,
          "--channel",
          "canary",
        ],
        io,
      );
      assert.equal(code, 0);
      assert.ok(io.lines.some((l) => l.includes("skipped")));
      const registry = await loadRegistry(layoutHome(h.homeDir).registryPath);
      assert.ok(registry[h.fx[1]?.asarPath as string] !== undefined);
    } finally {
      await h.cleanup();
    }
  });

  test("6. repair() verifies and stays channel-scoped", async () => {
    const h = await makeHarness();
    try {
      const installer = createInstallerService(h.ctx);
      await installer.install();
      // Break canary only (drop its receipt).
      await fs.promises.rm(
        path.join(
          path.dirname(h.fx[1]?.asarPath as string),
          "vestra-receipt.json",
        ),
        { force: true },
      );
      // A missing receipt is drift; the remaining hook still counts as installed.
      const drifted = await installer.check({ channels: ["canary"] });
      assert.equal(drifted.statuses[0]?.health, "drifted");
      assert.equal(drifted.statuses[0]?.vestraInstalled, true);

      // Stable-scoped repair must not touch canary.
      const stableRepair = await installer.repair({ channels: ["stable"] });
      assert.equal(stableRepair.ok, true);
      assert.equal(stableRepair.results[0]?.action, "repaired");
      const stillDrifted = await installer.check({ channels: ["canary"] });
      assert.notEqual(stillDrifted.statuses[0]?.health, "healthy");

      const canaryRepair = await installer.repair({ channels: ["canary"] });
      assert.equal(canaryRepair.ok, true);
      assert.equal(canaryRepair.results[0]?.action, "repaired");
      const healed = await installer.check({ channels: ["canary"] });
      assert.equal(healed.statuses[0]?.health, "healthy");
    } finally {
      await h.cleanup();
    }
  });

  test("7. pruneRegistry() returns structured stale/removed/skipped data", async () => {
    const h = await makeHarness();
    const installer = createInstallerService(h.ctx);
    try {
      const goneAsar = path.join(
        h.emptyDir,
        "wiped",
        "app-1.0.2000",
        "resources",
        "app.asar",
      );
      const activeAsar = h.fx[1]?.asarPath as string;
      const hashBefore = sha256File(activeAsar);
      const mtimeBefore = (await fs.promises.stat(activeAsar)).mtimeMs;
      await fs.promises.mkdir(h.homeDir, { recursive: true });
      await saveRegistry(layoutHome(h.homeDir).registryPath, {
        [activeAsar]: {
          asarPath: activeAsar,
          channel: "canary",
          installVersion: "1.0.0",
          payloadVersion: "0.0.0-test",
          at: new Date().toISOString(),
        },
        [goneAsar]: {
          asarPath: goneAsar,
          channel: "canary",
          installVersion: "1.0.2000",
          payloadVersion: "0.0.0-test",
          at: new Date().toISOString(),
        },
      });
      const discovery = {
        extraRoots: [
          {
            channel: "canary" as DiscordChannel,
            rootDir: (h.fx[1] as TestDiscordInstall).root,
          },
        ],
        platform: "win32",
        env: isolatedEnv(h.emptyDir),
      };
      const svc = createInstallerService({
        homeDir: h.homeDir,
        discovery,
        testMode: true,
      });
      const result = await svc.pruneRegistry({ dryRun: true });
      assert.equal(result.dryRun, true);
      assert.deepEqual(
        result.removed.map((r) => r.key),
        [goneAsar],
      );
      assert.deepEqual(result.active, [activeAsar]);
      assert.ok(Array.isArray(result.skipped));
      // Dry run changes nothing; Discord bytes untouched.
      assert.equal(sha256File(activeAsar), hashBefore);
      assert.equal((await fs.promises.stat(activeAsar)).mtimeMs, mtimeBefore);
      void installer;
    } finally {
      await h.cleanup();
    }
  });

  test("8. CLI output stays backwards compatible", async () => {
    const h = await makeHarness();
    try {
      const roots = [
        "--root",
        `stable:${h.fx[0]?.root as string}`,
        "--root",
        `canary:${h.fx[1]?.root as string}`,
      ];
      let io = makeIO();
      assert.equal(
        await runCliSandboxed(
          h.emptyDir,
          ["list", "--home", h.homeDir, "--bundle", h.bundlePath, ...roots],
          io,
        ),
        0,
      );
      assert.ok(io.lines.some((l) => /^canary 1\.0\.0 — /.test(l)));
      assert.ok(io.lines.some((l) => /^stable 1\.0\.0 — /.test(l)));

      io = makeIO();
      assert.equal(
        await runCliSandboxed(
          h.emptyDir,
          ["install", "--home", h.homeDir, "--bundle", h.bundlePath, ...roots],
          io,
        ),
        0,
      );
      assert.ok(io.lines.some((l) => l.includes(": installed")));

      io = makeIO();
      assert.equal(
        await runCliSandboxed(
          h.emptyDir,
          ["status", "--home", h.homeDir, "--bundle", h.bundlePath, ...roots],
          io,
        ),
        0,
      );
      assert.ok(io.lines.some((l) => l.startsWith("canary")));
    } finally {
      await h.cleanup();
    }
  });

  test("9. CLI exit codes stay 0/1/2", async () => {
    const h = await makeHarness();
    try {
      const roots = [
        "--root",
        `stable:${h.fx[0]?.root as string}`,
        "--root",
        `canary:${h.fx[1]?.root as string}`,
      ];
      // 1: unhealthy (nothing installed).
      assert.equal(
        await runCliSandboxed(
          h.emptyDir,
          ["check", "--home", h.homeDir, "--bundle", h.bundlePath, ...roots],
          makeIO(),
        ),
        1,
      );
      // 0: healthy after install.
      assert.equal(
        await runCliSandboxed(
          h.emptyDir,
          ["install", "--home", h.homeDir, "--bundle", h.bundlePath, ...roots],
          makeIO(),
        ),
        0,
      );
      assert.equal(
        await runCliSandboxed(
          h.emptyDir,
          ["check", "--home", h.homeDir, "--bundle", h.bundlePath, ...roots],
          makeIO(),
        ),
        0,
      );
      // 2: usage errors.
      assert.equal(
        await runCliSandboxed(h.emptyDir, ["frobnicate"], makeIO()),
        2,
      );
      assert.equal(
        await runCliSandboxed(
          h.emptyDir,
          ["status", "--home", h.homeDir, "--bogus"],
          makeIO(),
        ),
        2,
      );
    } finally {
      await h.cleanup();
    }
  });

  test("10. service results carry structured state, not exit codes", async () => {
    const h = await makeHarness();
    try {
      const installer = createInstallerService(h.ctx);
      const summary = await installer.install({ channels: ["canary"] });
      const raw = summary as unknown as Record<string, unknown>;
      assert.ok(!("exitCode" in raw));
      assert.ok(!("code" in raw && typeof raw["code"] === "number"));
      assert.equal(typeof summary.ok, "boolean");
      assert.ok(Array.isArray(summary.results));
    } finally {
      await h.cleanup();
    }
  });

  test("11. direct service call in test mode hits the live-install guard", async () => {
    const saved = snapshotEnv();
    const base = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "vestra-svc-guard-"),
    );
    try {
      delete process.env["VESTRA_TEST"];
      delete process.env["VESTRA_ALLOW_LIVE_TESTS"];
      // Simulated %LOCALAPPDATA% with a sentinel-less "real" Canary install.
      const local = path.join(base, "LocalAppData");
      const asarPath = await packBareAsar(
        path.join(local, "DiscordCanary"),
        "1.0.2000",
      );
      const hashBefore = sha256File(asarPath);
      const homeDir = path.join(base, "home");
      const bundlePath = await writeTestBundle(path.join(base, "bundle"));
      const svc = createInstallerService({
        homeDir,
        bundlePath,
        discovery: { platform: "win32", env: { LOCALAPPDATA: local } },
        testMode: true,
      });
      const result = await svc.install();
      assert.equal(result.results.length, 1);
      assert.equal(result.ok, false);
      assert.equal(result.results[0]?.code, "safety-refusal");
      assert.match(
        result.results[0]?.detail ?? "",
        /Refusing destructive test write/,
      );
      // Nothing written: bytes identical, no backup, no receipt.
      assert.equal(sha256File(asarPath), hashBefore);
      assert.equal(fs.existsSync(`${asarPath}.vestra-backup`), false);
      assert.equal(
        fs.existsSync(path.join(path.dirname(asarPath), "vestra-receipt.json")),
        false,
      );
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true });
      restoreEnv(saved);
    }
  });

  test("12. progress callback receives deterministic phases", async () => {
    const h = await makeHarness();
    try {
      const installer = createInstallerService(h.ctx);
      const events: InstallerProgressEvent[] = [];
      const summary = await installer.install({
        channels: ["canary"],
        onProgress: (e) => {
          events.push(e);
        },
      });
      assert.equal(summary.ok, true);
      const phases = events.map((e) => e.phase);
      assert.equal(phases[0], "discovering");
      assert.ok(phases.includes("staging"));
      assert.ok(phases.includes("patching"));
      assert.ok(phases.includes("verifying"));
      assert.equal(phases[phases.length - 1], "complete");
      const patching = events.find((e) => e.phase === "patching");
      assert.ok(patching?.installation?.asarPath === h.fx[1]?.asarPath);
      assert.ok(events.every((e) => e.operation === "install"));
    } finally {
      await h.cleanup();
    }
  });

  test("13. no progress callback => same behavior", async () => {
    const h = await makeHarness();
    try {
      const a = createInstallerService(h.ctx);
      const withCb = await a.install({
        channels: ["stable"],
        onProgress: () => undefined,
      });
      const b = createInstallerService(h.ctx);
      const forced = await b.install({ channels: ["canary"] });
      assert.equal(withCb.ok, true);
      assert.equal(forced.ok, true);
      assert.equal(withCb.results[0]?.action, "installed");
      assert.equal(forced.results[0]?.action, "installed");
      // Re-run without callback and with force: identical actions.
      const c = createInstallerService(h.ctx);
      const again = await c.install({ channels: ["stable"], force: true });
      assert.equal(again.results[0]?.action, "reinstalled");
    } finally {
      await h.cleanup();
    }
  });

  test("14. discovery never leaks real installs", async () => {
    const h = await makeHarness();
    try {
      const installer = createInstallerService(h.ctx);
      const found = await installer.discover();
      assert.ok(found.length > 0);
      for (const f of found) {
        assert.ok(
          f.asarPath.includes("vestra-svc-empty-") ||
            f.asarPath.includes("vestra-test-install-"),
        );
      }
    } finally {
      await h.cleanup();
    }
  });
});
