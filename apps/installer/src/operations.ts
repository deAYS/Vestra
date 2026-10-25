import * as fs from "node:fs";
import * as path from "node:path";
import { VESTRA_VERSION } from "@vestra/shared";
import {
  assertDestructiveTestTargetAllowed,
  assertTestHomeAllowed,
  type SafetyOptions,
} from "@vestra/shared/node/testSafety.js";
import {
  BACKUP_SUFFIX,
  RECEIPT_FILE,
  applyInject,
  getRealFs,
  hasInjectionBackup,
  isInjected,
  listInstalls,
  planInject,
  readAsarFile,
  readAsarMain,
  readReceipt,
  uninject,
  type DiscordChannel,
  type DiscordInstall,
  type DiscoveryOptions,
} from "@vestra/injector";
import { layoutHome } from "./home.js";
import {
  loadPayloadSources,
  payloadDirFor,
  sha256Hex,
  stagePayload,
  verifyPayload,
} from "./payload.js";
import {
  loadRegistry,
  loadRegistryWithDiagnostics,
  saveRegistry,
  type InstallRegistry,
  type RegistryEntry,
} from "./registry.js";

export interface OperationContext {
  homeDir: string;
  /** Built core bundle. Required for install/repair (staging). */
  bundlePath?: string | undefined;
  payloadVersion?: string | undefined;
  discovery?: DiscoveryOptions | undefined;
  /**
   * Explicit test context (authoritative). `true` enables the test-safety
   * guards; `false` forces production behavior. When omitted, falls back
   * to `VESTRA_TEST=1`. Production callers leave this unset.
   */
  testMode?: boolean | undefined;
  /** Explicitly known fixture roots (allowed test targets / sandbox homes). */
  knownFixtureRoots?: string[] | undefined;
}

export interface PerInstallResult {
  asarPath: string;
  channel: string;
  ok: boolean;
  action: string;
  detail?: string | undefined;
}

export interface BatchResult {
  results: PerInstallResult[];
}

function ctxVersions(ctx: OperationContext): {
  bundlePath: string;
  payloadVersion: string;
} {
  const bundlePath = ctx.bundlePath ?? "";
  if (bundlePath === "") {
    throw new TypeError(
      "A bundlePath is required (build @vestra/core or pass --bundle).",
    );
  }
  return { bundlePath, payloadVersion: ctx.payloadVersion ?? VESTRA_VERSION };
}

export function channelMatches(
  channels: DiscordChannel[] | undefined,
  channel: string,
): boolean {
  return (
    channels === undefined ||
    channels.length === 0 ||
    channels.includes(channel as DiscordChannel)
  );
}

/** Collect the test-safety policy carried by an operation context. */
function safetyFor(ctx: OperationContext): SafetyOptions {
  return {
    testMode: ctx.testMode,
    discovery: ctx.discovery,
    knownFixtureRoots: ctx.knownFixtureRoots,
  };
}

/** Protection (1): refuse destructive Discord writes to unsafe test targets. */
function guardTarget(install: DiscordInstall, ctx: OperationContext): void {
  assertDestructiveTestTargetAllowed(install.asarPath, safetyFor(ctx));
}

/** Protection (2): refuse Vestra home/registry writes outside sandbox homes. */
function guardHome(ctx: OperationContext): void {
  assertTestHomeAllowed(ctx.homeDir, safetyFor(ctx));
}

function targetsFor(
  ctx: OperationContext,
  channels?: DiscordChannel[],
  only?: string[],
): DiscordInstall[] {
  const found = listInstalls(ctx.discovery);
  const byChannel = found.filter((i) => channelMatches(channels, i.channel));
  if (only === undefined || only.length === 0) return byChannel;
  const wanted = new Set(only);
  return byChannel.filter((i) => wanted.has(i.asarPath));
}

