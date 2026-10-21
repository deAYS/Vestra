/** Stable public plugin contract. Runtime services always belong to the host. */
export const API_VERSION = "1.0.0";
export type PluginLifecycle = () => void | Promise<void>;
interface SettingLabel {
  label: string;
  description?: string | undefined;
}
export type PluginSettingDefinition = SettingLabel &
  (
    | { type: "boolean"; default: boolean }
    | {
        type: "number";
        default: number;
        min?: number | undefined;
        max?: number | undefined;
        step?: number | undefined;
      }
    | {
        type: "select";
        default: string;
        options: { label: string; value: string }[];
      }
    | { type: "keybind" | "text"; default: string }
  );
export interface PluginDefinition {
  name: string;
  description: string;
  authors: string[];
  enabledByDefault?: boolean | undefined;
  start?: PluginLifecycle | undefined;
  stop?: PluginLifecycle | undefined;
  settingsSchema?: Record<string, PluginSettingDefinition> | undefined;
}
export interface PluginRecord {
  definition: PluginDefinition;
  enabled: boolean;
  started: boolean;
}
export interface ThemeCustomization {
  surfaceOverrides?: boolean;
  opacity: number;
  blur: number;
  saturation: number;
  brightness: number;
  radius: number;
  backgroundColor: string;
  backgroundImage: string;
  homeOpacity?: number;
  popupOpacity?: number;
  settingsOpacity?: number;
  textColor?: string;
  glowColor?: string;
  glowStrength?: number;
  glowSize?: number;
}
export interface Theme {
  id: string;
  name: string;
  author: string;
  css: string;
  enabled: boolean;
  sourceFile?: string | undefined;
  sourceMissing?: boolean | undefined;
  customization?: ThemeCustomization | undefined;
}
export interface SettingsAPI {
  getEnabled(name: string): boolean | undefined;
  getPluginSetting(name: string, key: string): unknown;
  setPluginSetting(name: string, key: string, value: unknown): void;
  getPluginSettings(name: string): Record<string, unknown>;
  setPluginSettings(name: string, settings: Record<string, unknown>): void;
  getCustomCss(): Readonly<{ enabled: boolean; css: string }>;
  setCustomCss(value: { enabled: boolean; css: string }): void;
  getThemes(): Theme[];
  setThemes(themes: readonly Theme[]): void;
  activateTheme(id: string | null): void;
  setThemeCustomization(id: string, value: ThemeCustomization | undefined): void;
  subscribe(listener: () => void): () => void;
}
export interface StylesAPI {
  inject(id: string, css: string): void;
  remove(id: string): void;
  has(id: string): boolean;
  get(id: string): string | undefined;
}
export interface PatcherAPI {
  before(
    owner: string,
    target: object,
    key: string | symbol,
    hook: (args: unknown[], thisArg: unknown) => void,
  ): () => void;
  after(
    owner: string,
    target: object,
    key: string | symbol,
    hook: (args: unknown[], result: unknown, thisArg: unknown) => unknown,
  ): () => void;
  instead(
    owner: string,
    target: object,
    key: string | symbol,
    hook: (
      args: unknown[],
      original: (...args: unknown[]) => unknown,
      thisArg: unknown,
    ) => unknown,
  ): () => void;
  unpatchAll(owner: string): number;
}
export interface ToastsAPI {
  success(title: string, body?: string, durationMs?: number): number;
  info(title: string, body?: string, durationMs?: number): number;
  error(title: string, body?: string, durationMs?: number): number;
  dismiss(id: number): void;
}
export interface LoggerAPI {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  captureError(error: unknown, context?: string): void;
}
export interface PluginsAPI {
  register(plugin: PluginDefinition): void;
  enable(name: string): Promise<boolean>;
  disable(name: string): Promise<boolean>;
  isEnabled(name: string): boolean;
  isStarted(name: string): boolean;
  list(): readonly PluginRecord[];
  subscribe(listener: () => void): () => void;
}
export interface WebpackAPI {
  find(
    filter: (value: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | undefined;
  findAll(
    filter: (value: Record<string, unknown>) => boolean,
    options?: { limit?: number },
  ): Record<string, unknown>[];
  findByProps(...props: string[]): Record<string, unknown> | undefined;
  findByDisplayName(name: string): Record<string, unknown> | undefined;
  findStore(name: string): Record<string, unknown> | undefined;
  waitFor(
    filter: (value: Record<string, unknown>) => boolean,
    options?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
  ): Promise<Record<string, unknown> | undefined>;
  isAvailable(): boolean;
}
export interface DiscordWrapper<T> {
  readonly name: string;
  get(): T | undefined;
  isAvailable(): boolean;
  reset(): void;
}
export interface DiscordUser {
  id: string;
  username?: string;
  discriminator?: string;
  avatar?: string;
  bot?: boolean;
  system?: boolean;
}
export interface DiscordChannel {
  id: string;
  type?: number;
  name?: string;
  guildId?: string;
}
export interface DiscordGuild {
  id: string;
  name?: string;
  icon?: string;
}
export type DispatcherCallback = (event: Record<string, unknown>) => void;
export interface DiscordAPI {
  UserStore: DiscordWrapper<{
    getCurrentUser(): DiscordUser | undefined;
    getUser(id: string): DiscordUser | undefined;
  }>;
  ChannelStore: DiscordWrapper<{
    getChannel(id: string): DiscordChannel | undefined;
  }>;
  GuildStore: DiscordWrapper<{
    getGuild(id: string): DiscordGuild | undefined;
  }>;
  SelectedChannel: DiscordWrapper<{
    getChannelId(): string | undefined;
    getVoiceChannelId(): string | undefined;
  }>;
  Dispatcher: DiscordWrapper<{
    dispatch(event: Record<string, unknown>): void;
    subscribe(type: string, callback: DispatcherCallback): () => void;
    unsubscribe(type: string, callback: DispatcherCallback): void;
  }>;
}
export interface NativeAPI {
  isAvailable(): boolean;
  getAppVersion(): Promise<string | undefined>;
  getAppPath(name: string): Promise<string | undefined>;
  openPath(path: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
  openAddonFolder(kind: "plugins" | "themes"): Promise<void>;
  readThemeFiles(): Promise<Array<{ filename: string; source: string }>>;
  writeThemeFile(filename: string, css: string): Promise<string>;
  removeThemeFile(filename: string): Promise<void>;
}
export interface VestraAPI {
  readonly version: string;
  readonly apiVersion: string;
  readonly started: boolean;
  Settings: SettingsAPI;
  Styles: StylesAPI;
  Patcher: PatcherAPI;
  Plugins: PluginsAPI;
  Toasts: ToastsAPI;
  Logger: LoggerAPI;
  Webpack: WebpackAPI;
  Native: NativeAPI;
  Discord: DiscordAPI;
  UI: { openSettings(): void; closeSettings(): void; toggleSettings(): void };
}

export function definePlugin<const T extends PluginDefinition>(
  definition: T,
): T {
  return definition;
}

export function getVestra(): VestraAPI {
  const host = (globalThis as unknown as { Vestra?: VestraAPI }).Vestra;
  if (!host || host.apiVersion?.split(".")[0] !== API_VERSION.split(".")[0]) {
    throw new Error(
      `@vestra/api ${API_VERSION} requires a running Vestra host with API major version 1.`,
    );
  }
  return host;
}

function service<K extends keyof VestraAPI>(name: K): VestraAPI[K] {
  return new Proxy(
    {},
    {
      get(_target, property) {
        const host = getVestra()[name] as object;
        const value: unknown = Reflect.get(host, property);
        return typeof value === "function" ? value.bind(host) : value;
      },
    },
  ) as VestraAPI[K];
}

export const Settings = service("Settings");
export const Styles = service("Styles");
export const Patcher = service("Patcher");
export const Plugins = service("Plugins");
export const Toasts = service("Toasts");
export const Logger = service("Logger");
export const Webpack = service("Webpack");
export const Discord = service("Discord");
export const Native = service("Native");
export const UI = service("UI");

/** Register once; respect saved toggles when loading into an already started host. */
export async function registerPlugin(
  definition: PluginDefinition,
): Promise<void> {
  const host = getVestra();
  host.Plugins.register(definition);
  if (host.started && host.Plugins.isEnabled(definition.name))
    await host.Plugins.enable(definition.name);
}
