import { Logger, type ScopedLogger } from "../api/logger.js";
import { filters } from "./filters.js";
import { defaultRequireSource, enumerateModules, getModuleCache } from "./raw.js";
import { waitForModule } from "./waitFor.js";
import type {
  FluxStoreLike,
  ModuleFilter,
  RequireSource,
  WaitForOptions,
  WebpackExports,
} from "./types.js";

export interface WebpackFinderOptions {
  logger?: ScopedLogger;
  /** Defaults to the real bundle discovery (`raw.getWebpackRequire`). */
  source?: RequireSource;
}

export interface FindOptions {
  /** Cache successful finds by filter identity. Default true. */
  cache?: boolean;
}

type ModuleId = string | number;

interface ModuleMatch {
  id: string;
  exports: WebpackExports;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null
  );
}

export class WebpackFinder {
  private readonly logger: ScopedLogger;
  private readonly source: RequireSource;
  /**
   * Caches hold module ids, never exports: a hit re-reads the module cache
   * and re-validates with the filter, so replaced modules are never served
   * stale and nothing keeps old exports alive.
   */
  private filterCache = new WeakMap<ModuleFilter, ModuleId>();
  /** `props:<JSON of sorted names>`, `displayName:<name>`, `store:<name>` -> module id. */
  private readonly keyCache = new Map<string, ModuleId>();

  constructor(options?: WebpackFinderOptions) {
    this.logger = options?.logger ?? Logger.extend("Webpack");
    this.source = options?.source ?? defaultRequireSource;
  }

  /** True when a webpack require is currently reachable. */
  isAvailable(): boolean {
    try {
      return this.source() !== undefined && this.source() !== null;
    } catch (err: unknown) {
      this.logger.captureError(err, "Webpack.isAvailable");
      return false;
    }
  }

  /** Number of cached modules visible right now (0 outside Discord). */
  getModuleCount(): number {
    let count = 0;
    try {
      const requireFn = this.source();
      if (requireFn === undefined) return 0;
      for (const _entry of enumerateModules(requireFn, { includeDefault: false })) {
        count += 1;
      }
    } catch (err: unknown) {
      this.logger.captureError(err, "Webpack.getModuleCount");
    }
    return count;
  }

  /**
   * Number of entries in the module cache, counted by key without reading any
   * exports (0 when unavailable). Cheap change detection for callers.
   */
  getModuleCacheSize(): number {
    try {
      const cache = getModuleCache(this.source());
      if (cache === undefined) return 0;
      let count = 0;
      for (const _key in cache) count += 1;
      return count;
    } catch (err: unknown) {
      this.logger.captureError(err, "Webpack.getModuleCacheSize");
      return 0;
    }
  }

  /** First module matching `filter`, or undefined. Cached on success. */
  find(filter: ModuleFilter, options?: FindOptions): WebpackExports | undefined {
    if (typeof filter !== "function") throw new Error("Webpack.find() requires a filter function.");
    const useCache = options?.cache ?? true;
    if (useCache) {
      const id = this.filterCache.get(filter);
      if (id !== undefined) {
        const hit = this.revalidate(id, filter);
        if (hit !== undefined) return hit;
        this.filterCache.delete(filter);
      }
    }
    const found = this.scan(filter, 1)[0];
    if (found !== undefined && useCache) this.filterCache.set(filter, found.id);
    return found?.exports;
  }

  /** Every module matching `filter` (fresh scan, never cached). */
  findAll(filter: ModuleFilter, options?: { limit?: number }): WebpackExports[] {
    if (typeof filter !== "function") throw new Error("Webpack.findAll() requires a filter function.");
    const limit = options?.limit;
    if (limit !== undefined && !(limit > 0)) throw new Error("Webpack.findAll() requires limit > 0.");
    return this.scan(filter, limit).map((match) => match.exports);
  }

  /** First module exposing all `props`. */
  findByProps(...props: string[]): WebpackExports | undefined {
    const filter = filters.byProps(...props);
    // JSON keeps ("a,b") and ("a", "b") apart; any string is a valid prop name.
    return this.findKeyed(`props:${JSON.stringify([...props].sort())}`, filter);
  }

  /**
   * First component/module with `displayName`. Returns the module exports;
   * the component itself may live on `.default` (use `result.default ?? result`).
   */
  findByDisplayName(name: string): WebpackExports | undefined {
    const filter = filters.byDisplayName(name);
    return this.findKeyed(`displayName:${name}`, filter);
  }