async function ensurePayload(ctx: OperationContext): Promise<string> {
  const { bundlePath, payloadVersion } = ctxVersions(ctx);
  const { payloadRoot } = layoutHome(ctx.homeDir);
  return stagePayload({ bundlePath, payloadVersion, payloadRoot });
}

/**
 * Best-effort reset to the pristine backup (stale hook without receipt).
 * Returns true when a backup was restored. Never throws for IO conditions.
 * When a backup exists (a write is about to happen), the Discord-mutation
 * guard runs first and MAY throw in test mode for unsafe targets.
 */
export async function resetToBackup(
  install: DiscordInstall,
  safety?: SafetyOptions,
): Promise<boolean> {
  let backupIsFile = false;
  try {
    backupIsFile = getRealFs()
      .statSync(`${install.asarPath}${BACKUP_SUFFIX}`)
      .isFile();
  } catch {
    backupIsFile = false;
  }
  if (!backupIsFile) return false;
  assertDestructiveTestTargetAllowed(install.asarPath, safety ?? {});
  try {
    await getRealFs().promises.copyFile(
      `${install.asarPath}${BACKUP_SUFFIX}`,
      install.asarPath,
    );
    await fs.promises.rm(requireReceiptPath(install), { force: true });
    await getRealFs().promises.rm(`${install.asarPath}${BACKUP_SUFFIX}`, {
      force: true,
    });
    return true;
  } catch {
    return false;
  }
}

function requireReceiptPath(install: DiscordInstall): string {
  return path.join(install.resourcesDir, RECEIPT_FILE);
}

/** Clear any previous patch (receipt-backed or stale) so a fresh inject can run. Never throws for IO conditions. */
async function prepareFreshInstall(
  install: DiscordInstall,
  safety?: SafetyOptions,
): Promise<void> {
  // An updater may replace app.asar in place while leaving our receipt behind.
  // Preserve the new native archive; restoring an old backup would roll it back.
  const main = readAsarMain(install.asarPath);
  if (!readAsarFile(install.asarPath, main).includes("// __VESTRA_HOOK__")) {
    if (readReceipt(install) !== undefined) {
      assertDestructiveTestTargetAllowed(install.asarPath, safety ?? {});
      await getRealFs().promises.rm(`${install.asarPath}${BACKUP_SUFFIX}`, {
        force: true,
      });
      await fs.promises.rm(requireReceiptPath(install), { force: true });
    }
    return;
  }
  if (isInjected(install)) {
    try {
      await uninject(install, safety);
    } catch {
      // Fall through to backup reset below.
    }
  }
  await resetToBackup(install, safety);
}

/**
 * Install into every matching Discord install. Respects `force` for re-patch.
 * `stage: false` skips (re)staging and uses the already-staged payload
 * version (the updater stages from signed envelopes, not local bundles).
 */
