// @vestra/core — Settings store.
// Phase 3. Centralized persistent settings on the spec shape
// `{ plugins: { [name]: { enabled, settings } }, customCss }`, prototype-backed
// by `localStorage` under VESTRA_STORAGE_KEY with an in-memory fallback for
// Node/Bun. Never blocks startup on corrupt data: total JSON failure resets to
// defaults, partial invalid fields are salvaged/discarded with warnings.

import { VESTRA_STORAGE_KEY } from "@vestra/shared";
import { z } from "zod";
import { Logger, type ScopedLogger } from "./logger.js";

export const PluginSettingsEntrySchema = z.object({
  enabled: z.boolean(),
  settings: z.record(z.unknown()).default({}),
});

export type PluginSettingsEntry = z.infer<typeof PluginSettingsEntrySchema>;

export const CustomCssSchema = z.object({
  enabled: z.boolean(),
  css: z.string(),
});

export type CustomCss = z.infer<typeof CustomCssSchema>;

export const VestraSettingsSchema = z.object({
  plugins: z.record(PluginSettingsEntrySchema).default({}),
  customCss: CustomCssSchema.default({ enabled: false, css: "" }),
});

export type VestraSettings = z.infer<typeof VestraSettingsSchema>;

export const DEFAULT_SETTINGS: VestraSettings = {
  plugins: {},
  customCss: { enabled: false, css: "" },
};

