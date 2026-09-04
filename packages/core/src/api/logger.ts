// @vestra/core — Logger API.
// Stable public surface: `Logger` + `createLogger(scope)`.
// Rule: plugin/subsystem errors must be routed through here, never silently swallowed.

export type LogLevel = "debug" | "log" | "info" | "warn" | "error";

export interface ScopedLogger {
  readonly scope: string;
  debug(...args: readonly unknown[]): void;
  log(...args: readonly unknown[]): void;
  info(...args: readonly unknown[]): void;
  warn(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
  /** Log an unknown thrown value with optional context. Never throws itself. */
  captureError(err: unknown, context?: string): void;
}

function formatPrefix(scope: string): string {
  return scope === "Vestra" ? "[Vestra]" : `[Vestra:${scope}]`;
}

function toErrorArgs(err: unknown): readonly unknown[] {
  if (err instanceof Error) return [err.message, err];
  return [String(err)];
}

export function createLogger(scope: string): ScopedLogger {
  const normalized = scope.trim() === "" ? "Vestra" : scope;
  const prefix = formatPrefix(normalized);

  const logger: ScopedLogger = {
    scope: normalized,
    debug(...args: readonly unknown[]): void {
      console.debug(prefix, ...args);
    },
    log(...args: readonly unknown[]): void {
      console.log(prefix, ...args);
    },
    info(...args: readonly unknown[]): void {
      console.info(prefix, ...args);
    },
    warn(...args: readonly unknown[]): void {
      console.warn(prefix, ...args);
    },
    error(...args: readonly unknown[]): void {
      console.error(prefix, ...args);
    },
    captureError(err: unknown, context?: string): void {
      try {
        const ctx = context === undefined ? "" : ` (${context})`;
        console.error(`${prefix} captured error${ctx}:`, ...toErrorArgs(err));
      } catch {
        // Logger must never throw — last resort, ignore.
      }
    },
  };

  return logger;
}

/** Root logger. Create scoped children via `Logger.extend(scope)`. */
export interface RootLogger extends ScopedLogger {
  extend(scope: string): ScopedLogger;
}

function createRootLogger(): RootLogger {
  const root = createLogger("Vestra") as RootLogger;
  (root as { extend: (scope: string) => ScopedLogger }).extend = (scope: string) =>
    createLogger(scope);
  return root;
}

export const Logger: RootLogger = createRootLogger();
