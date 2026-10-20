import { Logger, type ScopedLogger } from "../api/logger.js";
import type { ModuleFilter, WaitForOptions, WebpackExports } from "./types.js";

export type ModuleSearch = () => WebpackExports | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForModule(
  search: ModuleSearch,
  filter: ModuleFilter,
  options?: WaitForOptions,
  logger?: ScopedLogger,
): Promise<WebpackExports | undefined> {
  if (typeof search !== "function") throw new Error("waitForModule() requires a search function.");
  if (typeof filter !== "function") throw new Error("waitForModule() requires a filter function.");
  const log = logger ?? Logger.extend("Webpack");
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const intervalMs = options?.intervalMs ?? 50;
  const signal = options?.signal;
  if (!(timeoutMs > 0)) throw new Error("waitForModule() requires timeoutMs > 0.");
  if (!(intervalMs > 0)) throw new Error("waitForModule() requires intervalMs > 0.");

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted === true) return undefined;
    let found: WebpackExports | undefined;
    try {
      found = search();
    } catch (err: unknown) {
      log.captureError(err, "Webpack.waitFor.search");
      found = undefined;
    }
    if (found !== undefined) return found;
    if (Date.now() >= deadline) {
      log.warn("Webpack.waitFor() timed out without a match.");
      return undefined;
    }
    await sleep(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
  }
}
