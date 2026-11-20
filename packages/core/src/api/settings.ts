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

export const ThemeCustomizationSchema = z.object({
  surfaceOverrides: z.boolean().default(true),
  opacity: z.number().min(0).max(100).default(28),
  blur: z.number().min(0).max(48).default(26),
  saturation: z.number().min(0).max(200).default(125),
  brightness: z.number().min(0).max(120).default(100),
  radius: z.number().min(0).max(30).default(22),
  homeOpacity: z.number().min(0).max(100).default(55),
  popupOpacity: z.number().min(0).max(100).default(94),
  settingsOpacity: z.number().min(0).max(100).default(96),
  textColor: z.string().regex(/^(?:#[0-9a-fA-F]{6})?$/).default(""),
  glowColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#c5baf8"),
  glowStrength: z.number().min(0).max(100).default(0),
  glowSize: z.number().min(1).max(18).default(6),
  backgroundColor: z
    .string()
    .regex(/^(?:#[0-9a-fA-F]{6})?$/)
    .default(""),
  backgroundImage: z
    .string()
    .max(1_500_000)
    .refine((value) => {
      if (!value) return true;
      if (
        /^data:image\/(?:png|jpeg|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(
          value,
        )
      )
        return true;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    }, "Choose an image or an HTTPS image URL.")
    .default(""),
});
export type ThemeCustomization = z.infer<typeof ThemeCustomizationSchema>;

export const ThemeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  name: z.string().min(1).max(120),
  author: z.string().max(120).default("Unknown"),
  css: z.string().max(512_000),
  enabled: z.boolean(),
  sourceFile: z
    .string()
    .min(1)
    .max(140)
    .refine(
      (value) =>
        !/[<>:"/\\|?*\u0000-\u001f]/.test(value) &&
        !value.includes("..") &&
        value.toLowerCase().endsWith(".css"),
      "Invalid theme source filename",
    )
    .optional(),
  sourceMissing: z.boolean().optional(),
  customization: ThemeCustomizationSchema.optional(),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const VestraSettingsSchema = z.object({
  plugins: z.record(PluginSettingsEntrySchema).default({}),
  customCss: CustomCssSchema.default({ enabled: false, css: "" }),
  themes: z.array(ThemeSchema).max(32).default([]),
});

export type VestraSettings = z.infer<typeof VestraSettingsSchema>;

export const DEFAULT_SETTINGS: VestraSettings = {
  plugins: {},
  customCss: { enabled: false, css: "" },
  themes: [],
};

export type SettingsListener = (snapshot: Readonly<VestraSettings>) => void;

interface SettingsFileStorage {
  readSettingsFile(): Promise<string | undefined>;
  writeSettingsFile(text: string): Promise<unknown>;
  /** Blocking write for page close; true only when the file was written. */
  writeSettingsFileSync?: ((text: string) => boolean) | undefined;
}

/** Timer seam for the write debounce (tests inject a fake clock). */
export interface SettingsTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SettingsStoreOptions {
  timers?: SettingsTimers | undefined;
}

/** Trailing quiet period before a file write, and the longest a change may wait. */
const WRITE_DEBOUNCE_MS = 300;
const WRITE_MAX_WAIT_MS = 2000;

const defaultTimers: SettingsTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

const NOT_JSON = "Setting values must be JSON data";

/** Plugin values are stored as JSON; reject anything that would not round-trip. */
function assertJsonData(value: unknown, ancestors: object[]): void {
  if (value === null || value === undefined) return;
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(NOT_JSON);
      return;
    case "object":
      break;
    default:
      throw new TypeError(NOT_JSON);
  }
  const object = value as object;
  if (object instanceof Date) return;
  if (ancestors.includes(object)) throw new TypeError(NOT_JSON);
  const isArray = Array.isArray(object);
  if (!isArray) {
    const proto: unknown = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null)
      throw new TypeError(NOT_JSON);
  }
  ancestors.push(object);
  for (const item of isArray
    ? (object as unknown[])
    : Object.values(object as Record<string, unknown>))
    assertJsonData(item, ancestors);
  ancestors.pop();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRaw(): string | null {
  try {
    const ls = (globalThis as Record<string, unknown>)["localStorage"];
    if (!isRecord(ls) || typeof ls["getItem"] !== "function") return null;
    const raw = (ls["getItem"] as (key: string) => unknown).call(
      ls,
      VESTRA_STORAGE_KEY,
    );
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
  (ls["setItem"] as (key: string, value: string) => unknown).call(
    ls,
    VESTRA_STORAGE_KEY,
    raw,
  );
}

function cloneSettings(state: VestraSettings): VestraSettings {
  const plugins: Record<string, PluginSettingsEntry> = {};
  for (const [name, entry] of Object.entries(state.plugins)) {
    plugins[name] = { enabled: entry.enabled, settings: { ...entry.settings } };
  }
  return {
    plugins,
    customCss: { ...state.customCss },
    themes: state.themes.map((theme) => ({
      ...theme,
      ...(theme.customization
        ? { customization: { ...theme.customization } }
        : {}),
    })),
  };
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
        logger.warn(
          `Settings: migrated legacy boolean entry for plugin "${name}".`,
        );
        continue;
      }
      if (!isRecord(rawEntry)) {
        logger.warn(`Settings: discarding invalid entry for plugin "${name}".`);
        continue;
      }
      const rawEnabled = rawEntry["enabled"];
      if (typeof rawEnabled !== "boolean") {
        logger.warn(
          `Settings: discarding entry for plugin "${name}" (bad/missing \`enabled\`).`,
        );
        continue;
      }
      const rawSettings = rawEntry["settings"];
      let settings: Record<string, unknown> = {};
      if (rawSettings === undefined) {
        settings = {};
      } else if (isRecord(rawSettings)) {
        settings = { ...rawSettings };
      } else {
        logger.warn(
          `Settings: discarding invalid \`settings\` for plugin "${name}".`,
        );
      }
      // Final gate through Zod so future schema tightening applies uniformly.
      const checked = PluginSettingsEntrySchema.safeParse({
        enabled: rawEnabled,
        settings,
      });
      if (!checked.success) {
        logger.warn(`Settings: discarding invalid entry for plugin "${name}".`);
        continue;
      }
      plugins[name] = checked.data;
    }
  }

  // --- customCss ---
  // Current shape: `{ enabled: boolean, css: string }`.
  // Legacy: bare `boolean` migrates to `{ enabled: bool, css: "" }`.
  let customCss: CustomCss = { enabled: false, css: "" };
  const rawCss = parsed["customCss"];
  if (rawCss === undefined) {
    customCss = { enabled: false, css: "" };
  } else if (typeof rawCss === "boolean") {
    customCss = { enabled: rawCss, css: "" };
    migrated = true;
    logger.warn(
      "Settings: migrated legacy boolean `customCss` to `{ enabled, css }`.",
    );
  } else if (typeof rawCss === "string") {
    customCss = { enabled: rawCss.length > 0, css: rawCss };
    migrated = true;
    logger.warn("Settings: migrated string `customCss` to `{ enabled, css }`.");
  } else if (isRecord(rawCss)) {
    const enabled = rawCss["enabled"];
    const css = rawCss["css"] ?? rawCss["text"];
    let ok = true;
    if (typeof enabled !== "boolean") {
      logger.warn(
        "Settings: discarding invalid `customCss.enabled` (expected boolean).",
      );
      ok = false;
    }
    if (typeof css !== "string") {
      logger.warn(
        "Settings: discarding invalid `customCss.css` (expected string).",
      );
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
    if (rawCss["text"] !== undefined && rawCss["css"] === undefined)
      migrated = true;
  } else {
    logger.warn("Settings: discarding invalid `customCss` (expected object).");
  }

  const themes: Theme[] = [];
  const ids = new Set<string>();
  if (Array.isArray(parsed["themes"])) {
    for (const raw of parsed["themes"].slice(0, 32)) {
      const checked = ThemeSchema.safeParse(raw);
      if (checked.success && !ids.has(checked.data.id)) {
        ids.add(checked.data.id);
        themes.push(checked.data);
      }
    }
  }
  const active = themes.filter((theme) => theme.enabled);
  if (active.length > 1) {
    const selected = active[active.length - 1]!.id;
    themes.forEach((theme) => {
      theme.enabled = theme.id === selected;
    });
    migrated = true;
  }
  return { settings: { plugins, customCss, themes }, migrated };
}

export class SettingsStore {
  private nativeStorage: SettingsFileStorage | undefined;
  private nativeRaw: string | undefined;
  private nativeWrites: Promise<unknown> = Promise.resolve();
  private persistenceError: string | undefined;
  /** True while `persistenceError` came from serialisation, not from storage access. */
  private serializationFailed = false;
  private state: VestraSettings = cloneSettings(DEFAULT_SETTINGS);
  private readonly listeners = new Set<SettingsListener>();
  private readonly logger: ScopedLogger;
  private readonly useLocalStorage: boolean;
  private readonly memoryRaw: { raw: string | null } = { raw: null };
  private readonly timers: SettingsTimers;
  /** Native file writes are debounced: `revision` counts changes, `writtenRevision` the last one handed to storage. */
  private revision = 0;
  private writtenRevision = 0;
  private writeQueued = false;
  private trailingTimer: unknown;
  private maxWaitTimer: unknown;

  constructor(logger?: ScopedLogger, options?: SettingsStoreOptions) {
    this.logger = logger ?? Logger.extend("Settings");
    this.useLocalStorage = canUseLocalStorage();
    this.timers = options?.timers ?? defaultTimers;
  }

  /** Connect before plugin registration; desktop preferences live outside Discord storage. */
  async connectStorage(storage: SettingsFileStorage): Promise<boolean> {
    if (this.nativeStorage) return true;
    try {
      const saved = await storage.readSettingsFile();
      this.nativeRaw =
        saved ??
        (this.useLocalStorage ? readRaw() : this.memoryRaw.raw) ??
        undefined;
      this.nativeStorage = storage;
      this.load();
      this.persist();
      await this.flush();
      return true;
    } catch (error) {
      this.nativeStorage = undefined;
      this.persistenceError =
        error instanceof Error ? error.message : String(error);
      this.logger.captureError(error, "Settings.connectStorage");
      this.emit();
      return false;
    }
  }

  /** Write pending changes now. Rejects when the file write fails (the banner state is set too). */
  async flush(): Promise<void> {
    this.writeNow();
    await this.nativeWrites;
  }

  /**
   * Blocking flush for page close (`beforeunload`/`pagehide`). Returns true when
   * nothing is pending or the synchronous writer confirmed the write.
   */
  flushSync(): boolean {
    this.cancelTimers();
    const storage = this.nativeStorage;
    if (!storage || !this.isDirty()) return true;
    const writeSync = storage.writeSettingsFileSync;
    if (typeof writeSync !== "function") {
      // No blocking channel on this host: best effort through the async path.
      this.writeNow();
      return false;
    }
    const revision = this.revision;
    let ok = false;
    let failure: unknown;
    try {
      const raw = this.serializeNative();
      this.writtenRevision = revision;
      ok = writeSync.call(storage, raw) === true;
    } catch (error) {
      failure = error;
    }
    if (ok) {
      this.setPersistenceError(undefined);
      return true;
    }
    if (this.writtenRevision === revision) this.writtenRevision = -1;
    if (failure !== undefined)
      this.logger.captureError(failure, "Settings.flushSync");
    this.setPersistenceError(
      failure instanceof Error
        ? failure.message
        : "Preferences could not be saved to disk.",
    );
    return false;
  }

  getPersistenceStatus(): {
    backend: "file" | "browser" | "memory";
    error?: string | undefined;
  } {
    return {
      backend: this.nativeStorage
        ? "file"
        : this.useLocalStorage
          ? "browser"
          : "memory",
      error: this.persistenceError,
    };
  }

  /** Load persisted state into memory. Never throws; corrupt data resets with a log. */
  load(): void {
    // Unsaved changes are part of the persisted state; never roll them back.
    if (this.nativeStorage && this.isDirty()) {
      try {
        this.serializeNative();
      } catch (err: unknown) {
        this.logger.captureError(err, "Settings.load");
      }
    }
    const raw = this.nativeStorage
      ? this.nativeRaw
      : this.useLocalStorage
        ? readRaw()
        : this.memoryRaw.raw;
    if (raw === null || raw === undefined) {
      this.state = cloneSettings(DEFAULT_SETTINGS);
      this.emit();
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
    this.state.plugins[name] = {
      enabled,
      settings: prev !== undefined ? { ...prev.settings } : {},
    };
    this.persist();
    this.emit();
  }

  getPluginSettings(name: string): Record<string, unknown> {
    const entry = this.state.plugins[name];
    return entry !== undefined ? { ...entry.settings } : {};
  }

  setPluginSettings(name: string, settings: Record<string, unknown>): void {
    assertJsonData(settings, []);
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

  /** Throws TypeError when `value` is not JSON data (functions, BigInt, cycles, class instances…). */
  setPluginSetting(name: string, key: string, value: unknown): void {
    assertJsonData(value, []);
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

  getThemes(): Theme[] {
    return cloneSettings(this.state).themes;
  }

  setThemes(themes: readonly Theme[]): void {
    const checked = z.array(ThemeSchema).max(32).parse(themes);
    if (JSON.stringify(checked).length > 18_000_000)
      throw new TypeError(
        "Your theme library is too large. Remove an image or a theme before saving.",
      );
    if (new Set(checked.map((theme) => theme.id)).size !== checked.length)
      throw new TypeError("Duplicate theme id.");
    const enabled = checked.filter((theme) => theme.enabled);
    const newlyEnabled = enabled.filter(
      (theme) =>
        !this.state.themes.some(
          (previous) => previous.id === theme.id && previous.enabled,
        ),
    );
    const selected = newlyEnabled.at(-1)?.id ?? enabled.at(-1)?.id;
    this.state.themes = checked.map((theme) => ({
      ...theme,
      enabled: theme.id === selected,
    }));
    this.persist();
    this.emit();
  }

  activateTheme(id: string | null): void {
    if (id !== null && !this.state.themes.some((theme) => theme.id === id))
      throw new TypeError("Theme not found.");
    this.setThemes(
      this.state.themes.map((theme) => ({
        ...theme,
        enabled: theme.id === id,
      })),
    );
  }

  setThemeCustomization(
    id: string,
    value: ThemeCustomization | undefined,
  ): void {
    if (!this.state.themes.some((theme) => theme.id === id))
      throw new TypeError("Theme not found.");
    this.setThemes(
      this.state.themes.map((theme) => {
        if (theme.id !== id) return theme;
        const { customization: _previous, ...original } = theme;
        return value
          ? {
              ...original,
              customization: ThemeCustomizationSchema.parse(value),
            }
          : original;
      }),
    );
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

  /**
   * Record a change. Desktop files are written once per burst (300 ms quiet,
   * 2 s max wait) and serialised only at write time; browser and memory
   * storage stay synchronous because `load()` reads them straight back.
   */
  private persist(): void {
    if (this.nativeStorage) {
      this.revision++;
      this.scheduleWrite();
      return;
    }
    let raw: string;
    try {
      raw = this.serialize();
    } catch (err: unknown) {
      this.logger.captureError(err, "Settings.save");
      this.setPersistenceError(errorMessage(err), true);
      return;
    }
    try {
      if (this.useLocalStorage) {
        writeRaw(raw);
      } else {
        this.memoryRaw.raw = raw;
      }
    } catch (err: unknown) {
      this.logger.captureError(err, "Settings.save");
      return;
    }
    if (this.serializationFailed) this.setPersistenceError(undefined);
  }

  private serialize(): string {
    // Desktop files can hold the bounded library and its last working CSS.
    // Browser storage stays small; local files are refreshed when available.
    return JSON.stringify({
      ...this.state,
      themes: this.state.themes.map((theme) =>
        theme.sourceFile && !this.nativeStorage
          ? { ...theme, css: "" }
          : theme,
      ),
    });
  }

  private serializeNative(): string {
    const raw = this.serialize();
    this.nativeRaw = raw;
    this.memoryRaw.raw = raw;
    return raw;
  }

  private isDirty(): boolean {
    return this.revision !== this.writtenRevision;
  }

  private scheduleWrite(): void {
    this.timers.clearTimeout(this.trailingTimer);
    this.trailingTimer = this.timers.setTimeout(() => {
      this.writeNow();
    }, WRITE_DEBOUNCE_MS);
    if (this.maxWaitTimer === undefined)
      this.maxWaitTimer = this.timers.setTimeout(() => {
        this.writeNow();
      }, WRITE_MAX_WAIT_MS);
  }

  private cancelTimers(): void {
    if (this.trailingTimer !== undefined)
      this.timers.clearTimeout(this.trailingTimer);
    if (this.maxWaitTimer !== undefined)
      this.timers.clearTimeout(this.maxWaitTimer);
    this.trailingTimer = undefined;
    this.maxWaitTimer = undefined;
  }

  /** Queue one file write; it serialises the latest state when its turn comes. */
  private writeNow(): void {
    this.cancelTimers();
    const storage = this.nativeStorage;
    if (!storage || !this.isDirty() || this.writeQueued) return;
    this.writeQueued = true;
    const write = this.nativeWrites
      .catch(() => {})
      .then(async () => {
        this.writeQueued = false;
        if (this.nativeStorage !== storage || !this.isDirty()) return false;
        const revision = this.revision;
        this.writtenRevision = revision;
        try {
          await storage.writeSettingsFile(this.serializeNative());
        } catch (error) {
          // Still unsaved: the next flush (or page close) tries again.
          if (this.writtenRevision === revision) this.writtenRevision = -1;
          throw error;
        }
        return true;
      });
    this.nativeWrites = write;
    void write.then(
      (wrote) => {
        if (wrote) this.setPersistenceError(undefined);
      },
      (error: unknown) => {
        this.logger.captureError(error, "Settings.saveFile");
        this.setPersistenceError(errorMessage(error));
      },
    );
  }

  private setPersistenceError(
    error: string | undefined,
    fromSerialization = false,
  ): void {
    this.serializationFailed = error !== undefined && fromSerialization;
    if (this.persistenceError === error) return;
    this.persistenceError = error;
    this.emit();
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
