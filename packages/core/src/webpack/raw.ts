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
  return locateRequire(logger, false);
}

function locateRequire(logger: ScopedLogger | undefined, quiet: boolean): unknown {
  const log = logger ?? Logger.extend("Webpack");
  try {
    const g = globalThis as Record<string, unknown>;
    const stashed = g["__VESTRA_WEBPACK_REQUIRE__"];
    if (looksLikeRequire(stashed)) return stashed;

    // Window contains accessors that can throw (e.g. blocked storage). Inspect
    // data properties individually so one getter cannot abort discovery.
    const values = Object.getOwnPropertyNames(g).flatMap(key => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(g, key);
        return descriptor && "value" in descriptor ? [[key, descriptor.value] as const] : [];
      } catch { return []; }
    });
    for (const [, value] of values) {
      if (looksLikeRequire(value)) {
        g["__VESTRA_WEBPACK_REQUIRE__"] = value;
        return value;
      }
    }

    for (const [key, value] of values) {
      if (!key.startsWith("webpackChunk")) continue;
      if (isRecord(value)) {
        // Real Webpack 5 keeps require private. An empty synthetic chunk calls
        // its runtime callback with require without executing any app module.
        if (Array.isArray(value) && Object.hasOwn(value, "push")) {
          const length = value.length;
          let captured: unknown;
          // The `vestra-` chunk id marks it as a capture chunk: the push hook
          // never treats it as a registration (see isCaptureChunk).
          try {
            value.push([[`${CAPTURE_CHUNK_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`], {}, (req: unknown) => { captured = req; }]);
          } finally {
            if (value.length > length) value.splice(length, 1);
          }
          if (looksLikeRequire(captured)) {
            g["__VESTRA_WEBPACK_REQUIRE__"] = captured;
            return captured;
          }
        }
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
  if (!quiet) log.debug("Webpack: no require found (not running inside Discord?).");
  return undefined;
}

/** Chunk id prefix of the empty chunk any Vestra instance pushes to capture require. */
const CAPTURE_CHUNK_PREFIX = "vestra-";

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

/* ------------------------------------------------------------------------ */
/* Module registration events                                               */
/* ------------------------------------------------------------------------ */

type RegistrationListener = () => void;
type PushFunction = (...items: unknown[]) => unknown;

/** Shared fallback check interval (ms). Never below 250. */
const REGISTRATION_POLL_MS = 250;

interface HookedChunkArray {
  original: PushFunction;
  wrapper: PushFunction;
}

const registration = {
  listeners: new Set<RegistrationListener>(),
  /** Chunk arrays whose `push` carries our wrapper (installed or retained). */
  hooked: new Map<unknown[], HookedChunkArray>(),
  poll: undefined as ReturnType<typeof setInterval> | undefined,
  pending: undefined as ReturnType<typeof setTimeout> | undefined,
  lastCount: -1,
};

/**
 * True for the empty require-capture chunk (`[["vestra-…"], {}, cb]`) pushed by
 * this or any other Vestra instance. It registers nothing, and treating it as
 * a registration would loop: a waiter's check can push it again.
 */
function isCaptureChunk(items: readonly unknown[]): boolean {
  if (items.length !== 1) return false;
  try {
    const chunk = items[0];
    if (!Array.isArray(chunk)) return false;
    const ids: unknown = chunk[0];
    return Array.isArray(ids) && ids.length === 1 && typeof ids[0] === "string" && ids[0].startsWith(CAPTURE_CHUNK_PREFIX);
  } catch {
    return false;
  }
}

/** Number of modules in the default require's cache (-1 when unavailable). */
function currentModuleCount(): number {
  try {
    const cache = getModuleCache(locateRequire(undefined, true));
    if (cache === undefined) return -1;
    let count = 0;
    for (const _key in cache) count += 1;
    return count;
  } catch {
    return -1;
  }
}

function emitRegistration(): void {
  registration.lastCount = currentModuleCount();
  for (const listener of [...registration.listeners]) {
    if (!registration.listeners.has(listener)) continue;
    try {
      listener();
    } catch (err: unknown) {
      Logger.extend("Webpack").captureError(err, "Webpack.onModulesRegistered.listener");
    }
  }
}

/**
 * A chunk push registers module factories; webpack executes them into the
 * cache a few microtasks later (chunk promise callbacks), so listeners run on
 * the next macrotask, coalesced across pushes in the same task.
 */
function scheduleRegistration(): void {
  if (registration.listeners.size === 0) return;
  if (registration.pending !== undefined) return;
  registration.pending = setTimeout(() => {
    registration.pending = undefined;
    emitRegistration();
  }, 0);
}

/** Wrap the own `push` of every webpack chunk array not wrapped yet. */
function installChunkHooks(): void {
  const g = globalThis as Record<string, unknown>;
  let keys: string[];
  try {
    keys = Object.getOwnPropertyNames(g);
  } catch {
    return;
  }
  for (const key of keys) {
    if (!key.startsWith("webpackChunk")) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(g, key);
      const array: unknown = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
      if (!Array.isArray(array) || registration.hooked.has(array)) continue;
      // Only a push installed by the webpack runtime (an own property). Without
      // it the runtime has not started and would overwrite our wrapper anyway.
      const own = Object.getOwnPropertyDescriptor(array, "push");
      if (own === undefined || !("value" in own) || typeof own.value !== "function" || own.writable !== true) continue;
      const original = own.value as PushFunction;
      const wrapper: PushFunction = function (this: unknown, ...items: unknown[]): unknown {
        const capture = isCaptureChunk(items);
        try {
          return Reflect.apply(original, this, items);
        } finally {
          if (!capture) scheduleRegistration();
        }
      };
      array.push = wrapper as typeof array.push;
      if ((array.push as unknown) !== wrapper) continue;
      registration.hooked.set(array, { original, wrapper });
    } catch {
      // A hostile or frozen global is skipped; the fallback check still runs.
    }
  }
}

