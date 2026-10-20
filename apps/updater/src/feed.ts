import { assertSafeVersion } from "@vestra/shared";

export interface FeedRelease {
  version: string;
  url: string;
  sha256: string;
  notes?: string | undefined;
}

export interface ReleaseFeed {
  releases: FeedRelease[];
}

export type FetchFn = (url: string) => Promise<ResponseLike>;

export interface ResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Numeric-aware version compare (empty/invalid sorts lowest). */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string): { nums: bigint[]; pre: string[] } | undefined => {
    try { assertSafeVersion(v); } catch { return undefined; }
    const withoutBuild = v.split("+")[0]!;
    const dash = withoutBuild.indexOf("-");
    const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
    const pre = dash === -1 ? [] : withoutBuild.slice(dash + 1).split(".");
    return { nums: core.split(".").map(s => BigInt(s)), pre };
  };
  const pa = norm(a);
  const pb = norm(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const na = pa.nums[i] ?? 0n;
    const nb = pb.nums[i] ?? 0n;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  if (!pa.pre.length || !pb.pre.length) return pa.pre.length ? -1 : pb.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const left = pa.pre[i];
    const right = pb.pre[i];
    if (left === right) continue;
    if (left === undefined || right === undefined) return left === undefined ? -1 : 1;
    const ln = /^\d+$/.test(left);
    const rn = /^\d+$/.test(right);
    if (ln && rn) return BigInt(left) > BigInt(right) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

function isRelease(value: unknown): value is FeedRelease {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r["version"] !== "string" || r["version"] === "") return false;
  try { assertSafeVersion(r["version"]); } catch { return false; }
  if (typeof r["url"] !== "string" || r["url"] === "") return false;
  if (typeof r["sha256"] !== "string" || !/^[0-9a-fA-F]{64}$/.test(r["sha256"])) return false;
  if (r["notes"] !== undefined && typeof r["notes"] !== "string") return false;
  try {
    const u = new URL(r["url"] as string);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  } catch {
    return false;
  }
  return true;
}

/** Fetch + validate a feed. Throws on transport failure or unusable feed. */
export async function fetchFeed(feedUrl: string, fetchFn?: FetchFn): Promise<ReleaseFeed> {
  if (feedUrl === "") throw new TypeError("fetchFeed() requires a feed URL.");
  const run = fetchFn ?? defaultFetch;
  let res: ResponseLike;
  try {
    res = await run(feedUrl);
  } catch (err: unknown) {
    throw new Error(`Feed fetch failed: ${describe(err)}`);
  }
  if (!res.ok) throw new Error(`Feed fetch failed: HTTP ${res.status}.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    throw new Error("Feed is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Feed has an unexpected shape.");
  }
  const raw = (parsed as Record<string, unknown>)["releases"];
  if (!Array.isArray(raw)) throw new Error("Feed has no releases array.");
  const releases = raw.filter(isRelease);
  // Newest first.
  releases.sort((x, y) => compareVersions(y.version, x.version));
  return { releases };
}

/** Newest release strictly newer than `current`, or undefined. */
export function newestAbove(feed: ReleaseFeed, current: string): FeedRelease | undefined {
  return feed.releases.find((r) => compareVersions(r.version, current) > 0);
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
