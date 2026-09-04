// Vestra Installer — programmatic service API.
//
// Thin, GUI-safe facade over operations.ts (the engine) and discovery
// (@vestra/injector listInstalls). The CLI (`cli.ts`) and the future Vestra
// Manager GUI both consume this service. The future bootstrap/update-recovery
// logic can also consume it.
//
// Rules:
// - Structured typed results only. No console output. No process exit codes.
// - Discovery (cheap metadata) and health (status/check) stay separate.
// - status() is cheap: isInjected + registry presence only. It never reads
//   ASAR contents. Only check() may claim authoritative deep integrity.
// - Channel filtering reuses operations' channelMatches semantics.
// - testMode / knownFixtureRoots / discovery propagate verbatim to the
//   test-safety guard; no service path bypasses it.
// - onProgress is optional, strongly typed, zero behavior change when absent.

import {
  isInjected,
  listInstalls,
  type DiscordChannel,
  type DiscordInstall,
  type DiscoveryOptions,
} from "@vestra/injector";
import { layoutHome } from "./home.js";
import {
  channelMatches,
  checkHealth,
  installAll,
  pruneStaleRecords,
  repairAll,
  statusAll,
  uninstallAll,
  type BatchResult,
  type HealthReport,
  type OperationContext,
  type PerInstallResult,
  type PruneResult,
} from "./operations.js";
import { loadRegistry } from "./registry.js";

export type { DiscordChannel, DiscoveryOptions };
export type {
  BatchResult,
  HealthReport,
  OperationContext,
  PerInstallResult,
  PruneResult,
} from "./operations.js";

// ---------------------------------------------------------------------------
// Context & scoping
// ---------------------------------------------------------------------------

/** Service context. Shape-compatible with OperationContext (the engine). */
export interface InstallerServiceContext {
  homeDir: string;
  bundlePath?: string | undefined;
  payloadVersion?: string | undefined;
  discovery?: DiscoveryOptions | undefined;
  testMode?: boolean | undefined;
  knownFixtureRoots?: string[] | undefined;
}

export interface ChannelScope {
  channels?: DiscordChannel[] | undefined;
}

function toOperationContext(ctx: InstallerServiceContext): OperationContext {
  return {
    homeDir: ctx.homeDir,
    bundlePath: ctx.bundlePath,
    payloadVersion: ctx.payloadVersion,
    discovery: ctx.discovery,
    testMode: ctx.testMode,
    knownFixtureRoots: ctx.knownFixtureRoots,
  };
}

// ---------------------------------------------------------------------------
// Structured data types
// ---------------------------------------------------------------------------

export type InstallHealth =
  | "healthy"
  | "not-installed"
  | "drifted"
  | "stale"
  | "error";

/** Public GUI-safe installation metadata (subset of DiscordInstall). */
export interface DiscordInstallation {
  channel: DiscordChannel;
  version: string | null;
  rootDir: string;
  appDir: string;
  asarPath: string;
  /**
   * Always true today. discover() means "currently active/current candidate
   * installations" (highest app-* per channel root, per listInstalls).
   * Historical version enumeration is out of scope; a future
   * discoverVersions()/discoverHistorical() would cover it.
   */
  isActive: boolean;
}

export function toDiscordInstallation(install: DiscordInstall): DiscordInstallation {
  return {
    channel: install.channel,
    version: install.version === "" ? null : install.version,
    rootDir: install.rootDir,
    appDir: install.appDir,
    asarPath: install.asarPath,
    isActive: true,
  };
}

export type InstallerErrorCode =
  | "discord-not-found"
  | "permission-denied"
  | "invalid-asar"
  | "receipt-invalid"
  | "backup-missing"
  | "patch-failed"
  | "verification-failed"
  | "safety-refusal"
  | "unknown";

/**
 * Map a human-readable engine detail string to a stable machine-readable
 * code. Additive only: the original detail string is always preserved.
 * Never exposes raw Error objects in the public contract.
 */
