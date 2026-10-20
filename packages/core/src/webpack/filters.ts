import type { FluxStoreLike, ModuleFilter, WebpackExports } from "./types.js";

/** Objects and functions both carry matchable props (see raw.ts). */
function isObject(value: unknown): value is WebpackExports {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null
  );
}

function directOrDefault(exports: WebpackExports): WebpackExports[] {
  const out: WebpackExports[] = [exports];
  const def = exports["default"];
  if (isObject(def)) out.push(def);
  return out;
}

/** Match modules exposing all of `props` (checked on exports and `.default`). */
export function byProps(...props: string[]): ModuleFilter {
  if (props.length === 0) throw new Error("filters.byProps() requires at least one prop.");
  return (exports: WebpackExports) => {
    if (!isObject(exports)) return false;
    return directOrDefault(exports).some((candidate) =>
      props.every((p) => p in candidate),
    );
  };
}

/** Match React components / modules by `displayName` (direct, `.default`, `.type`). */
export function byDisplayName(name: string): ModuleFilter {
  if (name === "") throw new Error("filters.byDisplayName() requires a non-empty name.");
  return (exports: WebpackExports) => {
    if (!isObject(exports)) return false;
    for (const candidate of directOrDefault(exports)) {
      if (candidate["displayName"] === name) return true;
      const type = candidate["type"];
      if (isObject(type) && type["displayName"] === name) return true;
    }
    return false;
  };
}

/**
 * Match Flux stores by name. Tolerant on purpose: accepts `getName()`,
 * `displayName`, or a store-shaped object when `name` is empty… no — name is
 * required; store-likeness alone is checked by `isFluxStoreLike`.
 */
export function byStoreName(name: string): ModuleFilter {
  if (name === "") throw new Error("filters.byStoreName() requires a non-empty name.");
  return (exports: WebpackExports) => {
    if (!isObject(exports)) return false;
    for (const candidate of directOrDefault(exports)) {
      const getName = candidate["getName"];
      if (typeof getName === "function") {
        try {
          if ((getName as () => unknown).call(candidate) === name) return true;
        } catch {
          // A throwing getName is a miss, not a crash.
        }
      }
      if (candidate["displayName"] === name) return true;
    }
    return false;
  };
}

/** Match modules whose function source contains every snippet (code search). */
export function byCode(...snippets: string[]): ModuleFilter {
  if (snippets.length === 0) throw new Error("filters.byCode() requires at least one snippet.");
  return (exports: WebpackExports) => {
    if (!isObject(exports)) return false;
    const sources: string[] = [];
    if (typeof exports === "function") {
      try {
        sources.push(Function.prototype.toString.call(exports));
      } catch {
        // Ignore unstringifiable functions.
      }
    }
    for (const value of Object.values(exports)) {
      if (typeof value === "function") {
        try {
          sources.push(Function.prototype.toString.call(value));
        } catch {
          // Ignore unstringifiable functions.
        }
      }
    }
    return snippets.every((s) => sources.some((src) => src.includes(s)));
  };
}

/** AND-combine filters. */
export function all(...filters: ModuleFilter[]): ModuleFilter {
  if (filters.length === 0) throw new Error("filters.all() requires at least one filter.");
  return (exports: WebpackExports) => filters.every((f) => safeTest(f, exports));
}

/** OR-combine filters. */
export function any(...filters: ModuleFilter[]): ModuleFilter {
  if (filters.length === 0) throw new Error("filters.any() requires at least one filter.");
  return (exports: WebpackExports) => filters.some((f) => safeTest(f, exports));
}

function safeTest(filter: ModuleFilter, exports: WebpackExports): boolean {
  try {
    return filter(exports) === true;
  } catch {
    return false;
  }
}

/** Best-effort Flux-store check (any recognized store surface counts). */
export function isFluxStoreLike(value: unknown): value is FluxStoreLike {
  if (!isObject(value)) return false;
  const candidates = [value, value["default"]].filter(isObject);
  return candidates.some(
    (c) =>
      typeof c["subscribe"] === "function" ||
      typeof c["addChangeListener"] === "function" ||
      typeof c["getDispatchToken"] === "function" ||
      typeof c["getName"] === "function" ||
      typeof c["getState"] === "function",
  );
}

export const filters = {
  byProps,
  byDisplayName,
  byStoreName,
  byCode,
  all,
  any,
  isFluxStoreLike,
};
