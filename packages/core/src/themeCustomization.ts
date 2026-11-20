import {
  ThemeCustomizationSchema,
  type Theme,
  type ThemeCustomization,
} from "./api/settings.js";
import glassCss from "../../../themes/liquid-glass.theme.css";

export const DEFAULT_THEME_CUSTOMIZATION: ThemeCustomization =
  ThemeCustomizationSchema.parse({});
const scope =
  ":root,body,:is(.theme-dark,.theme-darker,.theme-midnight,.theme-light,.custom-theme-background):not(.custom-user-profile-theme)";
const exclude =
  ":not(.custom-user-profile-theme):not(.custom-user-profile-theme *):not([data-vestra-root])";
const readableSurfaces = glassCss.slice(
  glassCss.indexOf("/* Readable glass surfaces */"),
);

type ThemeInput = Pick<Theme, "css" | "customization">;

/** Small insertion-ordered cache; the oldest entry goes first when full. */
function boundedCache<V>(capacity: number) {
  const entries = new Map<string, V>();
  return {
    get(key: string): V | undefined {
      const value = entries.get(key);
      if (value !== undefined) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set(key: string, value: V): void {
      entries.delete(key);
      if (entries.size >= capacity)
        entries.delete(entries.keys().next().value as string);
      entries.set(key, value);
    },
  };
}

interface AuthoredFacts {
  /** `background-tertiary`, else `background-primary`, else undefined. */
  base: string | undefined;
  paneRgb: string;
  popupRgb: string;
  wallpaper: string | undefined;
}

/** Generator work counters; tests use them to observe cache hits. */
export const themeCssCounters = { generated: 0, authoredScans: 0 };

/**
 * The regex pass over the theme's own CSS depends on the CSS alone. The
 * facts are small, so the whole library (32 themes) plus a draft fits.
 */
const authoredFactsCache = boundedCache<AuthoredFacts>(33);

function authoredFacts(css: string): AuthoredFacts {
  const cached = authoredFactsCache.get(css);
  if (cached) return cached;
  themeCssCounters.authoredScans++;
  const authoredColor = (token: string): string | undefined =>
    css.match(
      new RegExp(`--${token}:\\s*(#[\\da-f]{6})(?:[\\da-f]{2})?\\b`, "i"),
    )?.[1];
  const rgbColor = (hex: string): string =>
    [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16))
      .join(" ");
  const primary = authoredColor("background-primary");
  const facts: AuthoredFacts = {
    base: authoredColor("background-tertiary") ?? primary,
    paneRgb: rgbColor(primary ?? "#16121e"),
    popupRgb: rgbColor(authoredColor("background-floating") ?? "#181520"),
    wallpaper:
      css.match(/#app-mount\s*\{\s*background:([^;]+)!important;/)?.[1] ||
      undefined,
  };
  authoredFactsCache.set(css, facts);
  return facts;
}

/** Only the backdrop is filtered; text, avatars and shared images keep their colors. */
export function themeCustomizationCss(theme: ThemeInput): string {
  if (!theme.customization) return "";
  const c = ThemeCustomizationSchema.parse(theme.customization);
  const authored = authoredFacts(theme.css);
  const base = c.backgroundColor || (authored.base ?? "#262132");
  const { paneRgb, popupRgb } = authored;
  const originalWallpaper = authored.wallpaper || base;
  const wallpaper = c.backgroundImage
    ? `url(${JSON.stringify(c.backgroundImage)}) center/cover no-repeat,${base}`
    : c.backgroundColor
      ? `radial-gradient(ellipse at 85% 10%,#ffffff16,transparent 65%),${base}`
      : `var(--vestra-wallpaper,${originalWallpaper})`;
  const pane = `rgb(${paneRgb} / ${c.opacity / 100})`;
  const colorTokens = c.textColor
    ? [
        "text-normal",
        "text-primary",
        "text-default",
        "header-primary",
        "channels-default",
        "interactive-text-default",
      ]
        .map((token) => `--${token}:${c.textColor}!important;`)
        .join("")
    : "";
  const rgb = [1, 3, 5]
    .map((index) => parseInt(c.glowColor.slice(index, index + 2), 16))
    .join(" ");
  const glow = c.glowStrength
    ? `0 0 ${c.glowSize}px rgb(${rgb} / ${(c.glowStrength / 100) * 0.8}),0 0 ${c.glowSize * 2}px rgb(${rgb} / ${(c.glowStrength / 100) * 0.4})`
    : "none";
  const typography = `${scope}{${colorTokens}}
#app-mount{--vestra-text-glow:${glow};text-shadow:var(--vestra-text-glow);}
#app-mount :is(pre,code,[class*="timestamp_"],[class*="badge_"]){text-shadow:none;}`;
  if (!c.surfaceOverrides) return typography;
  return `
${scope}{--vestra-custom-wallpaper:${wallpaper};--glass-home-rgb:${paneRgb};--glass-popup-rgb:${popupRgb};--glass-settings-rgb:${paneRgb};--glass-home-opacity:${c.homeOpacity / 100};--glass-popup-opacity:${c.popupOpacity / 100};--glass-settings-opacity:${c.settingsOpacity / 100};--glass-edge:#ffffff2d;--glass-pane:linear-gradient(135deg,#ffffff1c,#ffffff06 38%,#ffffff0c);--glass-shadow:inset 0 1px 0 #ffffff40,0 10px 38px #00000020;--glass-opacity:${c.opacity / 100};--glass-blur:${c.blur}px;--glass-saturation:${c.saturation}%;--glass-radius:${c.radius}px;
--app-frame-background:transparent!important;--background-primary:transparent!important;--background-secondary:transparent!important;--background-secondary-alt:transparent!important;--background-tertiary:transparent!important;--background-base-lowest:transparent!important;--background-base-lower:transparent!important;--background-base-low:transparent!important;--bg-base-primary:transparent!important;--bg-base-secondary:transparent!important;--bg-base-tertiary:transparent!important;--chat-background:transparent!important;--chat-background-default:transparent!important;--home-background:transparent!important;--custom-channel-members-bg:transparent!important;--vestra-theme-base:transparent!important;--vestra-theme-chat:transparent!important;--vestra-theme-side:transparent!important;--background-gradient-app-frame:initial!important;--background-gradient-chat:initial!important;--background-gradient-low:initial!important;--background-gradient-lower:initial!important;--background-gradient-lowest:initial!important;}
#app-mount{background:var(--vestra-custom-wallpaper)!important;position:relative;isolation:isolate;}
#app-mount::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;background:var(--vestra-custom-wallpaper);filter:saturate(${c.saturation}%) brightness(${c.brightness}%);}
#app-mount :is([class*="app_"],[class*="appMount_"],[class*="bg_"],[class*="layers_"],[class*="layer_"],[class*="base_"],[class*="sidebar_"],[class*="sidebarList_"],[class*="chat_"],[class*="chatContent_"],[class*="content_"],[class*="page_"])${exclude}{background:transparent!important;}
#app-mount :is([class*="guilds_"],[class*="sidebarList_"],[class*="privateChannels_"],[class*="chat_"],[class*="membersWrap_"],[class*="panels_"],[class*="channelTextArea_"])${exclude}{background:var(--glass-pane),${pane}!important;backdrop-filter:blur(${c.blur}px)!important;border:1px solid var(--glass-edge)!important;border-radius:${c.radius}px!important;box-shadow:var(--glass-shadow)!important;}
#app-mount [class*="guilds_"]${exclude}{--vestra-rail-inset:max(12px,${c.radius}px);box-sizing:border-box!important;padding-top:var(--vestra-rail-inset)!important;}
#app-mount [class*="guilds_"]${exclude}:has([class*="scroller_"]){padding-top:0!important;}
#app-mount [class*="guilds_"]${exclude} [class*="scroller_"]:not([class*="scroller_"] [class*="scroller_"]){box-sizing:border-box!important;padding-top:var(--vestra-rail-inset)!important;scroll-padding-top:var(--vestra-rail-inset);}
#app-mount :is([class*="members_"],[class*="scrollableContainer_"],[class*="themedBackground_"])${exclude}{background:transparent!important;}
${readableSurfaces}
${typography}
`;
}

/** Field values match; nested values (objects, arrays) compare by content. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Same customization values; snapshots are copies, so compare fields, not identity. */
function sameCustomization(
  a: ThemeCustomization | undefined,
  b: ThemeCustomization | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a) as (keyof ThemeCustomization)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => sameValue(a[key], b[key]));
}

