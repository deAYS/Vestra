// Channel-filter regression tests for `vestra status` / `vestra check`.
// Uses fixtures in temp directories only — never touches real Discord installs.
// Run with: bun test apps/installer  (also runs under `node --test`)

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { packAsar, type DiscordChannel } from "@vestra/injector";
import { installAll, statusAll } from "./operations.js";
import { runCli, type CliIO } from "./cli.js";

interface Fixture {
  tmp: string;
  homeDir: string;
  bundlePath: string;
  stableRoot: string;
  canaryRoot: string;
  /** Empty dir used to sandbox real-install discovery (LOCALAPPDATA/HOME). */
  emptyEnvDir: string;
}

async function makeFakeRoot(rootDir: string): Promise<void> {
  const srcDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-asar-src-"));
  try {
    await fs.promises.writeFile(
      path.join(srcDir, "package.json"),
      JSON.stringify({ name: "fake-discord", version: "1.0.0", main: "index.js" }),
      "utf8",
    );
    await fs.promises.writeFile(path.join(srcDir, "index.js"), "module.exports = 42;\n", "utf8");
    const asarPath = path.join(rootDir, "app-1.0.0", "resources", "app.asar");
    await fs.promises.mkdir(path.dirname(asarPath), { recursive: true });
    await packAsar(srcDir, asarPath);
  } finally {
    await fs.promises.rm(srcDir, { recursive: true, force: true });
  }
}

async function makeFixture(): Promise<Fixture> {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-channel-test-"));
  const homeDir = path.join(tmp, "home");
  const bundlePath = path.join(tmp, "vestra.js");
  const stableRoot = path.join(tmp, "stable-root");
  const canaryRoot = path.join(tmp, "canary-root");
  const emptyEnvDir = path.join(tmp, "empty-env");
  await fs.promises.mkdir(emptyEnvDir, { recursive: true });
  await fs.promises.writeFile(bundlePath, "// vestra test bundle\nmodule.exports = {};\n", "utf8");
  await makeFakeRoot(stableRoot);
  await makeFakeRoot(canaryRoot);
  return { tmp, homeDir, bundlePath, stableRoot, canaryRoot, emptyEnvDir };
}

