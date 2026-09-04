// Vestra Store — installed-plugin management.
// Phase 13. Third-party plugins live under `{home}/plugins/<name>/<version>/`
// with an `installed.json` registry carrying the enabled flag. Installed
// plugins start DISABLED; the user enables explicitly. The renderer entry
// convention (executed by the preload injector after Vestra.start):
//
//   Vestra.Plugins.register({ name: "...", description: "...", authors: [...] });
//   Vestra.Plugins.enable("...");
//
// The preload only injects registry-enabled entries, so the entry above is
// sufficient. Registry writes are atomic; corrupt registries read as empty.

import * as fs from "node:fs";
import * as path from "node:path";
import { compareVersions, type FetchFn } from "@vestra/updater";
import { fetchPluginFeed, searchFeed, type StorePluginEntry } from "./feed.js";
import { parsePluginEnvelope, writePluginPayload } from "./envelope.js";

export const PLUGINS_DIR = "plugins";
export const INSTALLED_FILE = "installed.json";
export const REPOS_FILE = "repos.json";

export interface StoreContext {
  homeDir: string;
  feedUrl?: string | undefined;
  fetchFn?: FetchFn | undefined;
}

export interface InstalledPlugin {
  version: string;
  enabled: boolean;
  at: string;
  description?: string | undefined;
  authors?: string[] | undefined;
}

export type InstalledRegistry = Record<string, InstalledPlugin>;

export function pluginsRootFor(homeDir: string): string {
  return path.join(homeDir, PLUGINS_DIR);
}

function registryPathFor(homeDir: string): string {
  return path.join(pluginsRootFor(homeDir), INSTALLED_FILE);
}

function reposPathFor(homeDir: string): string {
  return path.join(homeDir, REPOS_FILE);
}

/** Load installed registry. Missing/corrupt reads as empty. */
export async function loadInstalled(homeDir: string): Promise<InstalledRegistry> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(registryPathFor(homeDir), "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: InstalledRegistry = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof value === "object" && value !== null &&
        typeof (value as { version?: unknown }).version === "string" &&
        typeof (value as { enabled?: unknown }).enabled === "boolean"
      ) {
        out[name] = value as InstalledPlugin;
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function saveInstalled(homeDir: string, registry: InstalledRegistry): Promise<void> {
  await fs.promises.mkdir(pluginsRootFor(homeDir), { recursive: true });
  const tmpPath = `${registryPathFor(homeDir)}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf8");
  await fs.promises.rename(tmpPath, registryPathFor(homeDir));
}

/** Trusted feed URLs (explicit user action only). */
export async function getRepos(homeDir: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(reposPathFor(homeDir), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u): u is string => typeof u === "string" && u !== "");
  } catch {
    return [];
  }
}

export async function addRepo(homeDir: string, feedUrl: string): Promise<string[]> {
  assertFeedUrl(feedUrl);
  const repos = await getRepos(homeDir);
  if (!repos.includes(feedUrl)) {
    repos.push(feedUrl);
    await fs.promises.mkdir(homeDir, { recursive: true });
    await fs.promises.writeFile(reposPathFor(homeDir), JSON.stringify(repos, null, 2), "utf8");
  }
  return repos;
}

export async function removeRepo(homeDir: string, feedUrl: string): Promise<string[]> {
  const repos = (await getRepos(homeDir)).filter((u) => u !== feedUrl);
  await fs.promises.mkdir(homeDir, { recursive: true });
  await fs.promises.writeFile(reposPathFor(homeDir), JSON.stringify(repos, null, 2), "utf8");
  return repos;
}

function assertFeedUrl(feedUrl: string): void {
  if (typeof feedUrl !== "string" || feedUrl === "") throw new TypeError("A feed URL is required.");
  let u: URL;
  try {
    u = new URL(feedUrl);
  } catch {
    throw new TypeError(`Bad feed URL "${feedUrl}".`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new TypeError(`Feed URL must be http(s): "${feedUrl}".`);
  }
}

function feedUrlsFor(ctx: StoreContext, repos: string[]): string[] {
  const urls = [...repos];
  if (ctx.feedUrl !== undefined && ctx.feedUrl !== "") {
    assertFeedUrl(ctx.feedUrl);
    if (!urls.includes(ctx.feedUrl)) urls.push(ctx.feedUrl);
  }
  return urls;
}

/** List offerings across trusted repos (+ explicit feed). Latest per name wins. */
export async function browsePlugins(ctx: StoreContext): Promise<StorePluginEntry[]> {
  const urls = feedUrlsFor(ctx, await getRepos(ctx.homeDir));
  if (urls.length === 0) throw new Error("No plugin feeds configured (repo-add a feed URL or pass --feed).");
  const latest = new Map<string, StorePluginEntry>();
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const feed = await fetchPluginFeed(url, ctx.fetchFn);
      for (const entry of feed.plugins) {
        const prev = latest.get(entry.name);
        if (prev === undefined || compareVersions(entry.version, prev.version) > 0) {
          latest.set(entry.name, entry);
        }
      }
    } catch (err: unknown) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (latest.size === 0 && errors.length > 0) {
    throw new Error(`All feeds failed: ${errors.join("; ")}`);
  }
  return [...latest.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

export async function searchPlugins(ctx: StoreContext, query: string): Promise<StorePluginEntry[]> {
  return searchFeed({ plugins: await browsePlugins(ctx) }, query);
}

async function findEntry(ctx: StoreContext, name: string): Promise<StorePluginEntry> {
  const found = (await browsePlugins(ctx)).find((e) => e.name === name);
  if (found === undefined) throw new Error(`Plugin "${name}" not found in configured feeds.`);
  return found;
}

async function downloadEnvelope(
  ctx: StoreContext,
  entry: StorePluginEntry,
): Promise<Buffer> {
  const run = ctx.fetchFn ?? defaultFetch;
  let res: { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> };
  try {
    res = await run(entry.url);
  } catch (err: unknown) {
    throw new Error(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}.`);
  return Buffer.from(await res.arrayBuffer());
}

