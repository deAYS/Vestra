import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as asar from "@electron/asar";
import {
  assertDestructiveTestTargetAllowed,
  type SafetyOptions,
} from "@vestra/shared/node/testSafety.js";
import { packAsar, readAsarFile, readAsarMain, unpackAsar, validateAsar } from "./asar.js";
import type { DiscordInstall } from "./paths.js";
import { getRealFs } from "./realFs.js";

export const VESTRA_DIR = "vestra";
export const RECEIPT_FILE = "vestra-receipt.json";
export const BACKUP_SUFFIX = ".vestra-backup";
export const TMP_SUFFIX = ".vestra-tmp";

export const HOOK_REQUIRE_PREFIX = "// __VESTRA_HOOK__";
export const MAIN_HOOK_FILE = "vestra-main-hook.cjs";
export const PRELOAD_FILE = "vestra-preload.cjs";
export const BUNDLE_FILE = "vestra.js";
export const LOADER_FILE = "vestra-loader.js";

export interface PayloadSources {
  bundleSource: string;
  preloadSource: string;
  mainHookSource: string;
  loaderSource: string;
}

export interface InjectReceipt {
  tool: "vestra-injector";
  version: 1;
  channel: string;
  installVersion: string;
  mainEntry: string;
  backedUp: boolean;
  at: string;
}

export interface InjectPlan {
  install: DiscordInstall;
  mainEntry: string;
  backupPath: string;
  receiptPath: string;
  receipt: InjectReceipt;
  /** Loader require lines prepended to the main entry. */
  hookLines: string[];
}

function receiptPathFor(install: DiscordInstall): string {
  return path.join(install.resourcesDir, RECEIPT_FILE);
}

function backupPathFor(install: DiscordInstall): string {
  return `${install.asarPath}${BACKUP_SUFFIX}`;
}

/** Read the current receipt, or undefined when not injected. */
export function readReceipt(
  install: DiscordInstall,
): InjectReceipt | undefined {
  try {
    const raw = fs.readFileSync(receiptPathFor(install), "utf8");
    const parsed = JSON.parse(raw) as Partial<InjectReceipt>;
    if (parsed.tool !== "vestra-injector" || parsed.version !== 1)
      return undefined;
    return parsed as InjectReceipt;
  } catch {
    return undefined;
  }
}

/** Whether the physical recovery sidecar exists (without reading archive contents). */
export function hasInjectionBackup(install: DiscordInstall): boolean {
  // Physical backup probe (`app.asar.vestra-backup` contains `.asar`
  // mid-path): must use the unpatched filesystem under Electron.
  try {
    return getRealFs().statSync(backupPathFor(install)).isFile();
  } catch {
    return false;
  }
}

/** Whether the archive's main entry carries the Vestra hook marker. */
export function isInjected(install: DiscordInstall): boolean {
  // The archive itself is the source of truth: a replaced (e.g. updated)
  // archive next to a stale receipt and backup is not injected.
  try {
    return readAsarFile(install.asarPath, readAsarMain(install.asarPath))
      .includes(HOOK_REQUIRE_PREFIX);
  } catch {
    // Unreadable archive (interrupted write): fall back to the metadata so
    // recovery from the backup stays reachable.
    return readReceipt(install) !== undefined && hasInjectionBackup(install);
  }
}

/**
 * Whether any Vestra trace remains: the hook in the archive, or a receipt
 * and backup left behind (e.g. after Discord replaced the archive in place).
 * Status and removal flows use this; inject decisions use `isInjected`.
 */
export function hasInjectionTraces(install: DiscordInstall): boolean {
  return (
    (readReceipt(install) !== undefined && hasInjectionBackup(install)) ||
    isInjected(install)
  );
}

/**
 * Compute the patch plan. Reads the asar's main entry (cheap metadata read).
 * Throws when already injected or the asar is unreadable.
 * The optional `safety` carries test-mode context; in test mode an unsafe
 * target is refused before any planning reads happen.
 */
export function planInject(
  install: DiscordInstall,
  payload: PayloadSources,
  safety?: SafetyOptions,
): { plan: InjectPlan; payload: PayloadSources } {
  assertDestructiveTestTargetAllowed(install.asarPath, safety ?? {});
  if (isInjected(install)) {
    throw new Error(`Already injected: ${install.asarPath} (uninject first).`);
  }
  let mainEntry: string;
  try {
    mainEntry = readAsarMain(install.asarPath);
  } catch (err: unknown) {
    throw new Error(
      `Cannot plan inject for ${install.asarPath}: ${describe(err)}`,
    );
  }
  const plan: InjectPlan = {
    install,
    mainEntry,
    backupPath: backupPathFor(install),
    receiptPath: receiptPathFor(install),
    receipt: {
      tool: "vestra-injector",
      version: 1,
      channel: install.channel,
      installVersion: install.version,
      mainEntry,
      backedUp: true,
      at: new Date().toISOString(),
    },
    hookLines: [
      HOOK_REQUIRE_PREFIX,
      // Main process only: registers ipc handlers + preload chaining. The
      // renderer loader is injected by the preload (it needs the DOM).
      `try { require(${JSON.stringify(hookRequirePath(mainEntry))}); } catch (e) { try { console.error("[Vestra] hook failed:", e); } catch (_) {} }`,
    ],
  };
  return { plan, payload };
}

/** Require path from the main entry's directory to the hook inside the archive. */
function hookRequirePath(mainEntry: string): string {
  const from = path.posix.dirname(mainEntry) || ".";
  const rel = path.posix.relative(from, `${VESTRA_DIR}/${MAIN_HOOK_FILE}`);
  return rel.startsWith("../") ? rel : `./${rel}`;
}