export async function installAll(
  ctx: OperationContext,
  options?: {
    channels?: DiscordChannel[] | undefined;
    force?: boolean | undefined;
    stage?: boolean | undefined;
    only?: string[] | undefined;
  },
): Promise<BatchResult> {
  // Protection (2): fail fast before staging anything under the home.
  guardHome(ctx);
  const safety = safetyFor(ctx);
  const payloadVersion = ctx.payloadVersion ?? VESTRA_VERSION;
  const dir =
    options?.stage === false
      ? payloadDirFor(layoutHome(ctx.homeDir).payloadRoot, payloadVersion)
      : await ensurePayload(ctx);
  const sources = await loadPayloadSources(dir);
  const payload = {
    bundleSource: sources["vestra.js"],
    preloadSource: sources["vestra-preload.cjs"],
    mainHookSource: sources["vestra-main-hook.cjs"],
    loaderSource: sources["vestra-loader.js"],
  };
  const { registryPath } = layoutHome(ctx.homeDir);
  const registry = await loadRegistry(registryPath);
  const results: PerInstallResult[] = [];

  for (const install of targetsFor(ctx, options?.channels, options?.only)) {
    const done = async (r: PerInstallResult): Promise<void> => {
      results.push(r);
      if (r.ok && r.action !== "skipped") {
        registry[install.asarPath] = {
          asarPath: install.asarPath,
          channel: install.channel,
          installVersion: install.version,
          payloadVersion: ctx.payloadVersion ?? VESTRA_VERSION,
          at: new Date().toISOString(),
          appDir: install.appDir,
          rootDir: install.rootDir,
        };
        await saveRegistry(registryPath, registry);
      }
    };
    try {
      // Protection (1): refuse unsafe test targets before any Discord write.
      guardTarget(install, ctx);
      if (isInjected(install)) {
        if (options?.force !== true) {
          await done({
            asarPath: install.asarPath,
            channel: install.channel,
            ok: true,
            action: "skipped",
            detail: "already injected (use force to re-patch)",
          });
          continue;
        }
      }
      if (options?.force === true) {
        await prepareFreshInstall(install, safety);
      }
      const { plan } = planInject(install, payload, safety);
      await applyInject(plan, payload, safety);
      await done({
        asarPath: install.asarPath,
        channel: install.channel,
        ok: true,
        action: options?.force === true ? "reinstalled" : "installed",
      });
    } catch (err: unknown) {
      await done({
        asarPath: install.asarPath,
        channel: install.channel,
        ok: false,
        action: "failed",
        detail: describe(err),
      });
    }
  }
  return { results };
}

/** Remove Vestra from installs. `purge` also deletes the product home. */
export async function uninstallAll(
  ctx: OperationContext,
  options?: {
    channels?: DiscordChannel[] | undefined;
    purge?: boolean | undefined;
  },
): Promise<BatchResult> {
  // Protection (2): registry writes + optional home purge happen below.
  guardHome(ctx);
  const safety = safetyFor(ctx);
  const { registryPath } = layoutHome(ctx.homeDir);
  const registry = await loadRegistry(registryPath);
  const discovered = targetsFor(ctx, options?.channels);
  const byPath = new Map(discovered.map((i) => [i.asarPath, i] as const));
  // Union: registry entries (even if Discord moved) + injected discoveries.
  const paths = new Set<string>([
    ...Object.keys(registry),
    ...discovered.filter((i) => isInjected(i)).map((i) => i.asarPath),
  ]);
  const results: PerInstallResult[] = [];

  for (const asarPath of paths) {
    const install = byPath.get(asarPath);
    const channel =
      install?.channel ?? registry[asarPath]?.channel ?? "unknown";
    // The channel filter applies to registry records too: an entry outside
    // the filter is neither present nor stale — leave it completely alone.
    if (install === undefined && !channelMatches(options?.channels, channel)) {
      continue;
    }
    try {
      if (install === undefined) {
        // Discord is gone; drop the stale record.
        delete registry[asarPath];
        await saveRegistry(registryPath, registry);
        results.push({
          asarPath,
          channel,
          ok: true,
          action: "forgotten",
          detail: "install no longer present",
        });
        continue;
      }
      // Protection (1): refuse unsafe test targets before any Discord write.
      guardTarget(install, ctx);
      if (!isInjected(install)) {
        delete registry[asarPath];
        await saveRegistry(registryPath, registry);
        results.push({
          asarPath,
          channel,
          ok: true,
          action: "skipped",
          detail: "not injected",
        });
        continue;
      }
      await uninject(install, safety);
      delete registry[asarPath];
      await saveRegistry(registryPath, registry);
      results.push({ asarPath, channel, ok: true, action: "uninstalled" });
    } catch (err: unknown) {
      results.push({
        asarPath,
        channel,
        ok: false,
        action: "failed",
        detail: describe(err),
      });
    }
  }

  if (options?.purge === true) {
    await fs.promises.rm(ctx.homeDir, { recursive: true, force: true });
  }
  return { results };
}

export interface HealthReport {
  asarPath: string;
  channel: string;
  injected: boolean;
  registered: boolean;
  payloadOk: boolean;
  asarOk: boolean;
  healthy: boolean;
  detail: string;
}