/** Restore pushes we own; leave a wrapper someone else wrapped on top of. */
function uninstallChunkHooks(): void {
  for (const [array, hook] of registration.hooked) {
    try {
      if ((array.push as unknown) !== hook.wrapper) continue; // retained, inert without listeners
      array.push = hook.original as typeof array.push;
      registration.hooked.delete(array);
    } catch {
      // Keep the entry: the wrapper stays in place as a pass-through.
    }
  }
}

/**
 * Shared fallback: covers pages without a hookable chunk array and modules
 * executed after their chunk registered. Runs only while listeners exist and
 * only notifies when the module count changed, so an idle cache costs no
 * filter scans.
 */
function pollRegistration(): void {
  installChunkHooks();
  const count = currentModuleCount();
  if (count !== registration.lastCount) emitRegistration();
}

/**
 * Call `listener` after webpack registers new modules: wraps the chunk
 * arrays' `push` (always calling through and keeping its return value) and
 * falls back to one shared ≥ 250 ms check of the module count. Returns an
 * unsubscribe; the last unsubscribe restores the original `push` when no one
 * wrapped it since, and stops the shared check.
 */
export function onModulesRegistered(listener: RegistrationListener): () => void {
  if (typeof listener !== "function") throw new Error("onModulesRegistered() requires a listener function.");
  const first = registration.listeners.size === 0;
  registration.listeners.add(listener);
  if (first) {
    installChunkHooks();
    registration.lastCount = currentModuleCount();
    registration.poll = setInterval(pollRegistration, REGISTRATION_POLL_MS);
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    registration.listeners.delete(listener);
    if (registration.listeners.size > 0) return;
    if (registration.poll !== undefined) clearInterval(registration.poll);
    registration.poll = undefined;
    if (registration.pending !== undefined) clearTimeout(registration.pending);
    registration.pending = undefined;
    uninstallChunkHooks();
  };
}

/**
 * Drop every listener, stop the shared check and restore the pushes we can
 * (tests, or a full bundle reload). Unsubscribes handed out earlier stay safe.
 */
export function resetModuleRegistration(): void {
  registration.listeners.clear();
  if (registration.poll !== undefined) clearInterval(registration.poll);
  registration.poll = undefined;
  if (registration.pending !== undefined) clearTimeout(registration.pending);
  registration.pending = undefined;
  uninstallChunkHooks();
  registration.hooked.clear();
  registration.lastCount = -1;
}
