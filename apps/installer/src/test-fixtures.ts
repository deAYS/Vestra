import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { packAsar, type DiscordChannel } from "@vestra/injector";
import { TEST_SENTINEL } from "@vestra/shared/node/testSafety.js";
import type { OperationContext } from "./operations.js";

export interface TestDiscordInstall {
  channel: DiscordChannel;
  version: string;
  /** mkdtemp base owning this fixture (removed by cleanup). */
  base: string;
  /** Channel root dir (the sentinel lives here). */
  root: string;
  /** Versioned app dir, e.g. `<root>/app-1.0.0`. */
  appDir: string;
  resourcesDir: string;
  asarPath: string;
  cleanup(): Promise<void>;
}

/** Pack a minimal asar at `<root>/app-<version>/resources/app.asar`. */
async function packMinimalAsar(root: string, version: string): Promise<string> {
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

/**
 * Create an isolated Discord-like install with sentinel identity.
 * Defaults use obviously-fake versions (never a real installed version).
 */
export async function createTestDiscordInstall(options?: {
  channel?: DiscordChannel | undefined;
  version?: string | undefined;
}): Promise<TestDiscordInstall> {
  const channel = options?.channel ?? "canary";
  const version = options?.version ?? "1.0.0";
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-test-install-"));
  const root = path.join(base, channel);
  const asarPath = await packMinimalAsar(root, version);
  const resourcesDir = path.dirname(asarPath);
  const appDir = path.dirname(resourcesDir);
  await fs.promises.writeFile(path.join(root, TEST_SENTINEL), "vestra test fixture\n", "utf8");
  return {
    channel,
    version,
    base,
    root,
    appDir,
    resourcesDir,
    asarPath,
    cleanup: () => fs.promises.rm(base, { recursive: true, force: true }),
  };
}

/**
 * Isolated discovery env so real `%LOCALAPPDATA%/Discord*` installs never
 * leak into tests. Combine with `extraRoots` pointing at fixtures.
 */
export function isolatedEnv(emptyDir: string): Record<string, string | undefined> {
  return {
    LOCALAPPDATA: emptyDir,
    APPDATA: emptyDir,
    HOME: emptyDir,
    XDG_CONFIG_HOME: emptyDir,
  };
}

/** Sandbox discovery pointing only at fixture roots (plus a platform override). */
export function fixtureDiscovery(
  fx: TestDiscordInstall | TestDiscordInstall[],
  emptyDir: string,
): { extraRoots: Array<{ channel: DiscordChannel; rootDir: string }>; platform: string; env: Record<string, string | undefined> } {
  const list = Array.isArray(fx) ? fx : [fx];
  return {
    extraRoots: list.map((f) => ({ channel: f.channel, rootDir: f.root })),
    platform: "win32",
    env: isolatedEnv(emptyDir),
  };
}

/** Write a minimal core bundle for staging-based flows (install/repair). */
export async function writeTestBundle(dir: string, name = "vestra.js"): Promise<string> {
  await fs.promises.mkdir(dir, { recursive: true });
  const bundlePath = path.join(dir, name);
  await fs.promises.writeFile(bundlePath, "// vestra test bundle\nmodule.exports = {};\n", "utf8");
  return bundlePath;
}

/** Build an explicit test-mode operation context over fixtures. */
export function testOperationContext(
  homeDir: string,
  bundlePath: string,
  discovery: OperationContext["discovery"],
): OperationContext {
  return { homeDir, bundlePath, testMode: true, discovery };
}