export function toErrorCode(detail: string | undefined): InstallerErrorCode {
  if (detail === undefined || detail === "") return "unknown";
  if (/Refusing (destructive test write|test registry write)/.test(detail)) return "safety-refusal";
  if (/real Discord install|real Vestra home|outside sandbox home|fixture identity|VESTRA_ALLOW_LIVE_TESTS/.test(detail)) {
    return "safety-refusal";
  }
  if (/EACCES|EPERM|permission denied/i.test(detail)) return "permission-denied";
  if (/asar unreadable|invalid asar|not a valid asar|bad asar/i.test(detail)) return "invalid-asar";
  if (/receipt/i.test(detail)) return "receipt-invalid";
  if (/backup/i.test(detail)) return "backup-missing";
  if (/drifted|mismatch|verification|corrupt|hash/i.test(detail)) return "verification-failed";
  if (/failed|inject|patch|repair|uninstall/i.test(detail)) return "patch-failed";
  if (/no .*install|not found|no longer present|installation-missing/i.test(detail)) return "discord-not-found";
  return "unknown";
}

export interface InstallStatus {
  installation: DiscordInstallation;
  health: InstallHealth;
  /** isInjected() signal (cheap for status, deep-confirmed for check). */
  vestraInstalled: boolean;
  /** True when an install/repair could change the outcome. */
  repairable: boolean;
  detail?: string | undefined;
  /** Stable machine-readable code. Additive; detail is preserved. */
  code?: InstallerErrorCode | undefined;
}

export interface StatusSummary {
  /**
   * Cheap/general state. A "healthy" status here means shallow-healthy
   * (injected + registered) — NOT hash-verified. Only check() verifies bytes.
   */
  statuses: InstallStatus[];
  /** Registry keys in-scope whose install was not discovered. */
  stale: string[];
}

export interface CheckSummary {
  /** Authoritative deep integrity per install (asar bytes + payload + registry). */
  statuses: InstallStatus[];
  stale: string[];
}

/** Per-install result with additive machine-readable code. */
export type ServicePerInstallResult = PerInstallResult & {
  code?: InstallerErrorCode | undefined;
};

export interface OperationSummary {
  ok: boolean;
  results: ServicePerInstallResult[];
}

export type PruneSummary = PruneResult;

// ---------------------------------------------------------------------------
// Progress foundation (optional, phased, no percentages)
// ---------------------------------------------------------------------------

export type InstallerOperation =
  | "discover"
  | "status"
  | "check"
  | "install"
  | "repair"
  | "uninstall"
  | "prune";

export type InstallerPhase =
  | "discovering"
  | "staging"
  | "patching"
  | "verifying"
  | "complete";

export interface InstallerProgressEvent {
  operation: InstallerOperation;
  phase: InstallerPhase;
  installation?: DiscordInstallation | undefined;
  index?: number | undefined;
  total?: number | undefined;
}

export type InstallerProgressListener = (event: InstallerProgressEvent) => void;

export interface DiscoverOptions extends ChannelScope {
  onProgress?: InstallerProgressListener | undefined;
}
export interface StatusOptions extends ChannelScope {
  onProgress?: InstallerProgressListener | undefined;
}
export interface CheckOptions extends ChannelScope {
  onProgress?: InstallerProgressListener | undefined;
}
export interface InstallOptions extends ChannelScope {
  force?: boolean | undefined;
  stage?: boolean | undefined;
  only?: string[] | undefined;
  onProgress?: InstallerProgressListener | undefined;
}
export interface RepairOptions extends ChannelScope {
  onProgress?: InstallerProgressListener | undefined;
}
export interface UninstallOptions extends ChannelScope {
  purge?: boolean | undefined;
  onProgress?: InstallerProgressListener | undefined;
}
export interface PruneOptions extends ChannelScope {
  dryRun?: boolean | undefined;
  onProgress?: InstallerProgressListener | undefined;
}

function emit(listener: InstallerProgressListener | undefined, event: InstallerProgressEvent): void {
  if (listener === undefined) return;
  listener(event);
}

// ---------------------------------------------------------------------------
// Health mapping
// ---------------------------------------------------------------------------

