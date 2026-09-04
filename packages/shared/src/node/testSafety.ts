// @vestra/shared — Node-only test-safety guard.
//
// TEST-SAFETY infrastructure. This module must never be imported by
// browser/renderer bundles: `packages/shared` builds only `src/index.ts`
// for the browser (`--platform=browser`), and this file lives under the
// `./node/*` subpath (see package.json `exports` + tsconfig paths), which
// the browser barrel never references.
//
// Two separate, fail-closed protections — both active ONLY in test mode.
// Normal production behavior is unchanged: with test mode off every guard
// returns immediately without touching the filesystem.
//
//   1. Live Discord file-mutation protection:
//      `assertDestructiveTestTargetAllowed()` gates every write to app.asar,
//      the Vestra receipt, the Vestra backup, and staged runtime files.
//      Destructive operations covered: install, repair, uninstall,
//      applyInject/patch, uninject/restore, updater apply, updater rollback.
//      Read-only operations (list, status, check, registry prune --dry-run)
//      never call this guard and are never blocked by it.
//      Registry-only metadata writes are covered separately (see below).
//
//   2. Real Vestra user-data mutation protection:
//      `assertTestHomeAllowed()` gates every write under the Vestra product
//      home (registry installs.json, staged payloads, update-status.json)
//      in test mode: the home must be an explicit sandbox/test location,
//      never the user's real home. `pruneStaleRecords(dryRun:false)` is
//      exempt from protection (1) because it performs zero Discord file
//      writes, but it is still subject to protection (2).
//
// Test mode is explicit-first: `testMode: true/false` passed through the
// operation context is authoritative. Only when the context omits it do we
// fall back to `VESTRA_TEST=1`. `NODE_ENV` and runner detection are NOT
// consulted. The single override `VESTRA_ALLOW_LIVE_TESTS=1` permits live
// writes in test mode (with a prominent warning); it is never set
// automatically and never defaults true.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Sentinel file marking a directory tree as an isolated test install. */
export const TEST_SENTINEL = ".vestra-test-install";

/** Env var enabling test mode when no explicit `testMode` is passed. */
export const TEST_MODE_ENV = "VESTRA_TEST";

/** The single explicit override permitting live test writes. Never default true. */
export const LIVE_OVERRIDE_ENV = "VESTRA_ALLOW_LIVE_TESTS";

/** Prominent warning emitted when the live override is used. Never silent. */
export const LIVE_OVERRIDE_WARNING = "[Vestra] WARNING: live Discord test writes are enabled";

/**
 * Destructive operations covered by the Discord-mutation guard (protection 1).
 * Registry-only metadata writes are NOT in this set (see protection 2).
 */
export const DESTRUCTIVE_OPERATIONS = [
  "install",
  "repair",
  "uninstall",
  "applyInject",
  "uninject",
  "resetToBackup",
  "updater-apply",
  "updater-rollback",
  "asar-write",
  "receipt-write",
  "backup-write",
] as const;

export type DestructiveOperation = (typeof DESTRUCTIVE_OPERATIONS)[number];

/**
 * Read-only operations that must never be blocked by the Discord-mutation
 * guard. Listed here for documentation; the enforcement mechanism is simply
 * that these code paths never call `assertDestructiveTestTargetAllowed()`.
 */
export const READ_ONLY_OPERATIONS = ["list", "status", "check", "registry-prune-dry-run"] as const;

export type ReadOnlyOperation = (typeof READ_ONLY_OPERATIONS)[number];

/** True for names in DESTRUCTIVE_OPERATIONS. Available for CLI/tooling use. */
export function isDestructiveOperation(name: string): boolean {
  return (DESTRUCTIVE_OPERATIONS as readonly string[]).includes(name);
}

/**
 * Minimal structural subset of the injector `DiscoveryOptions`.
 * Defined locally because shared cannot import from injector (dependency
 * direction: injector depends on shared). The injector options are
 * assignable to this shape.
 */
export interface DiscoveryLike {
  platform?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  extraRoots?: Array<{ channel: string; rootDir: string }> | undefined;
}

