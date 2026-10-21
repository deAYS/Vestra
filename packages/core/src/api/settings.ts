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
  writeSettingsFile(text: string): Promise<void>;
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
  private nativeWrites: Promise<void> = Promise.resolve();
  private persistenceError: string | undefined;
  private state: VestraSettings = cloneSettings(DEFAULT_SETTINGS);
  private readonly listeners = new Set<SettingsListener>();
  private readonly logger: ScopedLogger;
  private readonly useLocalStorage: boolean;
  private readonly memoryRaw: { raw: string | null } = { raw: null };

  constructor(logger?: ScopedLogger) {
    this.logger = logger ?? Logger.extend("Settings");
    this.useLocalStorage = canUseLocalStorage();
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

  async flush(): Promise<void> {
    await this.nativeWrites;
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

  private persist(): void {
    try {
      // Desktop files can hold the bounded library and its last working CSS.
      // Browser storage stays small; local files are refreshed when available.
      const raw = JSON.stringify({
        ...this.state,
        themes: this.state.themes.map((theme) =>
          theme.sourceFile && !this.nativeStorage
            ? { ...theme, css: "" }
            : theme,
        ),
      });
      if (this.nativeStorage) {
        this.nativeRaw = raw;
        const storage = this.nativeStorage;
        this.nativeWrites = this.nativeWrites
          .catch(() => {})
          .then(() => storage.writeSettingsFile(raw));
        void this.nativeWrites.then(
          () => {
            if (this.persistenceError) {
              this.persistenceError = undefined;
              this.emit();
            }
          },
          (error) => {
            this.persistenceError =
              error instanceof Error ? error.message : String(error);
            this.logger.captureError(error, "Settings.saveFile");
            this.emit();
          },
        );
        this.memoryRaw.raw = raw;
        return;
      }
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