function fromDeepReport(
  install: DiscordInstall,
  report: HealthReport,
): InstallStatus {
  const installation = toDiscordInstallation(install);
  if (report.healthy) {
    return {
      installation,
      health: "healthy",
      vestraInstalled: true,
      repairable: false,
      detail: "healthy",
    };
  }
  if (!report.injected) {
    return {
      installation,
      health: "not-installed",
      vestraInstalled: false,
      repairable: true,
      detail: report.detail,
    };
  }
  // Injected but unhealthy: drifted (receipt/registry/payload/asar).
  let code: InstallerErrorCode = "verification-failed";
  if (!report.registered) code = "receipt-invalid";
  else if (!report.payloadOk) code = "verification-failed";
  else if (!report.asarOk) code = "verification-failed";
  return {
    installation,
    health: "drifted",
    vestraInstalled: true,
    repairable: true,
    detail: report.detail,
    code,
  };
}

function withCode(result: PerInstallResult): ServicePerInstallResult {
  if (result.ok) return result;
  return { ...result, code: toErrorCode(result.detail) };
}

function summarize(batch: BatchResult): OperationSummary {
  const results = batch.results.map(withCode);
  return { ok: results.every((r) => r.ok), results };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface InstallerService {
  readonly context: InstallerServiceContext;
  discover(options?: DiscoverOptions): Promise<DiscordInstallation[]>;
  /** Cheap: injected + registry only. Never reads ASAR contents. */
  status(options?: StatusOptions): Promise<StatusSummary>;
  /** Deep: authoritative byte-level verification via checkHealth. */
  check(options?: CheckOptions): Promise<CheckSummary>;
  install(options?: InstallOptions): Promise<OperationSummary>;
  repair(options?: RepairOptions): Promise<OperationSummary>;
  uninstall(options?: UninstallOptions): Promise<OperationSummary>;
  pruneRegistry(options?: PruneOptions): Promise<PruneSummary>;
}

export function createInstallerService(ctx: InstallerServiceContext): InstallerService {
  const opCtx = (): OperationContext => toOperationContext(ctx);

  return {
    context: ctx,

    async discover(options?: DiscoverOptions): Promise<DiscordInstallation[]> {
      emit(options?.onProgress, { operation: "discover", phase: "discovering" });
      const found = listInstalls(ctx.discovery).filter((i) =>
        channelMatches(options?.channels, i.channel),
      );
      const out = found.map(toDiscordInstallation);
      emit(options?.onProgress, { operation: "discover", phase: "complete", total: out.length });
      return out;
    },

    async status(options?: StatusOptions): Promise<StatusSummary> {
      const onProgress = options?.onProgress;
      emit(onProgress, { operation: "status", phase: "discovering" });
      const c = opCtx();
      const discovered = listInstalls(c.discovery).filter((i) =>
        channelMatches(options?.channels, i.channel),
      );
      emit(onProgress, { operation: "status", phase: "verifying", total: discovered.length });
      const { registryPath } = layoutHome(c.homeDir);
      const registry = await loadRegistry(registryPath);
      const statuses: InstallStatus[] = discovered.map((install, index) => {
        const installation = toDiscordInstallation(install);
        emit(onProgress, {
          operation: "status",
          phase: "verifying",
          installation,
          index,
          total: discovered.length,
        });
        const injected = isInjected(install);
        if (!injected) {
          return {
            installation,
            health: "not-installed" as const,
            vestraInstalled: false,
            repairable: true,
            detail: "not installed",
          };
        }
        if (registry[install.asarPath] === undefined) {
          return {
            installation,
            health: "drifted" as const,
            vestraInstalled: true,
            repairable: true,
            detail: "injected but not registered",
            code: "receipt-invalid" as const,
          };
        }
        // Shallow-healthy only: injected + registered, bytes NOT verified.
        return {
          installation,
          health: "healthy" as const,
          vestraInstalled: true,
          repairable: false,
          detail: "installed (not deep-verified)",
        };
      });
      const present = new Set(discovered.map((i) => i.asarPath));
      const stale = Object.keys(registry).filter(
        (p) => !present.has(p) && channelMatches(options?.channels, registry[p]?.channel ?? "unknown"),
      );
      emit(onProgress, { operation: "status", phase: "complete", total: statuses.length });
      return { statuses, stale };
    },

    async check(options?: CheckOptions): Promise<CheckSummary> {
      const onProgress = options?.onProgress;
      emit(onProgress, { operation: "check", phase: "discovering" });
      const c = opCtx();
      const discovered = listInstalls(c.discovery).filter((i) =>
        channelMatches(options?.channels, i.channel),
      );
      const statuses: InstallStatus[] = [];
      for (let index = 0; index < discovered.length; index++) {
        const install = discovered[index] as DiscordInstall;
        const installation = toDiscordInstallation(install);
        emit(onProgress, {
          operation: "check",
          phase: "verifying",
          installation,
          index,
          total: discovered.length,
        });
        try {
          const report = await checkHealth(c, install);
          statuses.push(fromDeepReport(install, report));
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : String(err);
          statuses.push({
            installation,
            health: "error",
            vestraInstalled: false,
            repairable: true,
            detail,
            code: toErrorCode(detail),
          });
        }
      }
      // Reuse the engine's stale-record semantics (filtered discovery set).
      const { stale } = await statusAll(c, { channels: options?.channels });
      emit(onProgress, { operation: "check", phase: "complete", total: statuses.length });
      return { statuses, stale };
    },

    async install(options?: InstallOptions): Promise<OperationSummary> {
      const onProgress = options?.onProgress;
      emit(onProgress, { operation: "install", phase: "discovering" });
      const c = opCtx();
      const targets = listInstalls(c.discovery).filter((i) =>
        channelMatches(options?.channels, i.channel),
      );
      const filtered =
        options?.only === undefined || options.only.length === 0
          ? targets
          : targets.filter((t) => (options.only as string[]).includes(t.asarPath));
      emit(onProgress, { operation: "install", phase: "staging", total: filtered.length });
      for (let index = 0; index < filtered.length; index++) {
        const t = filtered[index] as DiscordInstall;
        emit(onProgress, {
          operation: "install",
          phase: "patching",
          installation: toDiscordInstallation(t),
          index,
          total: filtered.length,
        });
      }
      const batch = await installAll(c, {
        channels: options?.channels,
        force: options?.force,
        stage: options?.stage,
        only: options?.only,
      });
      emit(onProgress, { operation: "install", phase: "verifying", total: batch.results.length });
      const summary = summarize(batch);
      emit(onProgress, { operation: "install", phase: "complete", total: summary.results.length });
      return summary;
    },

    async repair(options?: RepairOptions): Promise<OperationSummary> {
      const onProgress = options?.onProgress;
      emit(onProgress, { operation: "repair", phase: "discovering" });
      const c = opCtx();
      const targets = listInstalls(c.discovery).filter((i) =>
        channelMatches(options?.channels, i.channel),
      );
      for (let index = 0; index < targets.length; index++) {
        const t = targets[index] as DiscordInstall;
        emit(onProgress, {
          operation: "repair",
          phase: "patching",
          installation: toDiscordInstallation(t),
          index,
          total: targets.length,
        });
      }
      const batch = await repairAll(c, { channels: options?.channels });
      emit(onProgress, { operation: "repair", phase: "verifying", total: batch.results.length });
      const summary = summarize(batch);
      emit(onProgress, { operation: "repair", phase: "complete", total: summary.results.length });
      return summary;
    },

    async uninstall(options?: UninstallOptions): Promise<OperationSummary> {
      const onProgress = options?.onProgress;
      emit(onProgress, { operation: "uninstall", phase: "discovering" });
      const batch = await uninstallAll(opCtx(), {
        channels: options?.channels,
        purge: options?.purge,
      });
      emit(onProgress, { operation: "uninstall", phase: "verifying", total: batch.results.length });
      const summary = summarize(batch);
      emit(onProgress, { operation: "uninstall", phase: "complete", total: summary.results.length });
      return summary;
    },

    async pruneRegistry(options?: PruneOptions): Promise<PruneSummary> {
      const onProgress = options?.onProgress;
      emit(onProgress, { operation: "prune", phase: "discovering" });
      const result = await pruneStaleRecords(opCtx(), {
        channels: options?.channels,
        dryRun: options?.dryRun,
      });
      emit(onProgress, {
        operation: "prune",
        phase: "complete",
        total: result.removed.length,
      });
      return result;
    },
  };
}
