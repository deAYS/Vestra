import { Logger, type ScopedLogger } from "../api/logger.js";
import { onModulesRegistered } from "./raw.js";
import type { ModuleFilter, WaitForOptions, WebpackExports } from "./types.js";

export type ModuleSearch = () => WebpackExports | undefined;

/** Subscribe to "new modules may be available" events; returns an unsubscribe. */
export type RegistrationSubscribe = (listener: () => void) => () => void;

/**
 * Resolve `search()` once it finds a module. Checks immediately, then each
 * time webpack registers modules (see `onModulesRegistered`), and a last time
 * at the deadline. Resolves undefined on timeout (with a warning) or abort.
 * `intervalMs` is validated for compatibility; waiters no longer poll on
 * their own.
 */
export async function waitForModule(
  search: ModuleSearch,
  filter: ModuleFilter,
  options?: WaitForOptions,
  logger?: ScopedLogger,
  subscribe: RegistrationSubscribe = onModulesRegistered,
): Promise<WebpackExports | undefined> {
  if (typeof search !== "function") throw new Error("waitForModule() requires a search function.");
  if (typeof filter !== "function") throw new Error("waitForModule() requires a filter function.");
  const log = logger ?? Logger.extend("Webpack");
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const intervalMs = options?.intervalMs ?? 50;
  const signal = options?.signal;
  if (!(timeoutMs > 0)) throw new Error("waitForModule() requires timeoutMs > 0.");
  if (!(intervalMs > 0)) throw new Error("waitForModule() requires intervalMs > 0.");

  const attempt = (): WebpackExports | undefined => {
    try {
      return search();
    } catch (err: unknown) {
      log.captureError(err, "Webpack.waitFor.search");
      return undefined;
    }
  };

  if (signal?.aborted === true) return undefined;
  const immediate = attempt();
  if (immediate !== undefined) return immediate;

  return new Promise<WebpackExports | undefined>((resolve) => {
    let done = false;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: WebpackExports | undefined): void => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try {
        unsubscribe?.();
      } catch (err: unknown) {
        log.captureError(err, "Webpack.waitFor.unsubscribe");
      }
      resolve(value);
    };
    const onAbort = (): void => {
      finish(undefined);
    };
    const check = (): void => {
      if (done) return;
      if (signal?.aborted === true) {
        finish(undefined);
        return;
      }
      const found = attempt();
      if (found !== undefined) finish(found);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      check();
      if (done) return;
      log.warn("Webpack.waitFor() timed out without a match.");
      finish(undefined);
    }, timeoutMs);
    try {
      unsubscribe = subscribe(check);
    } catch (err: unknown) {
      log.captureError(err, "Webpack.waitFor.subscribe");
    }
    // A listener may have resolved us synchronously during subscribe.
    if (done) {
      try {
        unsubscribe?.();
      } catch {
        // Ignore.
      }
    }
  });
}