/** Deep health check without full unpacks (single-file asar reads). */
export async function checkHealth(
  ctx: OperationContext,
  install: DiscordInstall,
): Promise<HealthReport> {
  const { registryPath, payloadRoot } = layoutHome(ctx.homeDir);
  const base = { asarPath: install.asarPath, channel: install.channel };
  const injected = isInjected(install);
  if (!injected) {
    return {
      ...base,
      injected,
      registered: false,
      payloadOk: false,
      asarOk: false,
      healthy: false,
      detail: "not injected",
    };
  }
  const registry = await loadRegistry(registryPath);
  const entry = registry[install.asarPath];
  const payloadVersion = ctx.payloadVersion ?? VESTRA_VERSION;
  const dir = payloadDirFor(
    payloadRoot,
    entry?.payloadVersion ?? payloadVersion,
  );
  const staged = await verifyPayload(dir);
  let asarOk = false;
  let detail = "injected";
  try {
    const mainEntry = readAsarMain(install.asarPath);
    const mainSource = readAsarFile(install.asarPath, mainEntry);
    asarOk = mainSource.includes("// __VESTRA_HOOK__");
    for (const filename of [
      "vestra.js",
      "vestra-preload.cjs",
      "vestra-main-hook.cjs",
      "vestra-loader.js",
    ]) {
      const installed = readAsarFile(install.asarPath, `vestra/${filename}`);
      const stagedFile = await fs.promises.readFile(
        path.join(dir, filename),
        "utf8",
      );
      asarOk &&= sha256Hex(installed) === sha256Hex(stagedFile);
    }
    detail = asarOk ? "healthy" : "asar drifted (hook or bundle mismatch)";
  } catch (err: unknown) {
    detail = `asar unreadable: ${describe(err)}`;
  }
  const receiptOk = readReceipt(install) !== undefined;
  const backupOk = hasInjectionBackup(install);
  const healthy = asarOk && staged.ok && entry !== undefined && receiptOk && backupOk;
  return {
    ...base,
    injected,
    registered: entry !== undefined,
    payloadOk: staged.ok,
    asarOk,
    healthy,
    detail: !receiptOk ? "receipt missing or invalid" : !backupOk ? "backup missing" : healthy ? "healthy" : detail,
  };
}

/**
 * Explicit repair restages and reinstalls every selected installation.
 */
export async function repairAll(
  ctx: OperationContext,
  options?: { channels?: DiscordChannel[] | undefined },
): Promise<BatchResult> {
  // Protection (2): fail fast before restaging anything under the home.
  guardHome(ctx);
  const safety = safetyFor(ctx);
  const dir = await ensurePayload(ctx);
  const sources = await loadPayloadSources(dir);
  const payload = {
    bundleSource: sources["vestra.js"],
    preloadSource: sources["vestra-preload.cjs"],
    mainHookSource: sources["vestra-main-hook.cjs"],
    loaderSource: sources["vestra-loader.js"],
  };
  const { registryPath } = layoutHome(ctx.homeDir);
  const registry = await loadRegistry(registryPath);
  const results: PerInstallResult[] = [];

  for (const install of targetsFor(ctx, options?.channels)) {
    try {
      // Protection (1): refuse unsafe test targets before any Discord write.
      guardTarget(install, ctx);
      const health = await checkHealth(ctx, install);
      await prepareFreshInstall(install, safety);
      const { plan } = planInject(install, payload, safety);
      await applyInject(plan, payload, safety);
      registry[install.asarPath] = {
        asarPath: install.asarPath,
        channel: install.channel,
        installVersion: install.version,
        payloadVersion: ctx.payloadVersion ?? VESTRA_VERSION,
        at: new Date().toISOString(),
        appDir: install.appDir,
        rootDir: install.rootDir,
      };
      await saveRegistry(registryPath, registry);
      results.push({
        asarPath: install.asarPath,
        channel: install.channel,
        ok: true,
        action: "repaired",
        detail: health.detail,
      });
    } catch (err: unknown) {
      results.push({
        asarPath: install.asarPath,
        channel: install.channel,
        ok: false,
        action: "failed",
        detail: describe(err),
      });
    }
  }
  return { results };
}

