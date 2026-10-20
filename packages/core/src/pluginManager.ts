import { VESTRA_STORAGE_KEY } from "@vestra/shared";
import {
  PluginDefinitionSchema,
  type PluginDefinition,
} from "./api/plugins.js";
import { Logger, type ScopedLogger } from "./api/logger.js";
import { patcher as sharedPatcher, type Patcher } from "./api/patcher.js";
import { Settings, type SettingsStore } from "./api/settings.js";

export interface EnabledStateStorage {
  loadEnabledStates(): Record<string, boolean>;
  saveEnabledStates(states: Readonly<Record<string, boolean>>): void;
}

interface VestraPersistedShape {
  plugins?: Record<string, { enabled?: unknown } | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readLocalStorage(): string | null {
  try {
    const ls = (globalThis as Record<string, unknown>)["localStorage"];
    if (!isRecord(ls) || typeof ls["getItem"] !== "function") return null;
    const raw = (ls["getItem"] as (key: string) => unknown).call(ls, VESTRA_STORAGE_KEY);
    return typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(raw: string): void {
  const ls = (globalThis as Record<string, unknown>)["localStorage"];
  if (!isRecord(ls) || typeof ls["setItem"] !== "function") return;
  (ls["setItem"] as (key: string, value: string) => unknown).call(ls, VESTRA_STORAGE_KEY, raw);
}

/**
 * Default storage: `localStorage` in renderers, transparent in-memory fallback
 * elsewhere (Node/Bun). Reads/writes merge with the full persisted shape so
 * other owners' keys survive.
 */
export function createDefaultEnabledStateStorage(): EnabledStateStorage {
  const memory = new Map<string, boolean>();
  const hasLocalStorage = readLocalStorage() !== null || canWriteLocalStorage();

  function canWriteLocalStorage(): boolean {
    try {
      const ls = (globalThis as Record<string, unknown>)["localStorage"];
      return isRecord(ls) && typeof ls["getItem"] === "function" && typeof ls["setItem"] === "function";
    } catch {
      return false;
    }
  }

  return {
    loadEnabledStates(): Record<string, boolean> {
      if (hasLocalStorage) {
        const raw = readLocalStorage();
        if (raw === null) return {};
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!isRecord(parsed)) return {};
          const plugins = (parsed as VestraPersistedShape).plugins;
          if (!isRecord(plugins)) return {};
          const out: Record<string, boolean> = {};
          for (const [name, entry] of Object.entries(plugins)) {
            if (isRecord(entry) && typeof entry["enabled"] === "boolean") {
              out[name] = entry["enabled"];
            }
          }
          return out;
        } catch (err: unknown) {
          Logger.captureError(err, "PluginManager.loadEnabledStates");
          return {};
        }
      }
      return Object.fromEntries(memory);
    },

    saveEnabledStates(states: Readonly<Record<string, boolean>>): void {
      if (hasLocalStorage) {
        try {
          const raw = readLocalStorage();
          let root: Record<string, unknown> = {};
          if (raw !== null) {
            const parsed: unknown = JSON.parse(raw);
            if (isRecord(parsed)) root = { ...parsed };
          }
          const prevPlugins = isRecord(root["plugins"])
            ? { ...(root["plugins"] as Record<string, unknown>) }
            : {};
          for (const [name, enabled] of Object.entries(states)) {
            const prev = isRecord(prevPlugins[name])
              ? { ...(prevPlugins[name] as Record<string, unknown>) }
              : {};
            prev["enabled"] = enabled;
            prevPlugins[name] = prev;
          }
          root["plugins"] = prevPlugins;
          writeLocalStorage(JSON.stringify(root));
        } catch (err: unknown) {
          Logger.captureError(err, "PluginManager.saveEnabledStates");
        }
        return;
      }
      memory.clear();
      for (const [name, enabled] of Object.entries(states)) memory.set(name, enabled);
    },
  };
}

export interface PluginRecord {
  readonly definition: PluginDefinition;
  readonly enabled: boolean;
  readonly started: boolean;
}

interface MutablePluginState {
  definition: PluginDefinition;
  enabled: boolean;
  started: boolean;
  lastError: unknown;
}

export class PluginManager {
  private readonly plugins = new Map<string, MutablePluginState>();
  private readonly storage: EnabledStateStorage;
  private readonly logger: ScopedLogger;
  private readonly patcher: Patcher;
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch (err) { this.logger.captureError(err, "PluginManager.listener"); }
    }
  }

  private enqueue<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.operations.get(name) ?? Promise.resolve()).then(operation);
    this.operations.set(name, next);
    void next.finally(() => {
      if (this.operations.get(name) === next) this.operations.delete(name);
      this.emit();
    }).catch(() => {});
    return next;
  }

  constructor(storage?: EnabledStateStorage, logger?: ScopedLogger, patcher?: Patcher) {
    this.storage = storage ?? createDefaultEnabledStateStorage();
    this.logger = logger ?? Logger.extend("PluginManager");
    // Disabling a plugin removes its owned patches, so a
    // stopped plugin can never leave a modified function behind.
    this.patcher = patcher ?? sharedPatcher;
  }

  /** Register a plugin. Throws on invalid definition or duplicate name. */
  register(definition: PluginDefinition): void {
    const parsed = PluginDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      this.logger.error(`Refusing invalid plugin: ${parsed.error.message}`);
      throw new Error(`Invalid plugin definition: ${parsed.error.message}`);
    }
    // Validate without stripping plugin-specific fields or method `this` state.
    const def = definition;
    if (this.plugins.has(def.name)) {
      this.logger.error(`Duplicate plugin name rejected: "${def.name}"`);
      throw new Error(`Duplicate plugin name: "${def.name}"`);
    }
    const persisted = this.safeLoadStates();
    const enabled = persisted[def.name] ?? def.enabledByDefault ?? false;
    this.plugins.set(def.name, { definition: def, enabled, started: false, lastError: undefined });
    this.emit();
    this.logger.info(`Registered plugin "${def.name}" (enabled: ${enabled})`);
  }

  /** Enable + start a plugin. Returns false (never throws) if start fails. */
  async enable(name: string): Promise<boolean> {
    return this.enqueue(name, () => this.enableNow(name));
  }

  private async enableNow(name: string): Promise<boolean> {
    const state = this.plugins.get(name);
    if (state === undefined) {
      this.logger.warn(`enable() called for unknown plugin "${name}"`);
      return false;
    }
    state.enabled = true;
    this.persist();
    if (state.started) return true;
    if (state.definition.start === undefined) {
      state.started = true;
      return true;
    }
    try {
      await state.definition.start();
      state.started = true;
      state.lastError = undefined;
      return true;
    } catch (err: unknown) {
      state.started = false;
      state.lastError = err;
      // A partially started plugin may already own patches/listeners/styles.
      try { await state.definition.stop?.(); } catch (cleanupError) { this.logger.captureError(cleanupError, `plugin "${name}" cleanup`); }
      this.unpatchOwner(name);
      state.enabled = false;
      this.persist();
      this.logger.captureError(err, `plugin "${name}" start`);
      return false;
    }
  }

  /** Stop + disable a plugin. Stop errors are captured; state always cleans up. */
  async disable(name: string): Promise<boolean> {
    return this.enqueue(name, () => this.disableNow(name));
  }

  private async disableNow(name: string): Promise<boolean> {
    const state = this.plugins.get(name);
    if (state === undefined) {
      this.logger.warn(`disable() called for unknown plugin "${name}"`);
      return false;
    }
    if (state.started && state.definition.stop !== undefined) {
      try {
        await state.definition.stop();
      } catch (err: unknown) {
        state.lastError = err;
        this.logger.captureError(err, `plugin "${name}" stop`);
      }
    }
    state.started = false;
    state.enabled = false;
    this.unpatchOwner(name);
    this.persist();
    return true;
  }

  /** Disable every plugin (untoggles + persists). Individual failures never block the rest. */
  async disableAll(): Promise<void> {
    for (const name of [...this.plugins.keys()]) {
      await this.disable(name);
    }
  }

  /**
   * Runtime shutdown: stop every running plugin but KEEP persisted enabled
   * flags so the next `start()` restores them. Stop errors are captured.
   */
  async shutdown(): Promise<void> {
    for (const [name, state] of [...this.plugins]) {
      await this.enqueue(name, async () => {
        if (state.started && state.definition.stop !== undefined) {
          try {
            await state.definition.stop();
          } catch (err: unknown) {
            state.lastError = err;
            this.logger.captureError(err, `plugin "${name}" stop`);
          }
        }
        state.started = false;
        this.unpatchOwner(name);
      });
    }
    this.persist();
  }

  /** Re-read settings after Settings.load(), then boot persisted/default flags. */
  async startEnabled(): Promise<void> {
    const saved = this.safeLoadStates();
    for (const [name, state] of this.plugins) {
      const desired = saved[name] ?? state.definition.enabledByDefault ?? false;
      if (desired) await this.enable(name);
      else if (state.started) await this.disable(name);
      else state.enabled = false;
    }
    this.persist();
    this.emit();
  }

  /** Remove one plugin's patches. Best-effort: patcher errors never fail lifecycle. */
  private unpatchOwner(name: string): void {
    try {
      this.patcher.unpatchAll(name);
    } catch (err: unknown) {
      this.logger.captureError(err, `PluginManager.unpatch "${name}"`);
    }
  }

  isEnabled(name: string): boolean {
    return this.plugins.get(name)?.enabled ?? false;
  }

  isStarted(name: string): boolean {
    return this.plugins.get(name)?.started ?? false;
  }

  get(name: string): PluginRecord | undefined {
    const state = this.plugins.get(name);
    if (state === undefined) return undefined;
    return { definition: state.definition, enabled: state.enabled, started: state.started };
  }

  list(): readonly PluginRecord[] {
    return [...this.plugins.values()].map((s) => ({
      definition: s.definition,
      enabled: s.enabled,
      started: s.started,
    }));
  }

  getLastError(name: string): unknown {
    return this.plugins.get(name)?.lastError;
  }

  private safeLoadStates(): Record<string, boolean> {
    try {
      return this.storage.loadEnabledStates();
    } catch (err: unknown) {
      this.logger.captureError(err, "PluginManager.storage.load");
      return {};
    }
  }

  private persist(): void {
    try {
      const states: Record<string, boolean> = {};
      for (const [name, s] of this.plugins) states[name] = s.enabled;
      this.storage.saveEnabledStates(states);
    } catch (err: unknown) {
      this.logger.captureError(err, "PluginManager.storage.save");
    }
  }
}

/**
 * Settings-backed storage adapter. Delegates enabled-state
 * persistence to the centralized Settings store so per-plugin `settings` and
 * `customCss` survive enabled toggles. Public `EnabledStateStorage` API is
 * unchanged; storage errors are isolated by the Settings store itself.
 */
export function createSettingsEnabledStateStorage(store?: SettingsStore): EnabledStateStorage {
  const target = store ?? Settings;
  return {
    loadEnabledStates(): Record<string, boolean> {
      const snapshot = target.getSnapshot();
      const out: Record<string, boolean> = {};
      for (const [name, entry] of Object.entries(snapshot.plugins)) {
        out[name] = entry.enabled;
      }
      return out;
    },

    saveEnabledStates(states: Readonly<Record<string, boolean>>): void {
      for (const [name, enabled] of Object.entries(states)) {
        try {
          if (target.getEnabled(name) !== enabled) target.setEnabled(name, enabled);
        } catch (err: unknown) {
          Logger.captureError(err, "PluginManager.settings.save");
        }
      }
    },
  };
}

/** Shared plugin manager for the renderer runtime. */
export const pluginManager = new PluginManager(createSettingsEnabledStateStorage());
