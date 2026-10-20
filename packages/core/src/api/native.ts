import { VESTRA_NATIVE_CHANNELS } from "@vestra/shared";
import { Logger, type ScopedLogger } from "./logger.js";

/**
 * Every channel the renderer may ever request. Nothing else can be invoked.
 * Single source of truth lives in `@vestra/shared` (shared with the injector).
 */
export const NATIVE_CHANNELS = VESTRA_NATIVE_CHANNELS;

export type NativeChannel = (typeof NATIVE_CHANNELS)[number];

function isChannel(value: unknown): value is NativeChannel {
  return (
    typeof value === "string" &&
    (NATIVE_CHANNELS as readonly string[]).includes(value)
  );
}

/** IPC transport provided by the injector preload. Async because IPC is async. */
export interface NativeTransport {
  invoke(channel: string, args: readonly unknown[]): Promise<unknown>;
  /** Subset of channels this host grants. Absent/empty means nothing granted. */
  capabilities?: readonly string[];
}

export interface NativeBridgeOptions {
  logger?: ScopedLogger;
}

export class NativeUnavailableError extends Error {
  readonly code = "native-unavailable" as const;
  constructor(message?: string) {
    super(message ?? "Vestra Native bridge is not connected.");
    this.name = "NativeUnavailableError";
  }
}

export class NativeDeniedError extends Error {
  readonly code = "native-denied" as const;
  constructor(message: string) {
    super(message);
    this.name = "NativeDeniedError";
  }
}

function rejectUnserializable(value: unknown, path: string, seen?: Set<unknown>): void {
  if (
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new NativeDeniedError(`Native args must be serializable (bad value at ${path}).`);
  }
  if (typeof value === "object" && value !== null) {
    const visited = seen ?? new Set<unknown>();
    if (visited.has(value)) {
      throw new NativeDeniedError(`Native args must be serializable (circular at ${path}).`);
    }
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        rejectUnserializable(item, `${path}[${i}]`, visited);
      });
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      rejectUnserializable(item, `${path}.${key}`, visited);
    }
  }
}

function assertSerializable(args: readonly unknown[]): void {
  for (const [i, arg] of args.entries()) {
    rejectUnserializable(arg, `args[${i}]`);
  }
  try {
    JSON.stringify(args);
  } catch {
    throw new NativeDeniedError("Native args must be serializable (circular structure?).");
  }
}

function assertNonEmptyString(value: unknown, what: string): asserts value is string {
  if (typeof value !== "string" || value === "" || value.includes("\0")) {
    throw new TypeError(`Native.${what}() requires a non-empty string without NUL bytes.`);
  }
}

export interface UpdateCheckResult {
  available: boolean;
  version?: string;
}

export class NativeBridge {
  private readonly logger: ScopedLogger;
  private transport: NativeTransport | undefined;

  constructor(options?: NativeBridgeOptions) {
    this.logger = options?.logger ?? Logger.extend("Native");
  }

  /**
   * Wire the native transport. Called once by the injector bootstrap, or with
   * a fake in tests. Replaces any previous transport. Validates the shape and
   * throws (TypeError) on misuse — a half-wired bridge is worse than none.
   */
  connect(transport: NativeTransport): void {
    if (
      typeof transport !== "object" ||
      transport === null ||
      typeof (transport as { invoke?: unknown }).invoke !== "function"
    ) {
      throw new TypeError("Native.connect() requires a transport with invoke().");
    }
    this.transport = transport;
    this.logger.info(
      `Native bridge connected (${this.getCapabilities().length} capabilities).`,
    );
  }

  /** Tear down the transport. Safe to call when already disconnected. */
  disconnect(): void {
    this.transport = undefined;
  }

  isAvailable(): boolean {
    return this.transport !== undefined;
  }

  /** Channels the connected host grants (empty when disconnected). */
  getCapabilities(): NativeChannel[] {
    const caps = this.transport?.capabilities;
    if (caps === undefined) return [];
    return caps.filter(isChannel);
  }

  /**
   * Invoke a gated channel. Throws NativeUnavailableError (disconnected),
   * NativeDeniedError (not allowlisted/granted/bad args). Transport failures
   * propagate after logging — the caller explicitly requested an action.
   */
  async invoke(channel: NativeChannel, ...args: unknown[]): Promise<unknown> {
    if (!isChannel(channel)) {
      throw new NativeDeniedError(`Native channel "${String(channel)}" is not allowlisted.`);
    }
    const transport = this.transport;
    if (transport === undefined) {
      throw new NativeUnavailableError();
    }
    if (!this.getCapabilities().includes(channel)) {
      throw new NativeDeniedError(`Native host does not grant "${channel}".`);
    }
    assertSerializable(args);
    try {
      return await transport.invoke(channel, args);
    } catch (err: unknown) {
      this.logger.captureError(err, `Native.invoke "${channel}"`);
      throw err;
    }
  }

  /** Read the persistent settings file. Undefined when absent. */
  async readSettingsFile(): Promise<string | undefined> {
    const raw = await this.invoke("settings:read");
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "string") {
      this.logger.warn("Native settings:read returned a non-string — ignoring.");
      return undefined;
    }
    return raw;
  }

  /** Overwrite the persistent settings file. */
  async writeSettingsFile(text: string): Promise<void> {
    if (typeof text !== "string") {
      throw new TypeError("Native.writeSettingsFile() requires a string.");
    }
    await this.invoke("settings:write", text);
  }

  /** Open a path with the OS default handler (explicit user request only). */
  async openPath(path: string): Promise<void> {
    assertNonEmptyString(path, "openPath");
    await this.invoke("shell:openPath", path);
  }

  /** Reveal a path in the OS file manager (explicit user request only). */
  async showItemInFolder(path: string): Promise<void> {
    assertNonEmptyString(path, "showItemInFolder");
    await this.invoke("shell:showItemInFolder", path);
  }

  /** Host app version, if the native side reports one. */
  async getAppVersion(): Promise<string | undefined> {
    const raw = await this.invoke("app:getVersion");
    return typeof raw === "string" && raw !== "" ? raw : undefined;
  }

  /** Well-known host path (`userData`, `home`, `temp`, `desktop`, …). */
  async getAppPath(name: string): Promise<string | undefined> {
    assertNonEmptyString(name, "getAppPath");
    const raw = await this.invoke("app:getPath", name);
    return typeof raw === "string" && raw !== "" ? raw : undefined;
  }

  /** Ask the updater whether a release is available. Never throws on shape drift. */
  async checkForUpdates(): Promise<UpdateCheckResult> {
    const raw: unknown = await this.invoke("updater:check");
    if (typeof raw === "object" && raw !== null) {
      const available = (raw as Record<string, unknown>)["available"];
      const version = (raw as Record<string, unknown>)["version"];
      if (typeof available === "boolean") {
        return typeof version === "string" && version !== ""
          ? { available, version }
          : { available };
      }
    }
    this.logger.warn("Native updater:check returned an unexpected shape — assuming none.");
    return { available: false };
  }

  /** Hand control to the updater to install (host may relaunch). */
  async installUpdate(): Promise<void> {
    await this.invoke("updater:install");
  }
}

/** Default shared bridge. The injector connects it; plugins only call helpers. */
export const Native = new NativeBridge();

/** Create an isolated bridge (tests, alternate transports). Disconnected. */
export function createNativeBridge(options?: NativeBridgeOptions): NativeBridge {
  return new NativeBridge(options);
}