/** Point-in-time status for matching discovered installs plus stale records. */
export async function statusAll(
  ctx: OperationContext,
  options?: { channels?: DiscordChannel[] | undefined },
): Promise<{ health: HealthReport[]; stale: string[] }> {
  const { registryPath } = layoutHome(ctx.homeDir);
  const registry: InstallRegistry = await loadRegistry(registryPath);
  const discovered = listInstalls(ctx.discovery).filter((i) =>
    channelMatches(options?.channels, i.channel),
  );
  const health: HealthReport[] = [];
  for (const install of discovered) {
    health.push(await checkHealth(ctx, install));
  }
  const present = new Set(discovered.map((i) => i.asarPath));
  // Stale = registry records for matching channels whose install is not
  // present in the filtered discovery set. Records outside the filter are
  // neither present nor stale — leave them completely alone.
  const stale = Object.keys(registry).filter(
    (p) =>
      !present.has(p) &&
      channelMatches(options?.channels, registry[p]?.channel ?? "unknown"),
  );
  return { health, stale };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Stale-registry detection + metadata-only prune.
// CORE RULE: pruning removes registry records only. It performs zero Discord
// file writes — no ASAR restore/repack, no receipt/backup deletion, no
// uninstall/repair calls. The only write is the atomic registry save.
// ---------------------------------------------------------------------------

/** Stable reason codes for stale detection. */
export type StaleReason = "installation-missing" | "superseded-version";
/** Reasons a record is kept (never deleted). */
export type KeepReason =
  | "active"
  | "ambiguous"
  | "malformed"
  | "channel-filtered";

export type StaleDecision =
  | { stale: true; reason: StaleReason; detail?: string | undefined }
  | { stale: false; reason: KeepReason; detail?: string | undefined };

export interface PruneSkipped {
  key: string;
  reason: KeepReason;
  detail?: string | undefined;
}

export interface PruneStaleDetail {
  key: string;
  channel: string;
  installVersion: string;
  reason: StaleReason;
}

export interface PruneResult {
  /** Registry keys removed (metadata only). */
  removed: PruneStaleDetail[];
  /** In-scope records confirmed active and kept. */
  active: string[];
  /** Retained-but-reported records (ambiguous/malformed/out-of-filter). */
  skipped: PruneSkipped[];
  dryRun: boolean;
}

function isFileSync(p: string): boolean {
  // Recorded `app.asar` existence probes: physical semantics under Electron.
  try {
    return getRealFs().statSync(p).isFile();
  } catch {
    return false;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (Number.isNaN(na) || Number.isNaN(nb)) return a < b ? -1 : 1;
    if (na !== nb) return na - nb;
  }
  return 0;
}

interface RecordIdentity {
  target: string;
  channel: string;
  version: string;
  appDir: string | undefined;
  rootDir: string | undefined;
  ambiguousDetail: string | undefined;
}

/**
 * Resolve a registry record to path/channel identity.
 * Missing optional `appDir`/`rootDir` are derived from `asarPath` only when
 * the path unambiguously ends in `resources/app.asar`.
 */
function resolveRecordIdentity(key: string, raw: unknown): RecordIdentity {
  const fallback = {
    target: key,
    channel: "",
    version: "",
    appDir: undefined,
    rootDir: undefined,
  };
  if (typeof raw !== "object" || raw === null) {
    return { ...fallback, ambiguousDetail: "record is not an object" };
  }
  const entry = raw as Partial<RegistryEntry>;
  const target =
    typeof entry.asarPath === "string" && entry.asarPath !== ""
      ? entry.asarPath
      : key;
  if (typeof target !== "string" || target === "") {
    return { ...fallback, target: key, ambiguousDetail: "missing asarPath" };
  }
  const channel = typeof entry.channel === "string" ? entry.channel : "";
  if (channel !== "stable" && channel !== "ptb" && channel !== "canary") {
    return {
      ...fallback,
      target,
      channel,
      version:
        typeof entry.installVersion === "string" ? entry.installVersion : "",
      ambiguousDetail: `unknown channel "${channel}"`,
    };
  }
  const version =
    typeof entry.installVersion === "string" ? entry.installVersion : "";
  let appDir =
    typeof entry.appDir === "string" && entry.appDir !== ""
      ? entry.appDir
      : undefined;
  let rootDir =
    typeof entry.rootDir === "string" && entry.rootDir !== ""
      ? entry.rootDir
      : undefined;
  if (appDir === undefined || rootDir === undefined) {
    // Derive only when unambiguous: <appDir>/resources/app.asar.
    if (path.basename(target) !== "app.asar") {
      return {
        target,
        channel,
        version,
        appDir,
        rootDir,
        ambiguousDetail: "asarPath does not end in app.asar",
      };
    }
    const resourcesDir = path.dirname(target);
    if (path.basename(resourcesDir) !== "resources") {
      return {
        target,
        channel,
        version,
        appDir,
        rootDir,
        ambiguousDetail: "asarPath is not inside a resources dir",
      };
    }
    const derivedAppDir = path.dirname(resourcesDir);
    if (appDir === undefined) appDir = derivedAppDir;
    if (rootDir === undefined) {
      const base = path.basename(derivedAppDir);
      rootDir = base.startsWith("app-")
        ? path.dirname(derivedAppDir)
        : derivedAppDir;
    }
  }
  return {
    target,
    channel,
    version,
    appDir,
    rootDir,
    ambiguousDetail: undefined,
  };
}

/**
 * Decide whether a single registry record is stale.
 * `discovered` is the full (unfiltered) discovery set; channel filtering is
 * applied by the caller so out-of-scope records are never assessed here.
 */
export function assessStaleRecord(
  key: string,
  raw: unknown,
  discovered: DiscordInstall[],
): StaleDecision {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { asarPath?: unknown }).asarPath !== "string"
  ) {
    return {
      stale: false,
      reason: "malformed",
      detail: "record has no asarPath string",
    };
  }
  const id = resolveRecordIdentity(key, raw);
  if (id.ambiguousDetail !== undefined) {
    return { stale: false, reason: "ambiguous", detail: id.ambiguousDetail };
  }
  // Exact path match against any discovered install (any channel — the path
  // is authoritative; channel mismatch alone never marks stale).
  if (discovered.some((d) => d.asarPath === id.target)) {
    return { stale: false, reason: "active" };
  }
  // Rule A: recorded asar path no longer exists.
  // (Rule B, superseded sibling, needs the full discovery set — see
  // `findStaleRecords`. An existing but undiscovered path is ambiguous here.)
  if (!isFileSync(id.target)) {
    return { stale: true, reason: "installation-missing" };
  }
  return {
    stale: false,
    reason: "ambiguous",
    detail: "existing path needs sibling context (see findStaleRecords)",
  };
}

