export { Logger, createLogger } from "./logger.js";
export type { LogLevel, RootLogger, ScopedLogger } from "./logger.js";

export { definePlugin, assertValidPluginDefinition, PluginDefinitionSchema } from "./plugins.js";
export type { PluginDefinition, PluginLifecycleFn } from "./plugins.js";

export {
  Settings,
  SettingsStore,
  createSettingsStore,
  VestraSettingsSchema,
  PluginSettingsEntrySchema,
  CustomCssSchema,
  DEFAULT_SETTINGS,
} from "./settings.js";
export type { VestraSettings, PluginSettingsEntry, CustomCss, SettingsListener } from "./settings.js";
export { ThemeSchema, ThemeCustomizationSchema } from "./settings.js";
export type { Theme, ThemeCustomization } from "./settings.js";
export { importTheme, startThemes, MIDNIGHT_THEME, THEME_LIBRARY } from "../themes.js";

export {
  PluginManager,
  pluginManager,
  createDefaultEnabledStateStorage,
  createSettingsEnabledStateStorage,
} from "../pluginManager.js";
export type { EnabledStateStorage, PluginRecord } from "../pluginManager.js";

export {
  Styles,
  StylesManager,
  createStylesManager,
  sanitizeStyleId,
  STYLE_DATA_ATTRIBUTE,
  STYLE_ELEMENT_PREFIX,
} from "./styles.js";
export type { ManagedStyleElement, StyleDocument, StylesManagerOptions } from "./styles.js";

export { QUICKCSS_STYLE_ID, applyQuickCssState, startQuickCss } from "../quickCss.js";
export type { QuickCssState, StartQuickCssDeps } from "../quickCss.js";

export {
  Toasts,
  ToastManager,
  createToastManager,
} from "./toasts.js";
export type { Toast, ToastListener, ToastManagerOptions, ToastOptions, ToastType } from "./toasts.js";

export {
  VestraLogo,
  VestraSettingsPanel,
  SETTINGS_PAGES,
  PluginsPage,
  QuickCssPage,
  ThemesPage,
  AboutPage,
  SettingsHomePage,
  PluginCard,
  VestraErrorBoundary,
  OverlayHost,
  ToastsView,
  VMark,
  mountVestraSettings,
  unmountVestraSettings,
  mountOverlay,
  startOverlayShortcuts,
  overlayController,
  createOverlayController,
  getOverlayKeybind,
  setOverlayKeybind,
  OVERLAY_ROOT_ID,
  DEFAULT_OVERLAY_KEYBIND,
  formatCombo,
  isBindable,
  parseCombo,
  comboMatches,
} from "../ui/index.js";
export type {
  MountOptions,
  OverlayController,
  OverlayListener,
  OverlayMountDeps,
  ShortcutDeps,
  PageProps,
  PluginListEntry,
  PluginManagerLike,
  SettingsPageId,
  VestraUIDeps,
  KeyEventLike,
  ParsedCombo,
} from "../ui/index.js";

export {
  Webpack,
  WebpackFinder,
  createWebpackFinder,
  filters,
  getWebpackRequire,
  enumerateModules,
  waitForModule,
} from "../webpack/index.js";
export type {
  FindOptions,
  FluxStoreLike,
  ModuleFilter,
  ModuleSearch,
  RequireSource,
  WaitForOptions,
  WebpackExports,
  WebpackFinderOptions,
  WebpackRequireLike,
} from "../webpack/index.js";

export { patcher, Patcher, createPatcher } from "./patcher.js";
export type {
  AfterHook,
  BeforeHook,
  InsteadHook,
  PatchOwner,
  PatcherOptions,
  Unpatch,
} from "./patcher.js";

export {
  Discord,
  UserStore,
  ChannelStore,
  GuildStore,
  SelectedChannel,
  Dispatcher,
  DiscordReact,
  defineWrapper,
  createUserStore,
  createChannelStore,
  createGuildStore,
  createSelectedChannel,
  createDispatcher,
  createDiscordReact,
} from "../discord/index.js";
export type {
  ChannelStoreFacade,
  DefineWrapperOptions,
  DiscordAPI,
  DiscordChannel,
  DiscordGuild,
  DiscordReactFacade,
  DiscordUser,
  DiscordWrapper,
  DispatcherCallback,
  DispatcherFacade,
  GuildStoreFacade,
  SelectedChannelFacade,
  UserStoreFacade,
  WrapperFactoryOptions,
} from "../discord/index.js";

export {
  Native,
  NativeBridge,
  NativeDeniedError,
  NativeUnavailableError,
  NATIVE_CHANNELS,
  createNativeBridge,
} from "./native.js";
export type {
  NativeBridgeOptions,
  NativeChannel,
  NativeTransport,
  UpdateCheckResult,
} from "./native.js";