  /**
   * First Flux store named `name` (best-effort: `getName()`, `displayName`).
   * Returns the raw exports; narrow with `asFluxStore` for typed access.
   */
  findStore(name: string): WebpackExports | undefined {
    const filter = filters.byStoreName(name);
    return this.findKeyed(`store:${name}`, filter);
  }

  /** Keyed lookup: a remembered id is re-validated; a miss or stale id scans. */
  private findKeyed(key: string, filter: ModuleFilter): WebpackExports | undefined {
    const id = this.keyCache.get(key);
    if (id !== undefined) {
      const hit = this.revalidate(id, filter);
      if (hit !== undefined) return hit;
      this.keyCache.delete(key);
    }
    const found = this.scan(filter, 1)[0];
    if (found !== undefined) this.keyCache.set(key, found.id);
    return found?.exports;
  }

  /**
   * Re-read module `id` from the cache and re-test it the way a scan would
   * (exports first, then `.default`). Undefined when gone or no longer matching.
   */
  private revalidate(id: ModuleId, filter: ModuleFilter): WebpackExports | undefined {
    let exports: unknown;
    try {
      const cache = getModuleCache(this.source());
      if (cache === undefined) return undefined;
      const mod = cache[id];
      exports = isRecord(mod) ? mod["exports"] : undefined;
    } catch (err: unknown) {
      this.logger.captureError(err, "Webpack.revalidate");
      return undefined;
    }
    if (!isRecord(exports)) return undefined;
    if (this.test(filter, exports as WebpackExports)) return exports as WebpackExports;
    // Like enumerateModules: a throwing `default` getter is skipped, not an error.
    let def: unknown;
    try {
      def = exports["default"];
    } catch {
      return undefined;
    }
    if (isRecord(def) && def !== exports && this.test(filter, def as WebpackExports)) return def as WebpackExports;
    return undefined;
  }

  /** Run a filter like `scan` does: a throw is logged and counts as a miss. */
  private test(filter: ModuleFilter, candidate: WebpackExports): boolean {
    try {
      return filter(candidate) === true;
    } catch (err: unknown) {
      this.logger.captureError(err, "Webpack.filter");
      return false;
    }
  }

  /** Full module-cache scan in cache order; filter errors are skipped. */
  private scan(filter: ModuleFilter, limit?: number): ModuleMatch[] {
    const out: ModuleMatch[] = [];
    let requireFn: unknown;
    try {
      requireFn = this.source();
    } catch (err: unknown) {
      this.logger.captureError(err, "Webpack.source");
      return out;
    }
    if (requireFn === undefined || requireFn === null) return out;
    try {
      for (const { id, exports } of enumerateModules(requireFn)) {
        let match = false;
        try {
          match = filter(exports) === true;
        } catch (err: unknown) {
          this.logger.captureError(err, "Webpack.filter");
          continue;
        }
        if (match) {
          out.push({ id, exports });
          if (limit !== undefined && out.length >= limit) break;
        }
      }
    } catch (err: unknown) {
      this.logger.captureError(err, "Webpack.findAll");
    }
    return out;
  }

  /** Narrow raw exports to a Flux-store surface, or undefined. */
  asFluxStore(exports: unknown): (FluxStoreLike & WebpackExports) | undefined {
    if (!filters.isFluxStoreLike(exports)) return undefined;
    return exports as FluxStoreLike & WebpackExports;
  }

  /**
   * Wait until `filter` matches (lazy modules), re-checking whenever webpack
   * registers modules. Resolves undefined on timeout/abort. Found results are
   * cached like `find`.
   */
  async waitFor(filter: ModuleFilter, options?: WaitForOptions): Promise<WebpackExports | undefined> {
    if (typeof filter !== "function") throw new Error("Webpack.waitFor() requires a filter function.");
    let foundId: ModuleId | undefined;
    const search = (): WebpackExports | undefined => {
      const match = this.scan(filter, 1)[0];
      if (match === undefined) return undefined;
      foundId = match.id;
      return match.exports;
    };
    const found = await waitForModule(search, filter, options, this.logger);
    if (found !== undefined && foundId !== undefined) this.filterCache.set(filter, foundId);
    return found;
  }

  /** Drop cached finds (all, or one filter) -- e.g. after a bundle reload. */
  clearCache(filter?: ModuleFilter): void {
    if (filter !== undefined) {
      this.filterCache.delete(filter);
      return;
    }
    this.filterCache = new WeakMap();
    this.keyCache.clear();
  }
}

/** Default shared finder bound to the real bundle (undefined outside Discord). */
export const Webpack = new WebpackFinder();

/** Create an isolated finder (tests, alternate sources). */
export function createWebpackFinder(options?: WebpackFinderOptions): WebpackFinder {
  return new WebpackFinder(options);
}
