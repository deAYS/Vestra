import {
  ThemeCustomizationSchema,
  type Theme,
  type ThemeCustomization,
} from "./api/settings.js";
import glassCss from "../../../themes/liquid-glass.theme.css";
import type { GlassInputs } from "./glassWallpaper.js";

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
  /** The theme's `--vestra-wallpaper` value (a CSS background). */
  cssWallpaper: string | undefined;
  /** Declared `--glass-blur`/`--glass-saturation`: the theme's own pane blur. */
  glass: { blur: number; saturation: number } | undefined;
  /** How the renderer handles the theme's own wallpaper (computed on first use). */
  ownWallpaper: WallpaperSource | undefined;
}

/** Generator work counters; tests use them to observe cache hits. */
export const themeCssCounters = { generated: 0, authoredScans: 0 };

/**
 * The regex pass over the theme's own CSS depends on the CSS alone. The
 * facts are small, so the whole library (32 themes) plus a draft fits.
 */
const authoredFactsCache = boundedCache<AuthoredFacts>(33);

/**
 * The value of the declaration starting at `from`: up to the first `;` or `}`
 * outside quotes and parentheses, so `url("data:image/png;base64,…")` stays whole.
 */
function declarationValue(css: string, from: number): string {
  let depth = 0;
  let quote = "";
  for (let index = from; index < css.length; index++) {
    const char = css[index]!;
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if ((char === ";" || char === "}") && depth === 0)
      return css.slice(from, index);
  }
  return css.slice(from);
}

/**
 * The first `pattern` declaration's value, `!important` removed; with
 * `important`, the first one marked `!important`. `pattern` must be global.
 */
function authoredValue(
  css: string,
  pattern: RegExp,
  important = false,
): string | undefined {
  for (const match of css.matchAll(pattern)) {
    const value = declarationValue(css, match.index + match[0].length);
    if (important && !/!important\s*$/.test(value)) continue;
    return value.replace(/!important\s*$/, "").trim() || undefined;
  }
  return undefined;
}

/**
 * Replace `var(--name)` (or `var(--name,fallback)`) with the value the theme
 * itself declares for `--name`, else the fallback. Unknown variables and
 * cycles stay as they are (and make the wallpaper undrawable).
 */
function resolveVariables(css: string, value: string): string {
  let result = value;
  for (let pass = 0; pass < 4 && /var\(/i.test(result); pass++) {
    const next = result.replace(
      /var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g,
      (whole, name: string, fallback: string | undefined) =>
        authoredValue(css, new RegExp(`(?<![\\w-])${name}\\s*:`, "g")) ??
        fallback?.trim() ??
        whole,
    );
    if (next === result) break;
    result = next;
  }
  return result;
}

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
    wallpaper: authoredValue(css, /#app-mount\s*\{\s*background:/g, true),
    cssWallpaper: authoredValue(css, /--vestra-wallpaper:/g),
    ownWallpaper: undefined,
    glass: undefined,
  };
  const blur = css.match(/--glass-blur:\s*(\d+(?:\.\d+)?)px/)?.[1];
  if (blur)
    facts.glass = {
      blur: Number(blur),
      saturation: Number(
        css.match(/--glass-saturation:\s*(\d+(?:\.\d+)?)%/)?.[1] ?? 100,
      ),
    };
  authoredFactsCache.set(css, facts);
  return facts;
}

/**
 * Large panes paint the pre-blurred wallpaper (see glassWallpaper.ts) fixed to
 * the window, like the sharp wallpaper, instead of a live backdrop blur.
 */
const GLASS_PANE_IMAGE = "var(--vestra-glass-image,none) center/cover fixed";
/**
 * The generated pane rule switches off any live pane blur of the theme itself
 * (edited copies of older Liquid Glass versions keep theirs). Only preview
 * frames, which have no renderer, define this variable to show the blur.
 */
const GLASS_PANE_FILTER = "var(--vestra-glass-pane-filter,none)";

/**
 * A CSS wallpaper the renderer can draw: gradients only, with nothing to
 * fetch and no variables to resolve. Flat colours need no blurred copy.
 */