async function defaultFetch(url: string): Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }> {
  const res = await fetch(url);
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    arrayBuffer: async () => res.arrayBuffer(),
  };
}

export interface InstallResult {
  name: string;
  version: string;
  dir: string;
  alreadyInstalled: boolean;
}

/** Install (disabled by default) or refresh an already-installed version. */
export async function installPlugin(ctx: StoreContext, name: string): Promise<InstallResult> {
  assertPluginName(name);
  const entry = await findEntry(ctx, name);
  const bytes = await downloadEnvelope(ctx, entry);
  const envelope = parsePluginEnvelope(bytes, entry.sha256, name);
  const dir = await writePluginPayload(pluginsRootFor(ctx.homeDir), envelope);
  const registry = await loadInstalled(ctx.homeDir);
  const alreadyInstalled = registry[name]?.version === envelope.pluginVersion;
  registry[name] = {
    version: envelope.pluginVersion,
    enabled: registry[name]?.enabled ?? false,
    at: new Date().toISOString(),
    description: entry.description,
    authors: [...entry.authors],
  };
  await saveInstalled(ctx.homeDir, registry);
  return { name, version: envelope.pluginVersion, dir, alreadyInstalled };
}

/** Update to the newest feed version above the installed one. */
export async function updatePlugin(
  ctx: StoreContext,
  name: string,
): Promise<{ updated: boolean; version: string }> {
  assertPluginName(name);
  const registry = await loadInstalled(ctx.homeDir);
  const installed = registry[name];
  if (installed === undefined) throw new Error(`Plugin "${name}" is not installed.`);
  const entry = await findEntry(ctx, name);
  if (compareVersions(entry.version, installed.version) <= 0) {
    return { updated: false, version: installed.version };
  }
  const bytes = await downloadEnvelope(ctx, entry);
  const envelope = parsePluginEnvelope(bytes, entry.sha256, name);
  await writePluginPayload(pluginsRootFor(ctx.homeDir), envelope);
  registry[name] = {
    ...installed,
    version: envelope.pluginVersion,
    at: new Date().toISOString(),
    description: entry.description,
    authors: [...entry.authors],
  };
  await saveInstalled(ctx.homeDir, registry);
  return { updated: true, version: envelope.pluginVersion };
}

/** Remove a plugin entirely (all versions + registry). */
export async function removePlugin(ctx: StoreContext, name: string): Promise<void> {
  assertPluginName(name);
  const registry = await loadInstalled(ctx.homeDir);
  if (registry[name] === undefined) throw new Error(`Plugin "${name}" is not installed.`);
  delete registry[name];
  await saveInstalled(ctx.homeDir, registry);
  await fs.promises.rm(path.join(pluginsRootFor(ctx.homeDir), name), { recursive: true, force: true });
}

/** Flip the enabled flag consumed by the preload injector. */
export async function setPluginEnabled(ctx: StoreContext, name: string, enabled: boolean): Promise<InstalledPlugin> {
  assertPluginName(name);
  const registry = await loadInstalled(ctx.homeDir);
  const installed = registry[name];
  if (installed === undefined) throw new Error(`Plugin "${name}" is not installed.`);
  installed.enabled = enabled;
  installed.at = new Date().toISOString();
  await saveInstalled(ctx.homeDir, registry);
  return installed;
}

/** Installed plugins with a presence check (dir still on disk?). */
export async function listInstalled(
  homeDir: string,
): Promise<Array<InstalledPlugin & { name: string; present: boolean }>> {
  const registry = await loadInstalled(homeDir);
  const out: Array<InstalledPlugin & { name: string; present: boolean }> = [];
  for (const [name, entry] of Object.entries(registry)) {
    let present = false;
    try {
      const st = await fs.promises.stat(path.join(pluginsRootFor(homeDir), name, entry.version));
      present = st.isDirectory();
    } catch {
      present = false;
    }
    out.push({ name, ...entry, present });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Drop unreferenced version dirs (keeps each plugin's registry version). */
export async function prunePlugins(homeDir: string): Promise<string[]> {
  const registry = await loadInstalled(homeDir);
  const root = pluginsRootFor(homeDir);
  let names: string[];
  try {
    names = await fs.promises.readdir(root);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (name === INSTALLED_FILE || name.endsWith(".tmp")) continue;
    const dir = path.join(root, name);
    let st: { isDirectory(): boolean };
    try {
      st = await fs.promises.stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const keep = registry[name]?.version;
    let versions: string[];
    try {
      versions = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const v of versions) {
      if (v !== keep) {
        await fs.promises.rm(path.join(dir, v), { recursive: true, force: true });
        removed.push(`${name}@${v}`);
      }
    }
    if (keep === undefined) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed.sort();
}

function assertPluginName(name: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    throw new TypeError(`Bad plugin name "${name}".`);
  }
}
