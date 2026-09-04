// @vestra/core webpack — high-level finder.
// Phase 6. `find*` scan Discord's module cache through an injected
// `RequireSource` (real bundle in production, fakes in tests). Successful
// finds are cached by filter identity; misses are never cached so lazily
// loaded modules appear on later scans. Nothing here throws at lookup time:
// misses and Discord bundle changes surface as undefined / empty arrays.

import { Logger, type ScopedLogger } from "../api/logger.js";
import { filters } from "./filters.js";
import { defaultRequireSource, enumerateModules } from "./raw.js";
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

export class WebpackFinder {
  private readonly logger: ScopedLogger;
  private readonly source: RequireSource;
  private readonly cache = new WeakMap<ModuleFilter, WebpackExports>();
  private readonly cachedFilters = new Set<ModuleFilter>();

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

  /** First module matching `filter`, or undefined. Cached on success. */
  find(filter: ModuleFilter, options?: FindOptions): WebpackExports | undefined {
    if (typeof filter !== "function") throw new Error("Webpack.find() requires a filter function.");
    const useCache = options?.cache ?? true;
    if (useCache) {
      const hit = this.cache.get(filter);
      if (hit !== undefined) return hit;
    }
    const found = this.findAll(filter, { limit: 1 })[0];
    if (found !== undefined && useCache) {
      this.cache.set(filter, found);
      this.cachedFilters.add(filter);
    }
    return found;
  }

  /** Every module matching `filter` (fresh scan, never cached). */
  findAll(filter: ModuleFilter, options?: { limit?: number }): WebpackExports[] {
    if (typeof filter !== "function") throw new Error("Webpack.findAll() requires a filter function.");
    const limit = options?.limit;
    if (limit !== undefined && !(limit > 0)) throw new Error("Webpack.findAll() requires limit > 0.");
    const out: WebpackExports[] = [];
    let requireFn: unknown;
    try {
      requireFn = this.source();
    } catch (err: unknown) {
      this.logger.captureError(err, "Webpack.source");
      return out;
    }
    if (requireFn === undefined || requireFn === null) return out;
    try {
      for (const { exports } of enumerateModules(requireFn)) {
        let match = false;
        try {
          match = filter(exports) === true;
        } catch (err: unknown) {
          this.logger.captureError(err, "Webpack.filter");
          continue;
        }
        if (match) {
          out.push(exports);
          if (limit !== undefined && out.length >= limit) break;
        }
      }
    } catch (err: unknown) {
      this.logger.captureError(err, "Webpack.findAll");
    }
    return out;
  }

  /** First module exposing all `props`. */
  findByProps(...props: string[]): WebpackExports | undefined {
    return this.find(filters.byProps(...props));
  }

  /**
   * First component/module with `displayName`. Returns the module exports;
   * the component itself may live on `.default` (use `result.default ?? result`).
   */
  findByDisplayName(name: string): WebpackExports | undefined {
    return this.find(filters.byDisplayName(name));
  }

  /**
   * First Flux store named `name` (best-effort: `getName()`, `displayName`).
   * Returns the raw exports; narrow with `asFluxStore` for typed access.
   */
  findStore(name: string): WebpackExports | undefined {
    return this.find(filters.byStoreName(name));
  }

  /** Narrow raw exports to a Flux-store surface, or undefined. */
  asFluxStore(exports: unknown): (FluxStoreLike & WebpackExports) | undefined {
    if (!filters.isFluxStoreLike(exports)) return undefined;
    return exports as FluxStoreLike & WebpackExports;
  }

  /**
   * Poll until `filter` matches (lazy modules), then resolve it. Resolves
   * undefined on timeout/abort. Found results are cached like `find`.
   */
  async waitFor(filter: ModuleFilter, options?: WaitForOptions): Promise<WebpackExports | undefined> {
    if (typeof filter !== "function") throw new Error("Webpack.waitFor() requires a filter function.");
    const found = await waitForModule(() => this.find(filter, { cache: false }), filter, options, this.logger);
    if (found !== undefined) {
      this.cache.set(filter, found);
      this.cachedFilters.add(filter);
    }
    return found;
  }

  /** Drop cached finds (all, or one filter) — e.g. after a bundle reload. */
  clearCache(filter?: ModuleFilter): void {
    if (filter !== undefined) {
      this.cache.delete(filter);
      this.cachedFilters.delete(filter);
      return;
    }
    for (const f of this.cachedFilters) this.cache.delete(f);
    this.cachedFilters.clear();
  }
}

/** Default shared finder bound to the real bundle (undefined outside Discord). */
export const Webpack = new WebpackFinder();

/** Create an isolated finder (tests, alternate sources). */
export function createWebpackFinder(options?: WebpackFinderOptions): WebpackFinder {
  return new WebpackFinder(options);
}