export interface ApplyOptions extends SafetyOptions {
  /** Keep the temp unpack dir for inspection (tests). */
  keepWorkDir?: string;
  /** Override work-dir removal (tests). */
  removeDir?: (dir: string) => Promise<void>;
}

/**
 * Execute an inject plan: backup → unpack → payload → hook → repack.
 * Restores the backup and rethrows when any step fails (never leaves a
 * half-patched asar behind).
 * Test-safety: the Discord-mutation guard runs first, so a test-mode call
 * against a real install (or an unknown location) throws before any write.
 */
export async function applyInject(
  plan: InjectPlan,
  payload: PayloadSources,
  options?: ApplyOptions,
): Promise<void> {
  const { install } = plan;
  assertDestructiveTestTargetAllowed(install.asarPath, options ?? {});
  requirePayload(payload);
  const workDir =
    options?.keepWorkDir ??
    (await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-inject-")));
  let backedUp = false;
  const tmpPath = `${install.asarPath}${TMP_SUFFIX}`;
  try {
    // Physical archive copies: route through the unpatched filesystem.
    await getRealFs().promises.copyFile(
      install.asarPath,
      plan.backupPath,
      fs.constants.COPYFILE_EXCL,
    );
    backedUp = true;
    await unpackAsar(install.asarPath, workDir);

    const vestraDir = path.join(workDir, VESTRA_DIR);
    await fs.promises.mkdir(vestraDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(vestraDir, BUNDLE_FILE),
      payload.bundleSource,
      "utf8",
    );
    await fs.promises.writeFile(
      path.join(vestraDir, PRELOAD_FILE),
      payload.preloadSource,
      "utf8",
    );
    await fs.promises.writeFile(
      path.join(vestraDir, MAIN_HOOK_FILE),
      payload.mainHookSource,
      "utf8",
    );
    await fs.promises.writeFile(
      path.join(vestraDir, LOADER_FILE),
      payload.loaderSource,
      "utf8",
    );

    const entryPath = path.join(workDir, plan.mainEntry);
    const original = await fs.promises.readFile(entryPath, "utf8");
    if (original.includes(HOOK_REQUIRE_PREFIX)) {
      throw new Error(`Main entry already hooked: ${plan.mainEntry}`);
    }
    // Keep hashbang and strict-mode directives at the start of the CJS module.
    const prologue =
      original.match(
        /^(?:#![^\n]*\n)?\s*(?:(?:"use strict"|'use strict');?\s*)?/u,
      )?.[0] ?? "";
    await fs.promises.writeFile(
      entryPath,
      `${prologue}${plan.hookLines.join("\n")}\n${original.slice(prologue.length)}`,
      "utf8",
    );

    // Write beside the live archive, then swap in one rename.
    await packAsar(workDir, tmpPath);
    await getRealFs().promises.rename(tmpPath, install.asarPath);
    asar.uncache(install.asarPath);
    await fs.promises.writeFile(
      plan.receiptPath,
      JSON.stringify(plan.receipt, null, 2),
      "utf8",
    );
  } catch (err: unknown) {
    if (backedUp) {
      try {
        await getRealFs().promises.copyFile(plan.backupPath, tmpPath);
        await getRealFs().promises.rename(tmpPath, install.asarPath);
        asar.uncache(install.asarPath);
      } catch {
        // Backup restore also failed — surface the original error.
      }
    }
    throw new Error(`Inject failed for ${install.asarPath}: ${describe(err)}`);
  } finally {
    try {
      await getRealFs().promises.rm(tmpPath, { force: true });
    } catch {
      // Best effort: a leftover temp archive is harmless.
    }
    if (options?.keepWorkDir === undefined) {
      try {
        await (options?.removeDir ??
          ((dir: string) => fs.promises.rm(dir, { recursive: true, force: true })))(workDir);
      } catch (err: unknown) {
        console.warn(`[Vestra] could not remove temp dir: ${describe(err)}`);
      }
    }
  }
}

/**
 * Remove Vestra: restore the backup byte-for-byte, delete the receipt.
 * Throws when no backup exists (nothing to restore).
 * Test-safety: the Discord-mutation guard runs first, so a test-mode call
 * against a real install throws even when the CLI layer is bypassed.
 */
export async function uninject(
  install: DiscordInstall,
  safety?: SafetyOptions,
): Promise<void> {
  assertDestructiveTestTargetAllowed(install.asarPath, safety ?? {});
  if (!hasInjectionBackup(install)) {
    throw new Error(`Not injected (no backup): ${install.asarPath}`);
  }
  let restore = true;
  try {
    const main = readAsarMain(install.asarPath);
    restore = readAsarFile(install.asarPath, main).includes(HOOK_REQUIRE_PREFIX);
  } catch {
    // An interrupted archive write can only be recovered from the backup.
  }
  if (restore) {
    const backup = backupPathFor(install);
    validateAsar(backup);
    const main = readAsarMain(backup);
    if (readAsarFile(backup, main).includes(HOOK_REQUIRE_PREFIX)) {
      throw new Error(`Backup is already hooked: ${backup}`);
    }
    await getRealFs().promises.copyFile(
      backup,
      install.asarPath,
    );
  }
  await getRealFs().promises.rm(backupPathFor(install), { force: true });
  await fs.promises.rm(receiptPathFor(install), { force: true });
}

function requirePayload(payload: PayloadSources): void {
  for (const key of [
    "bundleSource",
    "preloadSource",
    "mainHookSource",
    "loaderSource",
  ] as const) {
    const value = payload[key];
    if (typeof value !== "string" || value === "") {
      throw new Error(`Inject payload missing "${key}".`);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