/**
 * Full stale assessment with Rule A (missing) and Rule B (superseded sibling).
 * Kept separate from `assessStaleRecord` so tests can exercise the
 * single-record fast path without filesystem siblings.
 */
export function findStaleRecords(
  registry: InstallRegistry,
  malformedKeys: string[],
  discovered: DiscordInstall[],
  channels?: DiscordChannel[] | undefined,
): { stale: PruneStaleDetail[]; active: string[]; skipped: PruneSkipped[] } {
  const stale: PruneStaleDetail[] = [];
  const active: string[] = [];
  const skipped: PruneSkipped[] = [];
  const activeByPath = new Set(discovered.map((d) => d.asarPath));

  for (const key of malformedKeys) {
    skipped.push({
      key,
      reason: "malformed",
      detail: "record has no asarPath string",
    });
  }

  for (const [key, entry] of Object.entries(registry)) {
    const channel = (entry as Partial<RegistryEntry>).channel ?? "unknown";
    if (!channelMatches(channels, channel)) {
      skipped.push({
        key,
        reason: "channel-filtered",
        detail: `channel "${channel}" outside filter`,
      });
      continue;
    }
    const id = resolveRecordIdentity(key, entry);
    if (id.ambiguousDetail !== undefined) {
      skipped.push({ key, reason: "ambiguous", detail: id.ambiguousDetail });
      continue;
    }
    // Active: exact asarPath match. Never removed.
    if (activeByPath.has(id.target)) {
      active.push(key);
      continue;
    }
    // Rule A: recorded installation/app.asar path no longer exists.
    if (!isFileSync(id.target)) {
      stale.push({
        key,
        channel: id.channel,
        installVersion: id.version,
        reason: "installation-missing",
      });
      continue;
    }
    // Rule B: historical version directory under the same root while the same
    // channel has a different active install in that root. Path identity
    // (rootDir + appDir) is required — version number alone never decides.
    // Custom explicit roots (record root differs from every active root for
    // this channel) are kept even when a newer version exists elsewhere.
    const activesForChannel = discovered.filter(
      (d) => d.channel === id.channel,
    );
    const sameRootActive = activesForChannel.filter(
      (d) => d.rootDir === id.rootDir && d.asarPath !== id.target,
    );
    if (
      sameRootActive.length > 0 &&
      sameRootActive.every((d) => d.appDir !== id.appDir)
    ) {
      const best = sameRootActive[sameRootActive.length - 1] as DiscordInstall;
      if (
        id.version !== "" &&
        best.version !== "" &&
        compareVersions(id.version, best.version) >= 0
      ) {
        skipped.push({
          key,
          reason: "ambiguous",
          detail: `record version ${id.version} is not older than active ${best.version}`,
        });
        continue;
      }
      stale.push({
        key,
        channel: id.channel,
        installVersion: id.version,
        reason: "superseded-version",
      });
      continue;
    }
    // Exists on disk and is not a superseded sibling (e.g. custom --root):
    // keep rather than delete on ambiguity.
    skipped.push({
      key,
      reason: "ambiguous",
      detail:
        "existing install is not a superseded sibling of an active install",
    });
  }
  return { stale, active, skipped };
}

