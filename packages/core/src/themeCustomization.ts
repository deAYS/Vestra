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

/** Only the backdrop is filtered; text, avatars and shared images keep their colors. */
export function themeCustomizationCss(
  theme: Pick<Theme, "css" | "customization">,
): string {
  if (!theme.customization) return "";
  const c = ThemeCustomizationSchema.parse(theme.customization);
  const base =
    c.backgroundColor ||
    theme.css.match(
      /--(?:background-primary|background-tertiary):\s*(#[\da-f]{6})\b/i,
    )?.[1] ||
    "#262132";
  const originalWallpaper =
    theme.css.match(/#app-mount\s*\{\s*background:([^;]+)!important;/)?.[1] ||
    base;
  const wallpaper = c.backgroundImage
    ? `url(${JSON.stringify(c.backgroundImage)}) center/cover no-repeat,${base}`
    : c.backgroundColor
      ? `radial-gradient(ellipse at 85% 10%,#ffffff16,transparent 65%),${base}`
      : `var(--vestra-wallpaper,${originalWallpaper})`;
  const pane = `rgb(22 18 30 / ${c.opacity / 100})`;
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
  return `
${scope}{--vestra-custom-wallpaper:${wallpaper};${colorTokens}--glass-home-opacity:${c.homeOpacity / 100};--glass-popup-opacity:${c.popupOpacity / 100};--glass-settings-opacity:${c.settingsOpacity / 100};--glass-edge:#ffffff2d;--glass-pane:linear-gradient(135deg,#ffffff1c,#ffffff06 38%,#ffffff0c);--glass-shadow:inset 0 1px 0 #ffffff40,0 10px 38px #00000020;--glass-opacity:${c.opacity / 100};--glass-blur:${c.blur}px;--glass-saturation:${c.saturation}%;--glass-radius:${c.radius}px;
--app-frame-background:transparent!important;--background-primary:transparent!important;--background-secondary:transparent!important;--background-secondary-alt:transparent!important;--background-tertiary:transparent!important;--background-base-lowest:transparent!important;--background-base-lower:transparent!important;--background-base-low:transparent!important;--bg-base-primary:transparent!important;--bg-base-secondary:transparent!important;--bg-base-tertiary:transparent!important;--chat-background:transparent!important;--chat-background-default:transparent!important;--home-background:transparent!important;--custom-channel-members-bg:transparent!important;--vestra-theme-base:transparent!important;--vestra-theme-chat:transparent!important;--vestra-theme-side:transparent!important;--background-gradient-app-frame:initial!important;--background-gradient-chat:initial!important;--background-gradient-low:initial!important;--background-gradient-lower:initial!important;--background-gradient-lowest:initial!important;}
#app-mount{background:var(--vestra-custom-wallpaper)!important;position:relative;isolation:isolate;}
#app-mount::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;background:var(--vestra-custom-wallpaper);filter:saturate(${c.saturation}%) brightness(${c.brightness}%);}
#app-mount :is([class*="app_"],[class*="appMount_"],[class*="bg_"],[class*="layers_"],[class*="layer_"],[class*="base_"],[class*="sidebar_"],[class*="sidebarList_"],[class*="chat_"],[class*="chatContent_"],[class*="content_"],[class*="page_"])${exclude}{background:transparent!important;}
#app-mount :is([class*="guilds_"],[class*="sidebarList_"],[class*="privateChannels_"],[class*="chat_"],[class*="membersWrap_"],[class*="panels_"],[class*="channelTextArea_"])${exclude}{background:var(--glass-pane),${pane}!important;backdrop-filter:blur(${c.blur}px)!important;border:1px solid var(--glass-edge)!important;border-radius:${c.radius}px!important;box-shadow:var(--glass-shadow)!important;}
#app-mount :is([class*="members_"],[class*="scrollableContainer_"],[class*="themedBackground_"])${exclude}{background:transparent!important;}
${readableSurfaces}
#app-mount{--vestra-text-glow:${glow};text-shadow:var(--vestra-text-glow);}
#app-mount :is(pre,code,[class*="timestamp_"],[class*="badge_"]){text-shadow:none;}
`;
}

export function customizedThemeCss(
  theme: Pick<Theme, "css" | "customization">,
): string {
  return theme.css + themeCustomizationCss(theme);
}