/**
 * Memoise a theme CSS generator on its inputs (theme CSS + customization
 * values). Entries hold large strings, so only a few distinct themes are kept.
 */
export function memoizeThemeCss(
  generate: (theme: ThemeInput) => string,
  capacity = 8,
): (theme: ThemeInput) => string {
  const cache = boundedCache<{
    customization: ThemeCustomization | undefined;
    output: string;
  }>(capacity);
  return (theme) => {
    const hit = cache.get(theme.css);
    if (hit && sameCustomization(hit.customization, theme.customization))
      return hit.output;
    const output = generate(theme);
    cache.set(theme.css, {
      customization:
        theme.customization && structuredClone(theme.customization),
      output,
    });
    return output;
  };
}

function generateThemeCss(theme: ThemeInput): string {
  themeCssCounters.generated++;
  return theme.css + themeCustomizationCss(theme);
}

/** Runtime and customizer: the active theme and the draft being edited. */
export const customizedThemeCss: (theme: ThemeInput) => string =
  memoizeThemeCss(generateThemeCss);

/**
 * Library previews render every installed theme; they get their own cache,
 * sized for the whole library, so they never evict the runtime's entries.
 */
export const themePreviewCss: (theme: ThemeInput) => string = memoizeThemeCss(
  generateThemeCss,
  32,
);
