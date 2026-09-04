// Vestra UI root — Settings UI + overlay + toasts + splash support.

export { VestraSettingsPanel, SETTINGS_PAGES } from "./VestraSettings.js";
export {
  OverlayHost,
  VestraLogo,
  mountOverlay,
  startOverlayShortcuts,
  overlayController,
  createOverlayController,
  getOverlayKeybind,
  setOverlayKeybind,
  OVERLAY_ROOT_ID,
} from "./Overlay.js";
export type { OverlayController, OverlayListener, OverlayMountDeps, ShortcutDeps } from "./Overlay.js";
export { ToastsView, VMark } from "./Toasts.js";
export {
  DEFAULT_OVERLAY_KEYBIND,
  formatCombo,
  isBindable,
  parseCombo,
  comboMatches,
} from "./keybind.js";
export type { KeyEventLike, ParsedCombo } from "./keybind.js";
export { PluginsPage } from "./PluginsPage.js";
export { QuickCssPage } from "./QuickCssPage.js";
export { ThemesPage } from "./ThemesPage.js";
export { AboutPage } from "./AboutPage.js";
export { SettingsHomePage } from "./SettingsHomePage.js";
export { PluginCard } from "./PluginCard.js";
export { VestraErrorBoundary } from "./ErrorBoundary.js";
export { mountVestraSettings, unmountVestraSettings } from "./mount.js";
export type { MountOptions } from "./mount.js";
export { useSettingsSnapshot, useRefreshCounter } from "./hooks.js";
export type {
  PageProps,
  PluginListEntry,
  PluginManagerLike,
  SettingsPageId,
  VestraUIDeps,
} from "./types.js";