/**
 * Metadata-only prune: remove confirmed stale registry records.
 * Performs ZERO Discord file writes; the only write is the atomic registry
 * save (skipped entirely for `dryRun` or when nothing is stale).
 */
export async function pruneStaleRecords(
  ctx: OperationContext,
  options?: {
    channels?: DiscordChannel[] | undefined;
    dryRun?: boolean | undefined;
  },
): Promise<PruneResult> {
  // Exempt from protection (1): pruning performs zero Discord file writes.
  // Still subject to protection (2) whenever the registry may be written.
  // Dry runs write nothing and are never blocked.
  if (options?.dryRun !== true) {
    guardHome(ctx);
  }
  const { registryPath } = layoutHome(ctx.homeDir);
  const { registry, malformedKeys, malformed } =
    await loadRegistryWithDiagnostics(registryPath);
  const discovered = listInstalls(ctx.discovery);
  const { stale, active, skipped } = findStaleRecords(
    registry,
    malformedKeys,
    discovered,
    options?.channels,
  );
  const dryRun = options?.dryRun === true;
  if (!dryRun && stale.length > 0) {
    const next: InstallRegistry = { ...registry };
    for (const s of stale) delete next[s.key];
    // Preserve malformed raw entries verbatim: pruning must never silently
    // drop records it does not understand.
    for (const [k, v] of Object.entries(malformed)) {
      (next as Record<string, unknown>)[k] = v;
    }
    await saveRegistry(registryPath, next);
  }
  return { removed: stale, active, skipped, dryRun };
}
