// @vestra/core webpack — raw access layer.
// Phase 6. This is the ONLY module allowed to touch Discord's bundle globals.
// Everything else consumes `RequireSource` / enumerated exports. All functions
// are best-effort: outside Discord (or after a bundle change) they return
// undefined / empty results and log, never throw.

import { Logger, type ScopedLogger } from "../api/logger.js";
import type { RequireSource, WebpackExports } from "./types.js";

/**
 * Records AND functions: webpack requires are functions carrying `.c`, and
 * modules can export a bare function (e.g. a React component with
 * `displayName`). Both support prop reads for matching.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null
  );
}

/** A webpack require looks like a function carrying a `.c` module cache object. */
function looksLikeRequire(value: unknown): boolean {
  return typeof value === "function" && isRecord((value as { c?: unknown }).c);
}

/**
 * Locate Discord's webpack require. Strategies, in order:
 * 1. Already-captured require stashed on globalThis by a previous call.
 * 2. Any global function with a `.c` cache (Discord exposes one).
 * 3. Chunk arrays (`webpackChunk*`): hijack `push` briefly to capture the
 *    require from the next pushed chunk factory… without forcing a load we can
 *    only read what is already there, so this step just looks for a captured
 *    require on the array object itself.
 */
export function getWebpackRequire(logger?: ScopedLogger): unknown {
  const log = logger ?? Logger.extend("Webpack");
  try {
    const g = globalThis as Record<string, unknown>;
    const stashed = g["__VESTRA_WEBPACK_REQUIRE__"];
    if (looksLikeRequire(stashed)) return stashed;

    for (const value of Object.values(g)) {
      if (looksLikeRequire(value)) {
        g["__VESTRA_WEBPACK_REQUIRE__"] = value;
        return value;
      }
    }

    for (const [key, value] of Object.entries(g)) {
      if (!key.startsWith("webpackChunk")) continue;
      if (isRecord(value)) {
        for (const inner of Object.values(value)) {
          if (looksLikeRequire(inner)) {
            g["__VESTRA_WEBPACK_REQUIRE__"] = inner;
            return inner;
          }
        }
      }
    }
  } catch (err: unknown) {
    log.captureError(err, "Webpack.getRequire");
    return undefined;
  }
  log.debug("Webpack: no require found (not running inside Discord?).");
  return undefined;
}

/** Default source used by the shared finder. Re-resolved on every call. */
export const defaultRequireSource: RequireSource = () => getWebpackRequire();

/** Read the module cache object from a require, or undefined. */
export function getModuleCache(requireFn: unknown): Record<string, unknown> | undefined {
  if (!isRecord(requireFn)) return undefined;
  const cache = (requireFn as { c?: unknown }).c;
  return isRecord(cache) ? cache : undefined;
}

/**
 * Enumerate cached module exports. Yields `{ id, exports }`; skips entries
 * that throw on access. `includeDefault` also yields `.default` objects as
 * separate candidates. `find` returns the module exports object as stored in
 * the cache — when the match lives on `.default`, read it off the result
 * (`result.default ?? result`).
 */
export function* enumerateModules(
  requireFn: unknown,
  options?: { includeDefault?: boolean },
): Generator<{ id: string; exports: WebpackExports }> {
  const cache = getModuleCache(requireFn);
  if (cache === undefined) return;
  const includeDefault = options?.includeDefault ?? true;
  for (const [id, mod] of Object.entries(cache)) {
    let exports: unknown;
    try {
      exports = isRecord(mod) ? mod["exports"] : undefined;
    } catch {
      continue;
    }
    if (!isRecord(exports)) continue;
    yield { id, exports: exports as WebpackExports };
    if (includeDefault) {
      try {
        const def = exports["default"];
        if (isRecord(def) && def !== exports) yield { id, exports: def };
      } catch {
        // Ignore.
      }
    }
  }
}
