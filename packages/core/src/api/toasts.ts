import { Logger, type ScopedLogger } from "./logger.js";

export type ToastType = "info" | "success" | "warn" | "error";

export interface ToastOptions {
  title: string;
  message?: string | undefined;
  type?: ToastType | undefined;
  /** Auto-dismiss after this long. Default 4000. 0 disables (sticky). */
  durationMs?: number | undefined;
}

export interface Toast {
  readonly id: number;
  readonly title: string;
  readonly message: string;
  readonly type: ToastType;
  readonly durationMs: number;
  readonly at: number;
}

export type ToastListener = (toasts: readonly Toast[]) => void;

export interface ToastManagerOptions {
  logger?: ScopedLogger | undefined;
}

const DEFAULT_DURATION_MS = 4000;
const MAX_TOASTS = 4;

export class ToastManager {
  private readonly logger: ScopedLogger;
  private readonly listeners = new Set<ToastListener>();
  private readonly toasts: Toast[] = [];
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly deadlines = new Map<number, number>();
  private readonly remaining = new Map<number, number>();
  private nextId = 1;

  constructor(options?: ToastManagerOptions) {
    this.logger = options?.logger ?? Logger.extend("Toasts");
  }

  /** Show a toast. Returns its id. Throws (TypeError) on bad input. */
  show(options: ToastOptions): number {
    if (
      options === undefined ||
      typeof options.title !== "string" ||
      options.title.trim() === ""
    ) {
      throw new TypeError("Toasts.show() requires a non-empty title.");
    }
    const type = options.type ?? "info";
    if (
      type !== "info" &&
      type !== "success" &&
      type !== "warn" &&
      type !== "error"
    ) {
      throw new TypeError(`Toasts.show() unknown type "${type}".`);
    }
    const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
    if (!Number.isInteger(durationMs) || durationMs < 0) {
      throw new TypeError(
        "Toasts.show() requires durationMs to be a non-negative integer.",
      );
    }
    const toast: Toast = {
      id: this.nextId++,
      title: options.title,
      message: options.message ?? "",
      type,
      durationMs,
      at: Date.now(),
    };
    this.toasts.unshift(toast);
    while (this.toasts.length > MAX_TOASTS) {
      const dropped = this.toasts.pop();
      if (dropped !== undefined) this.clearTimer(dropped.id);
    }
    if (durationMs > 0) {
      this.deadlines.set(toast.id, Date.now() + durationMs);
      try {
        const timer = setTimeout(() => {
          this.dismiss(toast.id);
        }, durationMs);
        this.timers.set(toast.id, timer);
      } catch (err: unknown) {
        this.logger.captureError(err, "Toasts.timer");
      }
    }
    this.emit();
    return toast.id;
  }

  success(title: string, message?: string, durationMs?: number): number {
    return this.show({ title, message, type: "success", durationMs });
  }

  info(title: string, message?: string, durationMs?: number): number {
    return this.show({ title, message, type: "info", durationMs });
  }

  warn(title: string, message?: string, durationMs?: number): number {
    return this.show({ title, message, type: "warn", durationMs });
  }

  error(title: string, message?: string, durationMs?: number): number {
    return this.show({ title, message, type: "error", durationMs });
  }

  /** Remove one toast. Missing ids are a no-op, never throw. */
  dismiss(id: number): void {
    const index = this.toasts.findIndex((t) => t.id === id);
    if (index === -1) return;
    this.clearTimer(id);
    this.toasts.splice(index, 1);
    this.emit();
  }

  pause(id: number): void {
    const deadline = this.deadlines.get(id);
    if (deadline === undefined) return;
    const left = Math.max(0, deadline - Date.now());
    this.clearTimer(id);
    this.remaining.set(id, left);
  }

  resume(id: number): void {
    if (this.timers.has(id)) return;
    const left = this.remaining.get(id);
    if (left === undefined || !this.toasts.some((toast) => toast.id === id))
      return;
    this.remaining.delete(id);
    this.deadlines.set(id, Date.now() + left);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), left),
    );
  }

  remainingMs(id: number): number {
    const deadline = this.deadlines.get(id);
    return deadline === undefined
      ? (this.remaining.get(id) ?? 0)
      : Math.max(0, deadline - Date.now());
  }

  /** Remove every toast. Never throws. */
  clear(): void {
    for (const toast of this.toasts) this.clearTimer(toast.id);
    if (this.toasts.length === 0) return;
    this.toasts.length = 0;
    this.emit();
  }

  list(): readonly Toast[] {
    return [...this.toasts];
  }

  subscribe(listener: ToastListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private clearTimer(id: number): void {
    this.deadlines.delete(id);
    this.remaining.delete(id);
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    this.timers.delete(id);
    try {
      clearTimeout(timer);
    } catch (err: unknown) {
      this.logger.captureError(err, "Toasts.clearTimer");
    }
  }

  private emit(): void {
    const snapshot = this.list();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (err: unknown) {
        this.logger.captureError(err, "Toasts.subscribe");
      }
    }
  }
}

/** Default shared manager rendered by the overlay host. */
export const Toasts = new ToastManager();

/** Create an isolated manager (tests). */
export function createToastManager(
  options?: ToastManagerOptions,
): ToastManager {
  return new ToastManager(options);
}
