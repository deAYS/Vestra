import * as fs from "node:fs";
import * as path from "node:path";
import { assertSafeVersion, VESTRA_VERSION } from "@vestra/shared";
import {
  installAll,
  layoutHome,
  loadRegistry,
  readPayloadManifest,
  verifyPayload,
} from "@vestra/installer";
import {
  assertTestHomeAllowed,
  type SafetyOptions,
} from "@vestra/shared/node/testSafety.js";
import type { DiscoveryOptions } from "@vestra/injector";
import { compareVersions, fetchFeed, newestAbove, type FetchFn, type ResponseLike } from "./feed.js";
import { parseEnvelope, writeEnvelopePayload } from "./envelope.js";

export const UPDATE_STATUS_FILE = "update-status.json";

export interface UpdateContext {
  homeDir: string;
  feedUrl?: string | undefined;
  discovery?: DiscoveryOptions | undefined;
  fetchFn?: FetchFn | undefined;
  /**
   * Explicit test context (authoritative). `true` enables the test-safety
   * guards; `false` forces production behavior. When omitted, falls back
   * to `VESTRA_TEST=1`. Production callers leave this unset.
   */
  testMode?: boolean | undefined;
  /** Explicitly known fixture roots (allowed test targets / sandbox homes). */
  knownFixtureRoots?: string[] | undefined;
}

/** Collect the test-safety policy carried by an update context. */
function safetyFor(ctx: UpdateContext): SafetyOptions {
  return {
    testMode: ctx.testMode,
    discovery: ctx.discovery,
    knownFixtureRoots: ctx.knownFixtureRoots,
  };
}

/** Protection (2): refuse Vestra home writes outside sandbox homes. */
function guardHome(ctx: UpdateContext): void {
  assertTestHomeAllowed(ctx.homeDir, safetyFor(ctx));
}

export interface UpdateStatus {
  available: boolean;
  version?: string | undefined;
  current: string;
  at: string;
}

export interface DownloadResult {
  version: string;
  payloadDir: string;
  alreadyStaged: boolean;
}

export interface ApplyResult {
  version: string;
  reinstalled: string[];
  rolledBack: string[];
  failed: Array<{ asarPath: string; error: string }>;
}

/** Highest staged payload version with a valid manifest, else the package version. */
export async function currentStagedVersion(homeDir: string): Promise<string> {
  const { payloadRoot } = layoutHome(homeDir);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(payloadRoot);
  } catch {
    return VESTRA_VERSION;
  }
  let best = "";
  for (const entry of entries) {
    const manifest = await readPayloadManifest(path.join(payloadRoot, entry));
    if (manifest === undefined) continue;
    if (best === "" || compareVersions(manifest.payloadVersion, best) > 0) {
      best = manifest.payloadVersion;
    }
  }
  return best === "" ? VESTRA_VERSION : best;
}

/** Downloading a release does not install it. Compare feeds to recorded installs. */
export async function currentInstalledVersion(homeDir: string): Promise<string> {
  const registry = await loadRegistry(layoutHome(homeDir).registryPath);
  const versions = Object.values(registry).map(entry => entry.payloadVersion).filter(version => {
    try { assertSafeVersion(version); return true; } catch { return false; }
  });
  return versions.sort(compareVersions)[0] ?? VESTRA_VERSION;
}

/** Check the feed; persist the status file for the main hook. Never throws on feed shape issues. */
export async function checkForUpdates(ctx: UpdateContext): Promise<UpdateStatus> {
  if (ctx.feedUrl === undefined || ctx.feedUrl === "") {
    throw new TypeError("checkForUpdates() requires a feedUrl.");
  }
  // Protection (2): the status file is written under the home.
  guardHome(ctx);
  const current = await currentInstalledVersion(ctx.homeDir);
  const feed = await fetchFeed(ctx.feedUrl, ctx.fetchFn);
  const newest = newestAbove(feed, current);
  const status: UpdateStatus = {
    available: newest !== undefined,
    version: newest?.version,
    current,
    at: new Date().toISOString(),
  };
  await fs.promises.mkdir(ctx.homeDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(ctx.homeDir, UPDATE_STATUS_FILE),
    JSON.stringify(status, null, 2),
    "utf8",
  );
  return status;
}

