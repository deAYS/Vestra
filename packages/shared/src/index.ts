// @vestra/shared — types, constants and utilities shared across packages.
// Phase 0 skeleton. Expanded in Phase 1+.

export const VESTRA_VERSION = "0.0.0";

export const VESTRA_BRANDING = {
  name: "Vestra",
  tagline: "Your Discord. Your rules.",
  globalObject: "Vestra",
  cssPrefix: "vs-",
  dataAttributePrefix: "data-vestra-",
} as const;

export const VESTRA_COLORS = {
  background: "#06080D",
  surface: "#0C1018",
  surface2: "#121824",
  primary: "#183B73",
  primaryHover: "#20509A",
  text: "#F5F7FA",
  mutedText: "#8D96A5",
  border: "#202938",
} as const;

export const VESTRA_STORAGE_KEY = "vestra-settings";

/**
 * Protocol constant shared by the renderer bridge (`@vestra/core`) and the
 * injector preload/main builders (`@vestra/injector`). Every native channel
 * the renderer may ever request — the single source of truth.
 */
export const VESTRA_NATIVE_CHANNELS = [
  "settings:read",
  "settings:write",
  "shell:openPath",
  "shell:showItemInFolder",
  "app:getVersion",
  "app:getPath",
  "updater:check",
  "updater:install",
] as const;

export type VestraNativeChannel = (typeof VESTRA_NATIVE_CHANNELS)[number];

/** IPC prefix namespacing Vestra channels on the Electron ipc bus. */
export const VESTRA_IPC_PREFIX = "vestra:native:" as const;