function extraRoots(fx: Fixture): Array<{ channel: DiscordChannel; rootDir: string }> {
  return [
    { channel: "stable", rootDir: fx.stableRoot },
    { channel: "canary", rootDir: fx.canaryRoot },
  ];
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

function cliArgs(fx: Fixture, command: "status" | "check", channels?: string[]): string[] {
  const args = [
    command,
    "--home",
    fx.homeDir,
    "--bundle",
    fx.bundlePath,
    "--root",
    `stable:${fx.stableRoot}`,
    "--root",
    `canary:${fx.canaryRoot}`,
  ];
  if (channels !== undefined) {
    for (const c of channels) args.push("--channel", c);
  }
  return args;
}

describe("channel filtering for status/check", () => {
  test("Stable clean + Canary healthy + --channel canary => exit 0", async () => {
    const fx = await makeFixture();
    try {
      // Only Canary gets injected; Stable stays clean (== unhealthy, must be ignored).
      const installed = await installAll(
        {
          homeDir: fx.homeDir,
          bundlePath: fx.bundlePath,
          discovery: { extraRoots: extraRoots(fx), platform: "win32", env: isolatedEnv(fx) },
        },
        { channels: ["canary"] },
      );
      assert.equal(installed.results.length, 1);

      const filtered = await statusAll(
        {
          homeDir: fx.homeDir,
          bundlePath: fx.bundlePath,
          discovery: { extraRoots: extraRoots(fx), platform: "win32", env: isolatedEnv(fx) },
        },
        { channels: ["canary"] },
      );
      assert.equal(filtered.health.length, 1);
      assert.equal(filtered.health[0]?.channel, "canary");
      assert.equal(filtered.health.every((h) => h.healthy), true);

      for (const command of ["status", "check"] as const) {
        const io = makeIO();
        const code = await runCliSandboxed(fx, cliArgs(fx, command, ["canary"]), io);
        assert.equal(code, 0);
      }
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("Stable healthy + Canary unhealthy + --channel stable => exit 0", async () => {
    const fx = await makeFixture();
    try {
      await installAll(
        {
          homeDir: fx.homeDir,
          bundlePath: fx.bundlePath,
          discovery: { extraRoots: extraRoots(fx), platform: "win32", env: isolatedEnv(fx) },
        },
        { channels: ["stable"] },
      );
      // Canary left clean (unhealthy) and must be ignored by the stable filter.

      for (const command of ["status", "check"] as const) {
        const io = makeIO();
        const code = await runCliSandboxed(fx, cliArgs(fx, command, ["stable"]), io);
        assert.equal(code, 0);
        assert.equal(io.lines.some((l) => l.startsWith("stable")), true);
        assert.equal(io.lines.some((l) => l.startsWith("canary")), false);
      }
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("Canary unhealthy + --channel canary => exit 1", async () => {
    const fx = await makeFixture();
    try {
      // Nothing installed: Canary is clean == unhealthy.
      for (const command of ["status", "check"] as const) {
        const io = makeIO();
        const code = await runCliSandboxed(fx, cliArgs(fx, command, ["canary"]), io);
        assert.equal(code, 1);
      }

      // Drifted variant: install Canary, then remove its receipt so it reads unhealthy.
      await installAll(
        {
          homeDir: fx.homeDir,
          bundlePath: fx.bundlePath,
          discovery: { extraRoots: extraRoots(fx), platform: "win32", env: isolatedEnv(fx) },
        },
        { channels: ["canary"] },
      );
      const canaryResources = path.join(fx.canaryRoot, "app-1.0.0", "resources");
      await fs.promises.rm(path.join(canaryResources, "vestra-receipt.json"), { force: true });
      const io = makeIO();
      const code = await runCliSandboxed(fx, cliArgs(fx, "check", ["canary"]), io);
      assert.equal(code, 1);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("multiple selected channels only participate", async () => {
    const fx = await makeFixture();
    try {
      // Both healthy.
      await installAll({
        homeDir: fx.homeDir,
        bundlePath: fx.bundlePath,
        discovery: { extraRoots: extraRoots(fx), platform: "win32", env: isolatedEnv(fx) },
      });
      const ioBoth = makeIO();
      const bothCode = await runCliSandboxed(fx, cliArgs(fx, "status", ["stable,canary"]), ioBoth);
      assert.equal(bothCode, 0);
      assert.equal(ioBoth.lines.some((l) => l.startsWith("stable")), true);
      assert.equal(ioBoth.lines.some((l) => l.startsWith("canary")), true);

      // Break Canary only.
      const canaryResources = path.join(fx.canaryRoot, "app-1.0.0", "resources");
      await fs.promises.rm(path.join(canaryResources, "vestra-receipt.json"), { force: true });

      const ioStable = makeIO();
      assert.equal(await runCliSandboxed(fx, cliArgs(fx, "check", ["stable"]), ioStable), 0);

      const ioCanary = makeIO();
      assert.equal(await runCliSandboxed(fx, cliArgs(fx, "check", ["canary"]), ioCanary), 1);

      // Repeatable --channel flags behave like a comma list.
      const ioMulti = makeIO();
      assert.equal(await runCliSandboxed(fx, cliArgs(fx, "check", ["stable", "canary"]), ioMulti), 1);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("no filter preserves all-channel behavior", async () => {
    const fx = await makeFixture();
    try {
      // One healthy (stable), one clean (canary) => unfiltered must fail.
      await installAll(
        {
          homeDir: fx.homeDir,
          bundlePath: fx.bundlePath,
          discovery: { extraRoots: extraRoots(fx), platform: "win32", env: isolatedEnv(fx) },
        },
        { channels: ["stable"] },
      );
      for (const command of ["status", "check"] as const) {
        const io = makeIO();
        assert.equal(await runCliSandboxed(fx, cliArgs(fx, command), io), 1);
      }

      // All healthy => unfiltered passes.
      await installAll(
        {
          homeDir: fx.homeDir,
          bundlePath: fx.bundlePath,
          discovery: { extraRoots: extraRoots(fx), platform: "win32", env: isolatedEnv(fx) },
        },
        { channels: ["canary"] },
      );
      for (const command of ["status", "check"] as const) {
        const io = makeIO();
        assert.equal(await runCliSandboxed(fx, cliArgs(fx, command), io), 0);
      }
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });

  test("stale records outside the filter are ignored", async () => {
    const fx = await makeFixture();
    try {
      await installAll({
        homeDir: fx.homeDir,
        bundlePath: fx.bundlePath,
        discovery: { extraRoots: extraRoots(fx), platform: "win32", env: isolatedEnv(fx) },
      });
      // Delete the Stable install from disk but keep its registry record.
      await fs.promises.rm(fx.stableRoot, { recursive: true, force: true });

      const ctx = {
        homeDir: fx.homeDir,
        bundlePath: fx.bundlePath,
        discovery: {
          extraRoots: [{ channel: "canary" as DiscordChannel, rootDir: fx.canaryRoot }],
          platform: "win32" as const,
          env: isolatedEnv(fx),
        },
      };
      const canaryOnly = await statusAll(ctx, { channels: ["canary"] });
      assert.deepEqual(canaryOnly.stale, []);

      const all = await statusAll(ctx);
      assert.equal(all.stale.length, 1);
    } finally {
      await fs.promises.rm(fx.tmp, { recursive: true, force: true });
    }
  });
});
