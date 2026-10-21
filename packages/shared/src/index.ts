export const VESTRA_VERSION = "0.1.0-alpha.4";
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

/** Numeric-aware version compare (empty/invalid sorts lowest). */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string): { nums: bigint[]; pre: string[] } | undefined => {
    try {
      assertSafeVersion(v);
    } catch {
      return undefined;
    }
    const withoutBuild = v.split("+")[0]!;
    const dash = withoutBuild.indexOf("-");
    const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
    const pre = dash === -1 ? [] : withoutBuild.slice(dash + 1).split(".");
    return { nums: core.split(".").map((s) => BigInt(s)), pre };
  };
  const pa = norm(a);
  const pb = norm(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const na = pa.nums[i] ?? 0n;
    const nb = pb.nums[i] ?? 0n;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  if (!pa.pre.length || !pb.pre.length)
    return pa.pre.length ? -1 : pb.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const left = pa.pre[i];
    const right = pb.pre[i];
    if (left === right) continue;
    if (left === undefined || right === undefined)
      return left === undefined ? -1 : 1;
    const ln = /^\d+$/.test(left);
    const rn = /^\d+$/.test(right);
    if (ln && rn) return BigInt(left) > BigInt(right) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}
