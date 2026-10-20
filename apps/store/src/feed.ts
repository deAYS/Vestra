import { compareVersions } from "@vestra/updater";
import type { FetchFn } from "@vestra/updater";
import { assertSafeVersion } from "@vestra/shared";

export interface StorePluginEntry {
  name: string;
  version: string;
  description: string;
  authors: string[];
  url: string;
  sha256: string;
}

export interface PluginFeed {
  plugins: StorePluginEntry[];
}

function isEntry(value: unknown): value is StorePluginEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  if (typeof e["name"] !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(e["name"])) return false;
  if (typeof e["version"] !== "string" || e["version"] === "") return false;
  try { assertSafeVersion(e["version"]); } catch { return false; }
  if (typeof e["description"] !== "string" || e["description"] === "") return false;
  if (!Array.isArray(e["authors"]) || e["authors"].length === 0 || e["authors"].some((a) => typeof a !== "string" || a === "")) {
    return false;
  }
  if (typeof e["url"] !== "string" || e["url"] === "") return false;
  if (typeof e["sha256"] !== "string" || !/^[0-9a-fA-F]{64}$/.test(e["sha256"])) return false;
  try {
    const u = new URL(e["url"] as string);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  } catch {
    return false;
  }
  return true;
}

/** Fetch + validate a feed. Throws on transport failure or unusable feed. */
export async function fetchPluginFeed(feedUrl: string, fetchFn?: FetchFn): Promise<PluginFeed> {
  if (feedUrl === "") throw new TypeError("fetchPluginFeed() requires a feed URL.");
  const run = fetchFn ?? defaultFetch;
  let res: { ok: boolean; status: number; text(): Promise<string> };
  try {
    res = await run(feedUrl);
  } catch (err: unknown) {
    throw new Error(`Plugin feed fetch failed: ${describe(err)}`);
  }
  if (!res.ok) throw new Error(`Plugin feed fetch failed: HTTP ${res.status}.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    throw new Error("Plugin feed is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Plugin feed has an unexpected shape.");
  }
  const raw = (parsed as Record<string, unknown>)["plugins"];
  if (!Array.isArray(raw)) throw new Error("Plugin feed has no plugins array.");
  const plugins = raw.filter(isEntry);
  // Newest version first per plugin name.
  const latest = new Map<string, StorePluginEntry>();
  for (const entry of plugins) {
    const prev = latest.get(entry.name);
    if (prev === undefined || compareVersions(entry.version, prev.version) > 0) {
      latest.set(entry.name, entry);
    }
  }
  return { plugins: [...latest.values()].sort((a, b) => (a.name < b.name ? -1 : 1)) };
}

/** Case-insensitive search across name, description and authors. */
export function searchFeed(feed: PluginFeed, query: string): StorePluginEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return feed.plugins;
  return feed.plugins.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.authors.some((a) => a.toLowerCase().includes(q)),
  );
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

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
