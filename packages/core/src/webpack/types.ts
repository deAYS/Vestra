/** Any discovered module's exports object. */
export type WebpackExports = Record<string, unknown>;

/** Predicate over a candidate exports object. Must never throw (finder guards). */
export type ModuleFilter = (exports: WebpackExports) => boolean;

/** Minimal shape of a webpack `require` with a populated module cache. */
export interface WebpackRequireLike {
  c?: unknown;
}

/** Source of the webpack require. Returns undefined outside Discord. */
export type RequireSource = () => unknown;

export interface WaitForOptions {
  /** Resolve undefined after this long without a match. Default 10_000. */
  timeoutMs?: number;
  /** Rescan interval. Default 50. */
  intervalMs?: number;
  /** Abort early (resolves undefined). */
  signal?: AbortSignal;
}

/** Minimal Flux-store surface used by `findStore` / `asFluxStore`. */
export interface FluxStoreLike {
  getName?: () => string;
  getState?: () => unknown;
  subscribe?: (listener: () => void) => () => void;
  addChangeListener?: (listener: () => void) => void;
  getDispatchToken?: () => string;
}