export type SettingsListener = (snapshot: Readonly<VestraSettings>) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRaw(): string | null {
  try {
    const ls = (globalThis as Record<string, unknown>)["localStorage"];
    if (!isRecord(ls) || typeof ls["getItem"] !== "function") return null;
    const raw = (ls["getItem"] as (key: string) => unknown).call(ls, VESTRA_STORAGE_KEY);
    return typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
}

function canUseLocalStorage(): boolean {
  try {
    const ls = (globalThis as Record<string, unknown>)["localStorage"];
    return (
      isRecord(ls) &&
      typeof ls["getItem"] === "function" &&
      typeof ls["setItem"] === "function"
    );
  } catch {
    return false;
  }
}

function writeRaw(raw: string): void {
  const ls = (globalThis as Record<string, unknown>)["localStorage"];
  if (!isRecord(ls) || typeof ls["setItem"] !== "function") return;
  (ls["setItem"] as (key: string, value: string) => unknown).call(ls, VESTRA_STORAGE_KEY, raw);
}

function cloneSettings(state: VestraSettings): VestraSettings {
  const plugins: Record<string, PluginSettingsEntry> = {};
  for (const [name, entry] of Object.entries(state.plugins)) {
    plugins[name] = { enabled: entry.enabled, settings: { ...entry.settings } };
  }
  return { plugins, customCss: { ...state.customCss } };
}

interface LoadResult {
  settings: VestraSettings;
  migrated: boolean;
}

/** Normalize parsed JSON into settings, salvaging valid fields and migrating legacy shapes. */
function normalizeParsed(parsed: unknown, logger: ScopedLogger): LoadResult {
  let migrated = false;
  if (!isRecord(parsed)) {
    logger.warn("Settings: root is not an object — resetting to defaults.");
    return { settings: cloneSettings(DEFAULT_SETTINGS), migrated };
  }

  // --- plugins ---
  let plugins: Record<string, PluginSettingsEntry> = {};
  const rawPlugins = parsed["plugins"];
  if (rawPlugins === undefined) {
    plugins = {};
  } else if (!isRecord(rawPlugins)) {
    logger.warn("Settings: discarding invalid `plugins` (expected object).");
  } else {
    for (const [name, rawEntry] of Object.entries(rawPlugins)) {
      // Legacy: direct boolean meant `{ enabled: bool }`.
      if (typeof rawEntry === "boolean") {
        plugins[name] = { enabled: rawEntry, settings: {} };
        migrated = true;
        logger.warn(`Settings: migrated legacy boolean entry for plugin "${name}".`);
        continue;
      }
      if (!isRecord(rawEntry)) {
        logger.warn(`Settings: discarding invalid entry for plugin "${name}".`);
        continue;
      }
      const rawEnabled = rawEntry["enabled"];
      if (typeof rawEnabled !== "boolean") {
        logger.warn(`Settings: discarding entry for plugin "${name}" (bad/missing \`enabled\`).`);
        continue;
      }
      const rawSettings = rawEntry["settings"];
      let settings: Record<string, unknown> = {};
      if (rawSettings === undefined) {
        settings = {};
      } else if (isRecord(rawSettings)) {
        settings = { ...rawSettings };
      } else {
        logger.warn(`Settings: discarding invalid \`settings\` for plugin "${name}".`);
      }
      // Final gate through Zod so future schema tightening applies uniformly.
      const checked = PluginSettingsEntrySchema.safeParse({ enabled: rawEnabled, settings });
      if (!checked.success) {
        logger.warn(`Settings: discarding invalid entry for plugin "${name}".`);
        continue;
      }
      plugins[name] = checked.data;
    }
  }

  // --- customCss ---
  // Current shape: `{ enabled: boolean, css: string }`.
  // Legacy: bare `boolean` (spec Phase 2 shape) migrates to `{ enabled: bool, css: "" }`.
  let customCss: CustomCss = { enabled: false, css: "" };
  const rawCss = parsed["customCss"];
  if (rawCss === undefined) {
    customCss = { enabled: false, css: "" };
  } else if (typeof rawCss === "boolean") {
    customCss = { enabled: rawCss, css: "" };
    migrated = true;
    logger.warn("Settings: migrated legacy boolean `customCss` to `{ enabled, css }`.");
  } else if (typeof rawCss === "string") {
    customCss = { enabled: rawCss.length > 0, css: rawCss };
    migrated = true;
    logger.warn("Settings: migrated string `customCss` to `{ enabled, css }`.");
  } else if (isRecord(rawCss)) {
    const enabled = rawCss["enabled"];
    const css = rawCss["css"] ?? rawCss["text"];
    let ok = true;
    if (typeof enabled !== "boolean") {
      logger.warn("Settings: discarding invalid `customCss.enabled` (expected boolean).");
      ok = false;
    }
    if (typeof css !== "string") {
      logger.warn("Settings: discarding invalid `customCss.css` (expected string).");
      ok = false;
    }
    if (ok) {
      customCss = { enabled: enabled as boolean, css: css as string };
    } else {
      // Salvage whichever half is valid instead of dropping both.
      customCss = {
        enabled: typeof enabled === "boolean" ? enabled : false,
        css: typeof css === "string" ? css : "",
      };
    }
    if (rawCss["text"] !== undefined && rawCss["css"] === undefined) migrated = true;
  } else {
    logger.warn("Settings: discarding invalid `customCss` (expected object).");
  }

  return { settings: { plugins, customCss }, migrated };
}

export class SettingsStore {
  private state: VestraSettings = cloneSettings(DEFAULT_SETTINGS);
  private readonly listeners = new Set<SettingsListener>();
  private readonly logger: ScopedLogger;
  private readonly useLocalStorage: boolean;
  private readonly memoryRaw: { raw: string | null } = { raw: null };

  constructor(logger?: ScopedLogger) {
    this.logger = logger ?? Logger.extend("Settings");
    this.useLocalStorage = canUseLocalStorage();
  }

  /** Load persisted state into memory. Never throws; corrupt data resets with a log. */
  load(): void {
    const raw = this.useLocalStorage ? readRaw() : this.memoryRaw.raw;
    if (raw === null) {
      this.state = cloneSettings(DEFAULT_SETTINGS);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err: unknown) {
      this.logger.captureError(err, "Settings.load");
      this.state = cloneSettings(DEFAULT_SETTINGS);
      this.persist();
      this.emit();
      return;
    }
    const { settings, migrated } = normalizeParsed(parsed, this.logger);
    this.state = settings;
    if (migrated) this.persist();
    this.emit();
  }

  /** Persist current state. Never throws; errors go through Logger. */
  save(): void {
    this.persist();
  }

  /** Reset to defaults, persist, and notify. */
  reset(): void {
    this.state = cloneSettings(DEFAULT_SETTINGS);
    this.persist();
    this.emit();
  }

  getSnapshot(): Readonly<VestraSettings> {
    return cloneSettings(this.state);
  }

  getEnabled(name: string): boolean | undefined {
    return this.state.plugins[name]?.enabled;
  }

  setEnabled(name: string, enabled: boolean): void {
    const prev = this.state.plugins[name];
    this.state.plugins[name] = { enabled, settings: prev !== undefined ? { ...prev.settings } : {} };
    this.persist();
    this.emit();
  }

  getPluginSettings(name: string): Record<string, unknown> {
    const entry = this.state.plugins[name];
    return entry !== undefined ? { ...entry.settings } : {};
  }

  setPluginSettings(name: string, settings: Record<string, unknown>): void {
    const prev = this.state.plugins[name];
    this.state.plugins[name] = {
      enabled: prev?.enabled ?? false,
      settings: { ...settings },
    };
    this.persist();
    this.emit();
  }

  getPluginSetting(name: string, key: string): unknown {
    return this.state.plugins[name]?.settings[key];
  }

  setPluginSetting(name: string, key: string, value: unknown): void {
    const prev = this.state.plugins[name];
    this.state.plugins[name] = {
      enabled: prev?.enabled ?? false,
      settings: { ...(prev?.settings ?? {}), [key]: value },
    };
    this.persist();
    this.emit();
  }

  getCustomCss(): Readonly<CustomCss> {
    return { ...this.state.customCss };
  }

  setCustomCss(value: CustomCss): void {
    this.state.customCss = { ...value };
    this.persist();
    this.emit();
  }

  setCustomCssEnabled(enabled: boolean): void {
    this.state.customCss = { ...this.state.customCss, enabled };
    this.persist();
    this.emit();
  }

  setCustomCssText(css: string): void {
    this.state.customCss = { ...this.state.customCss, css };
    this.persist();
    this.emit();
  }

  /** Subscribe to changes. Listener errors are isolated via Logger. Returns unsubscribe. */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persist(): void {
    try {
      const raw = JSON.stringify(this.state);
      if (this.useLocalStorage) {
        writeRaw(raw);
      } else {
        this.memoryRaw.raw = raw;
      }
    } catch (err: unknown) {
      this.logger.captureError(err, "Settings.save");
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (err: unknown) {
        this.logger.captureError(err, "Settings.subscribe");
      }
    }
  }
}

/** Default shared store used by the renderer runtime. */
export const Settings = new SettingsStore();

/** Create an isolated store (tests, alternate backends). Shares localStorage when available. */
export function createSettingsStore(logger?: ScopedLogger): SettingsStore {
  return new SettingsStore(logger);
}