export interface SafetyOptions {
  /**
   * Explicit test context. Authoritative: `true` enables the guards,
   * `false` forces production behavior even when test env vars are set.
   * When `undefined`, falls back to `VESTRA_TEST=1`.
   */
  testMode?: boolean | undefined;
  /**
   * Discovery whose env/platform ALSO define which Discord roots count as
   * "real" for this call (same inputs as `listInstalls`). Defaults to the
   * real `process.env` / `process.platform`. Tests simulate real installs
   * by pointing this env at a fake LocalAppData; production passes nothing
   * and gets the genuine roots.
   */
  discovery?: DiscoveryLike | undefined;
  /** Explicitly known fixture roots (allowed test targets / sandbox homes). */
  knownFixtureRoots?: string[] | undefined;
}

/**
 * Resolve test mode. Explicit context wins; env is only a fallback.
 * `NODE_ENV` and runner detection are deliberately NOT consulted.
 */
export function isTestMode(explicit?: boolean): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  return process.env[TEST_MODE_ENV] === "1";
}

/** True only when the dangerous override is explicitly set to "1". */
export function isLiveOverrideEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[LIVE_OVERRIDE_ENV] === "1";
}

/** Emit the prominent live-override warning. Never silent when overriding. */
export function emitLiveOverrideWarning(warn: (message: string) => void = console.warn): void {
  warn(LIVE_OVERRIDE_WARNING);
}

/**
 * Normalize a path for comparison: resolve `..`/`.` segments, normalize
 * separators, and compare case-insensitively on Windows.
 */
export function normalizeForCompare(p: string, platform: string = process.platform): string {
  const isWin = platform === "win32";
  const resolved = isWin ? path.win32.resolve(p) : path.resolve(p);
  let normalized = isWin ? path.win32.normalize(resolved) : path.normalize(resolved);
  // Drop a single trailing separator (never the root itself).
  if (normalized.length > 3 && (normalized.endsWith("\\") || normalized.endsWith("/"))) {
    normalized = normalized.slice(0, -1);
  }
  return isWin ? normalized.toLowerCase() : normalized;
}

/** True when `target` is `root` itself or nested anywhere under it. */
export function isUnderDir(target: string, root: string, platform: string = process.platform): boolean {
  const t = normalizeForCompare(target, platform);
  const r = normalizeForCompare(root, platform);
  if (t === r) return true;
  const sep = platform === "win32" ? "\\" : "/";
  return t.startsWith(r + sep);
}

function isUnderAny(target: string, roots: string[], platform: string): boolean {
  return roots.some((r) => isUnderDir(target, r, platform));
}

/**
 * Known real Discord installation roots, computed SYNTACTICALLY (no
 * filesystem access — never reads real installs). Mirrors the channel
 * layout in `packages/injector/src/paths.ts` (Windows versioned roots at
 * minimum; macOS bundles and Linux locations included for completeness).
 */
export function getRealDiscordRoots(options?: {
  platform?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
}): string[] {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  if (platform === "win32") {
    const base = env["LOCALAPPDATA"] ?? env["APPDATA"];
    if (base === undefined || base === "") return [];
    return ["Discord", "DiscordCanary", "DiscordPTB"].map((d) => path.join(base, d));
  }
  if (platform === "darwin") {
    return ["Discord.app", "Discord PTB.app", "Discord Canary.app"].map((d) =>
      path.join("/Applications", d),
    );
  }
  const home = env["HOME"] ?? "";
  const roots = ["/usr/share", "/opt"];
  if (home !== "") roots.unshift(path.join(home, ".config"));
  const names = ["discord", "Discord", "discord-ptb", "DiscordPTB", "discord-canary", "DiscordCanary"];
  return roots.flatMap((r) => names.map((n) => path.join(r, n)));
}

/**
 * Real Vestra product homes, computed SYNTACTICALLY (no filesystem access).
 * Mirrors `resolveHome()` in `apps/installer/src/home.ts`.
 */
