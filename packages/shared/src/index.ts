export const VESTRA_VERSION = "0.1.0-alpha.2";
export const VESTRA_API_VERSION = "1.0.0";
export {
  VESTRA_MARK_PATH,
  VESTRA_BRAND_ACCENT,
  VESTRA_BRAND_NEUTRAL,
} from "./brand.js";

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
  "addons:openFolder",
  "addons:readThemes",
  "addons:writeTheme",
  "addons:removeTheme",
  "updater:check",
  "updater:install",
] as const;

export type VestraNativeChannel = (typeof VESTRA_NATIVE_CHANNELS)[number];

/** IPC prefix namespacing Vestra channels on the Electron ipc bus. */
export const VESTRA_IPC_PREFIX = "vestra:native:" as const;

/** Exact app origins/routes only. Never grant native access to OAuth or embeds. */
export function isDiscordRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      /^(?:(?:canary|ptb)\.)?discord(?:app)?\.com$/.test(url.hostname) &&
      /^\/(?:channels(?:\/|$)|(?:app|login|register)(?:\/|$))/.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

/** Versions become directory names in the installer, updater and store. */
export function assertSafeVersion(value: string): void {
  if (
    typeof value !== "string" ||
    !/^[0-9]+(?:\.[0-9]+){1,3}(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?(?:\+[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(
      value,
    ) ||
    value.includes("..") ||
    value.length > 128
  ) {
    throw new TypeError("Invalid version directory.");
  }
}