function drawableCss(css: string | undefined): string | null {
  if (!css || !css.includes("gradient(") || /url\(|var\(/i.test(css))
    return null;
  return css.trim();
}

/** How the renderer handles a wallpaper; all fields empty means a flat colour. */
interface WallpaperSource {
  /** One image the renderer draws like `center/cover`. */
  image: string | null;
  /** A gradient wallpaper the renderer rasterizes. */
  css: string | null;
  /** Not a flat colour, but not drawable either: CSS blurs the wallpaper layer. */
  forceLayer: boolean;
}

const NON_FLAT = /(?:gradient|url|var|image-set|cross-fade|element|paint)\(/i;
const IMAGE_LAYER =
  /^url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^)"'\s\\]*))\s*\)(.*)$/is;
/** Layer keywords that still look like the renderer's `center/cover` drawing. */
const COVER_KEYWORDS = new Set(["center", "cover", "no-repeat", "repeat", "fixed", "scroll"]);

/** Background layers: the value split at commas outside quotes and parentheses. */
function backgroundLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers;
}

/**
 * Classify a wallpaper value. A single `url()` of a data: or https: image
 * laid out as `center/cover` (optionally over a flat colour) is drawn by the
 * renderer, which falls back to the layer when it cannot read the image.
 * Gradients are rasterized. Anything else that is not a flat colour (other
 * URLs, image layouts or layers, unresolvable `var()` chains) uses the layer.
 */
function classifyWallpaper(value: string | undefined): WallpaperSource {
  const none: WallpaperSource = { image: null, css: null, forceLayer: false };
  if (!value || !NON_FLAT.test(value)) return none;
  if (/url\(/i.test(value)) {
    const [first = "", color, ...rest] = backgroundLayers(value.trim());
    const layer = IMAGE_LAYER.exec(first);
    const url = (layer?.[1] ?? layer?.[2] ?? layer?.[3] ?? "").trim();
    const keywords = (layer?.[4] ?? "")
      .toLowerCase()
      .replace(/\//g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const drawable =
      !!layer &&
      /^(?:data:image\/|https:)/i.test(url) &&
      keywords.includes("cover") &&
      keywords.every((keyword) => COVER_KEYWORDS.has(keyword)) &&
      !rest.length &&
      !(color !== undefined && NON_FLAT.test(color));
    return drawable ? { ...none, image: url } : { ...none, forceLayer: true };
  }
  const css = drawableCss(value);
  return css ? { ...none, css } : { ...none, forceLayer: true };
}

/** The customized wallpaper: its CSS value, and how the renderer handles it. */
function customWallpaper(
  c: ThemeCustomization,
  authored: AuthoredFacts,
  css: string,
): WallpaperSource & { value: string } {
  const base = c.backgroundColor || (authored.base ?? "#262132");
  if (c.backgroundImage)
    return {
      value: `url(${JSON.stringify(c.backgroundImage)}) center/cover no-repeat,${base}`,
      image: c.backgroundImage,
      css: null,
      forceLayer: false,
    };
  if (c.backgroundColor) {
    const value = `radial-gradient(ellipse at 85% 10%,#ffffff16,transparent 65%),${base}`;
    return { value, image: null, css: value, forceLayer: false };
  }
  const original = authored.wallpaper || base;
  authored.ownWallpaper ??= classifyWallpaper(
    resolveVariables(css, authored.cssWallpaper ?? original),
  );
  return { value: `var(--vestra-wallpaper,${original})`, ...authored.ownWallpaper };
}

/**
 * What the wallpaper renderer needs for a theme, if anything: a customized
 * theme's wallpaper with its blur, saturation and brightness, or a theme's
 * own CSS wallpaper when it declares its pane blur (Liquid Glass).
 */
export function glassInputs(theme: ThemeInput): GlassInputs | null {
  const authored = authoredFacts(theme.css);
  const c = theme.customization
    ? ThemeCustomizationSchema.parse(theme.customization)
    : undefined;
  if (c?.surfaceOverrides) {
    const wallpaper = customWallpaper(c, authored, theme.css);
    return {
      image: wallpaper.image,
      css: wallpaper.css,
      ...(wallpaper.forceLayer ? { forceLayer: true } : {}),
      blur: c.blur,
      saturation: c.saturation,
      brightness: c.brightness,
    };
  }
  const css = drawableCss(authored.cssWallpaper);
  if (!authored.glass || !css) return null;
  return {
    image: null,
    css,
    blur: authored.glass.blur,
    saturation: authored.glass.saturation,
    brightness: 100,
  };
}

/** Only the backdrop is filtered; text, avatars and shared images keep their colors. */
export function themeCustomizationCss(theme: ThemeInput): string {
  if (!theme.customization) return "";
  const c = ThemeCustomizationSchema.parse(theme.customization);
  const authored = authoredFacts(theme.css);
  const { paneRgb, popupRgb } = authored;
  const custom = customWallpaper(c, authored, theme.css);
  const wallpaper = custom.value;
  // Previews have no renderer; they blur the panes wherever the app does.
  const previewFilter =
    (custom.image || custom.css || custom.forceLayer) && c.blur > 0
      ? `blur(${c.blur}px)`
      : "none";
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
${scope}{--vestra-custom-wallpaper:${wallpaper};--glass-home-rgb:${paneRgb};--glass-popup-rgb:${popupRgb};--glass-settings-rgb:${paneRgb};--glass-home-opacity:${c.homeOpacity / 100};--glass-popup-opacity:${c.popupOpacity / 100};--glass-settings-opacity:${c.settingsOpacity / 100};--glass-edge:#ffffff2d;--glass-pane:linear-gradient(135deg,#ffffff1c,#ffffff06 38%,#ffffff0c);--glass-shadow:inset 0 1px 0 #ffffff40,0 10px 38px #00000020;--glass-opacity:${c.opacity / 100};--glass-blur:${c.blur}px;--glass-saturation:${c.saturation}%;--glass-radius:${c.radius}px;--vestra-glass-preview-filter:${previewFilter};
--app-frame-background:transparent!important;--background-primary:transparent!important;--background-secondary:transparent!important;--background-secondary-alt:transparent!important;--background-tertiary:transparent!important;--background-base-lowest:transparent!important;--background-base-lower:transparent!important;--background-base-low:transparent!important;--bg-base-primary:transparent!important;--bg-base-secondary:transparent!important;--bg-base-tertiary:transparent!important;--chat-background:transparent!important;--chat-background-default:transparent!important;--home-background:transparent!important;--custom-channel-members-bg:transparent!important;--vestra-theme-base:transparent!important;--vestra-theme-chat:transparent!important;--vestra-theme-side:transparent!important;--background-gradient-app-frame:initial!important;--background-gradient-chat:initial!important;--background-gradient-low:initial!important;--background-gradient-lower:initial!important;--background-gradient-lowest:initial!important;}
#app-mount{background:var(--vestra-custom-wallpaper)!important;position:relative;isolation:isolate;}
#app-mount::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;background:var(--vestra-custom-wallpaper);filter:saturate(${c.saturation}%) brightness(${c.brightness}%);}
#app-mount :is([class*="app_"],[class*="appMount_"],[class*="bg_"],[class*="layers_"],[class*="layer_"],[class*="base_"],[class*="sidebar_"],[class*="sidebarList_"],[class*="chat_"],[class*="chatContent_"],[class*="content_"],[class*="page_"])${exclude}{background:transparent!important;}
#app-mount :is([class*="guilds_"],[class*="sidebarList_"],[class*="privateChannels_"],[class*="chat_"],[class*="membersWrap_"],[class*="panels_"],[class*="channelTextArea_"])${exclude}{background:var(--glass-pane),linear-gradient(${pane},${pane}),${GLASS_PANE_IMAGE}!important;backdrop-filter:${GLASS_PANE_FILTER}!important;border:1px solid var(--glass-edge)!important;border-radius:${c.radius}px!important;box-shadow:var(--glass-shadow)!important;}
#app-mount [class*="container_"]:has(>[class*="tabBody_"])${exclude}{backdrop-filter:${GLASS_PANE_FILTER}!important;}
#app-mount :is([class*="guilds_"],[class*="sidebarList_"],[class*="privateChannels_"],[class*="chat_"],[class*="membersWrap_"],[class*="panels_"],[class*="channelTextArea_"],[class*="container_"]:has(>[class*="tabBody_"]))${exclude}>*{--vestra-glass-image:none;}
:root[data-vestra-glass="layer"] #app-mount::before{inset:-${Math.ceil(c.blur * 2)}px;filter:blur(${c.blur}px) saturate(${c.saturation}%) brightness(${c.brightness}%);}
#app-mount [class*="guilds_"]${exclude}{--vestra-rail-inset:max(12px,${c.radius}px);box-sizing:border-box!important;padding-top:var(--vestra-rail-inset)!important;}
#app-mount [class*="guilds_"]${exclude}:has([class*="scroller_"]){padding-top:0!important;}
#app-mount [class*="guilds_"]${exclude} [class*="scroller_"]:not([class*="scroller_"] [class*="scroller_"]){box-sizing:border-box!important;padding-top:var(--vestra-rail-inset)!important;scroll-padding-top:var(--vestra-rail-inset);}
#app-mount :is([class*="members_"],[class*="scrollableContainer_"],[class*="themedBackground_"])${exclude}{background:transparent!important;}
${readableSurfaces}
${typography}
`;
}

/**
 * A copy of the customization for later comparison. Strings (the embedded
 * image can be megabytes) are shared, not copied; only nested values are cloned.
 */
function snapshot(customization: ThemeCustomization): ThemeCustomization {
  const copy: Record<string, unknown> = { ...customization };
  for (const [key, value] of Object.entries(copy))
    if (typeof value === "object" && value !== null)
      copy[key] = structuredClone(value);
  return copy as ThemeCustomization;
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
      customization: theme.customization && snapshot(theme.customization),
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