export function getRealVestraHomes(options?: {
  platform?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
}): string[] {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  if (platform === "win32") {
    const base = env["APPDATA"];
    return base !== undefined && base !== "" ? [path.join(base, "Vestra")] : [];
  }
  if (platform === "darwin") {
    const home = env["HOME"] ?? os.homedir();
    return home !== "" ? [path.join(home, "Library", "Application Support", "Vestra")] : [];
  }
  const xdg = env["XDG_CONFIG_HOME"];
  if (xdg !== undefined && xdg !== "") return [path.join(xdg, "Vestra")];
  const home = env["HOME"] ?? os.homedir();
  return home !== "" ? [path.join(home, ".config", "Vestra")] : [];
}

/**
 * Positive fixture identity: walk up from `startDir` (or its parent when it
 * is a file, e.g. an app.asar path) looking for `.vestra-test-install`.
 * Path spelling is NOT trusted — only the sentinel file. Reads only the
 * target's own directory chain (fixtures in tests, never real installs).
 */
export function hasTestSentinel(startDir: string): boolean {
  let dir = path.resolve(startDir);
  try {
    if (fs.statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    // Missing path: treat as a directory and still walk up.
  }
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.statSync(path.join(dir, TEST_SENTINEL)).isFile()) return true;
    } catch {
      // Miss — keep walking.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
}

/**
 * Protection (1): gate a destructive write to a Discord installation.
 * No-op in production. In test mode, fails closed: throws unless the
 * target is a sentinel fixture, an explicitly known fixture root, or the
 * live override is enabled (warns). Real Discord roots always throw
 * without the override — including nested version paths, case-variant
 * spellings, and `..`-spelled paths (all normalized before comparison).
 */
export function assertDestructiveTestTargetAllowed(
  targetPath: string,
  options?: SafetyOptions,
): void {
  if (!isTestMode(options?.testMode)) return;
  if (isLiveOverrideEnabled()) {
    emitLiveOverrideWarning();
    return;
  }
  const platform = options?.discovery?.platform ?? process.platform;
  const env = options?.discovery?.env ?? process.env;
  const realRoots = getRealDiscordRoots({ platform, env });
  if (isUnderAny(targetPath, realRoots, platform)) {
    throw new Error(
      `Refusing destructive test write to real Discord install: ${targetPath} ` +
        `(set ${LIVE_OVERRIDE_ENV}=1 to override explicitly)`,
    );
  }
  if (hasTestSentinel(targetPath)) return;
  const known: string[] = [
    ...(options?.knownFixtureRoots ?? []),
    ...(options?.discovery?.extraRoots?.map((r) => r.rootDir) ?? []),
  ];
  if (known.length > 0 && isUnderAny(targetPath, known, platform)) return;
  throw new Error(
    `Refusing destructive test write to unknown location (no ${TEST_SENTINEL} fixture identity): ${targetPath} ` +
      `(set ${LIVE_OVERRIDE_ENV}=1 to override explicitly)`,
  );
}

/**
 * Protection (2): gate a write under the Vestra product home in test mode.
 * The home must be an explicit sandbox/test location (under `os.tmpdir()`
 * or inside `knownFixtureRoots`) and never the user's real home.
 * No-op in production. `dryRun` callers that write nothing should skip
 * calling this guard entirely.
 */
export function assertTestHomeAllowed(homeDir: string, options?: SafetyOptions): void {
  if (!isTestMode(options?.testMode)) return;
  if (isLiveOverrideEnabled()) {
    emitLiveOverrideWarning();
    return;
  }
  const platform = options?.discovery?.platform ?? process.platform;
  const env = options?.discovery?.env ?? process.env;
  const realHomes = getRealVestraHomes({ platform, env });
  if (realHomes.length > 0 && isUnderAny(homeDir, realHomes, platform)) {
    throw new Error(
      `Refusing test registry write to real Vestra home: ${homeDir} ` +
        `(set ${LIVE_OVERRIDE_ENV}=1 to override explicitly)`,
    );
  }
  if (isUnderDir(homeDir, os.tmpdir(), platform)) return;
  const known = options?.knownFixtureRoots ?? [];
  if (known.length > 0 && isUnderAny(homeDir, known, platform)) return;
  throw new Error(
    `Refusing test registry write outside sandbox home (use an os.tmpdir() fixture or knownFixtureRoots): ${homeDir} ` +
      `(set ${LIVE_OVERRIDE_ENV}=1 to override explicitly)`,
  );
}