/** Download + verify + stage a release (default: newest above current). */
export async function downloadUpdate(
  ctx: UpdateContext,
  version?: string,
): Promise<DownloadResult> {
  if (ctx.feedUrl === undefined || ctx.feedUrl === "") {
    throw new TypeError("downloadUpdate() requires a feedUrl.");
  }
  // Protection (2): the envelope payload is staged under the home.
  guardHome(ctx);
  const current = await currentInstalledVersion(ctx.homeDir);
  const feed = await fetchFeed(ctx.feedUrl, ctx.fetchFn);
  const target =
    version === undefined
      ? newestAbove(feed, current)
      : feed.releases.find((r) => r.version === version);
  if (target === undefined) {
    throw new Error(
      version === undefined ? `Already current (${current}).` : `Release ${version} not in feed.`,
    );
  }
  const { payloadRoot } = layoutHome(ctx.homeDir);
  const existing = await readPayloadManifest(path.join(payloadRoot, target.version));
  if (existing !== undefined) {
    const check = await verifyPayload(path.join(payloadRoot, target.version));
    if (check.ok) return { version: target.version, payloadDir: path.join(payloadRoot, target.version), alreadyStaged: true };
  }
  const run = ctx.fetchFn ?? defaultFetch;
  let bytes: Buffer;
  try {
    const res = await run(target.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}.`);
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err: unknown) {
    throw new Error(`Download failed: ${describe(err)}`);
  }
  const envelope = parseEnvelope(bytes, target.sha256);
  if (envelope.payloadVersion !== target.version) {
    throw new Error("Envelope version does not match the feed entry.");
  }
  const dir = await writeEnvelopePayload(payloadRoot, envelope);
  return { version: target.version, payloadDir: dir, alreadyStaged: false };
}

/**
 * Re-inject touched installs (registry entries below `version`) with the new
 * payload. A failed re-inject rolls that install back to its previous payload
 * version; failures are reported per install, never thrown.
 */
export async function applyUpdate(ctx: UpdateContext, version: string): Promise<ApplyResult> {
  assertSafeVersion(version);
  if (version === "") throw new TypeError("applyUpdate() requires a version.");
  // Protection (2): registry entries are re-recorded under the home below.
  guardHome(ctx);
  const { payloadRoot, registryPath } = layoutHome(ctx.homeDir);
  const dir = path.join(payloadRoot, version);
  const check = await verifyPayload(dir);
  if (!check.ok) throw new Error(`Payload ${version} missing or corrupt (${check.bad.join(", ")}).`);
  const registry = await loadRegistry(registryPath);
  const result: ApplyResult = { version, reinstalled: [], rolledBack: [], failed: [] };

  for (const [asarPath, entry] of Object.entries(registry)) {
    if (entry.payloadVersion === version) continue;
    const previous = entry.payloadVersion;
    // Re-inject with the new payload (force clears any stale state; the
    // payload is already staged from a verified envelope — no local bundle).
    // Scoped to this install: a neighbor's failure must never touch others.
    // Test-safety policy is forwarded so updater apply/rollback cannot
    // bypass the Discord-mutation guard.
    const batch = await installAll(
      {
        homeDir: ctx.homeDir,
        payloadVersion: version,
        discovery: ctx.discovery,
        testMode: ctx.testMode,
        knownFixtureRoots: ctx.knownFixtureRoots,
      },
      { force: true, stage: false, only: [asarPath] },
    );
    const mine = batch.results.find((r) => r.asarPath === asarPath);
    if (mine === undefined) {
      result.failed.push({ asarPath, error: "install not discovered; cannot update" });
      continue;
    }
    if (mine.ok) {
      result.reinstalled.push(asarPath);
      continue;
    }
    // Roll back to the previous payload version.
    try {
      const rollback = await installAll(
        {
          homeDir: ctx.homeDir,
          payloadVersion: previous,
          discovery: ctx.discovery,
          testMode: ctx.testMode,
          knownFixtureRoots: ctx.knownFixtureRoots,
        },
        { force: true, stage: false, only: [asarPath] },
      );
      const back = rollback.results.find((r) => r.asarPath === asarPath);
      if (back !== undefined && back.ok) {
        result.rolledBack.push(asarPath);
      } else {
        result.failed.push({ asarPath, error: `update failed (${mine.detail ?? "unknown"}); rollback failed (${back?.detail ?? "unknown"})` });
      }
    } catch (err: unknown) {
      result.failed.push({ asarPath, error: `update failed; rollback threw: ${describe(err)}` });
    }
  }

  // Registry entries were persisted per success by installAll (including
  // rollbacks, which re-record the previous version).
  return result;
}

/** Drop staged versions nobody references (keeps `keep` newest regardless). */
export async function prunePayloads(
  homeDir: string,
  keep = 2,
  safety?: SafetyOptions,
): Promise<string[]> {
  // Protection (2): staged payload directories are deleted under the home.
  assertTestHomeAllowed(homeDir, safety ?? {});
  const { payloadRoot, registryPath } = layoutHome(homeDir);
  const registry = await loadRegistry(registryPath);
  const referenced = new Set(Object.values(registry).map((e) => e.payloadVersion));
  let entries: string[];
  try {
    entries = await fs.promises.readdir(payloadRoot);
  } catch {
    return [];
  }
  const versions = entries
    .filter((e) => e !== "")
    .sort(compareVersions)
    .reverse();
  const removed: string[] = [];
  for (const v of versions.slice(Math.max(0, keep))) {
    if (referenced.has(v)) continue;
    await fs.promises.rm(path.join(payloadRoot, v), { recursive: true, force: true });
    removed.push(v);
  }
  return removed;
}

async function defaultFetch(url: string): Promise<ResponseLike> {
  const res = await fetch(url);
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    arrayBuffer: async () => res.arrayBuffer(),
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
