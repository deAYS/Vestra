// Vestra Updater — release feed.
// Phase 12. Fetches and validates a release feed, picks the newest release
// newer than what's staged. Fetch is injected (tests, custom agents); the
// default uses global fetch. Malformed entries are skipped, never fatal.

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
  const norm = (v: string): { nums: number[]; pre: string } => {
    const [core = "", pre = ""] = v.split("-", 2);
    return { nums: core.split(".").map((s) => (s === "" ? 0 : Number(s))), pre };
  };
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const na = pa.nums[i] ?? 0;
    const nb = pb.nums[i] ?? 0;
    const va = Number.isNaN(na) ? 0 : na;
    const vb = Number.isNaN(nb) ? 0 : nb;
    if (va !== vb) return va - vb;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === "") return 1;
  if (pb.pre === "") return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

function isRelease(value: unknown): value is FeedRelease {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r["version"] !== "string" || r["version"] === "") return false;
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
