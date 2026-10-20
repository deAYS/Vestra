import { Settings, type SettingsStore, type Theme } from "./api/settings.js";
import { Styles, type StylesManager } from "./api/styles.js";
import { Native, type NativeBridge } from "./api/native.js";
import glassCss from "../../../themes/liquid-glass.theme.css";
import afterglowCss from "../../../themes/afterglow.theme.css";
import { customizedThemeCss } from "./themeCustomization.js";

const LEGACY_MIDNIGHT_THEME = `/**
 * @name Vestra Midnight
 * @author Vestra
 * @description Deep blue surfaces with a soft ice accent.
 */
:root, .theme-dark {
  --background-primary: #0b101b;
  --background-secondary: #090d16;
  --background-secondary-alt: #070b13;
  --background-tertiary: #06080d;
  --background-floating: #111a29;
  --channeltextarea-background: #141e30;
  --brand-500: #618df2;
  --brand-560: #527cdb;
  --brand-600: #436ac2;
  --text-link: #9ac6ff;
}
`;

const LEGACY_THEME_LIBRARY = [
  {
    name: "Vestra Midnight",
    description: "Deep navy · soft ice",
    colors: ["#06080d", "#0b101b", "#618df2"],
    css: LEGACY_MIDNIGHT_THEME,
  },
  {
    name: "Vestra Graphite",
    description: "Neutral charcoal · silver",
    colors: ["#101112", "#1b1d20", "#a3adb9"],
    css: `/** @name Vestra Graphite\n * @author Vestra\n */\n:root,.theme-dark{--background-primary:#1b1d20;--background-secondary:#151719;--background-secondary-alt:#121416;--background-tertiary:#101112;--background-floating:#23262a;--channeltextarea-background:#26292e;--brand-500:#858f9e;--brand-560:#727e90;--brand-600:#626f83;--text-link:#c1cfdf}`,
  },
  {
    name: "Vestra Rose",
    description: "Warm dusk · rose quartz",
    colors: ["#160d14", "#241622", "#c985a9"],
    css: `/** @name Vestra Rose\n * @author Vestra\n */\n:root,.theme-dark{--background-primary:#241622;--background-secondary:#1c111b;--background-secondary-alt:#180e16;--background-tertiary:#160d14;--background-floating:#30202e;--channeltextarea-background:#332131;--brand-500:#c985a9;--brand-560:#b47296;--brand-600:#a46388;--text-link:#efb3d0}`,
  },
  {
    name: "Vestra Aurora",
    description: "Forest shadows · mint",
    colors: ["#081311", "#101f1c", "#62bda4"],
    css: `/** @name Vestra Aurora\n * @author Vestra\n */\n:root,.theme-dark{--background-primary:#101f1c;--background-secondary:#0b1916;--background-secondary-alt:#091613;--background-tertiary:#081311;--background-floating:#1b3029;--channeltextarea-background:#1b3029;--brand-500:#62bda4;--brand-560:#4ba88e;--brand-600:#39917a;--text-link:#a4e5cc}`,
  },
] as const;

interface Palette {
  base: string;
  chat: string;
  side: string;
  panel: string;
  raised: string;
  input: string;
  accent: string;
  hover: string;
  pressed: string;
  link: string;
}
const palettes: Palette[] = [
  {
    base: "#06080d",
    chat: "#0b101b",
    side: "#090d16",
    panel: "#070b13",
    raised: "#111a29",
    input: "#141e30",
    accent: "#618df2",
    hover: "#527cdb",
    pressed: "#436ac2",
    link: "#9ac6ff",
  },
  {
    base: "#101112",
    chat: "#1b1d20",
    side: "#151719",
    panel: "#121416",
    raised: "#23262a",
    input: "#26292e",
    accent: "#858f9e",
    hover: "#727e90",
    pressed: "#626f83",
    link: "#c1cfdf",
  },
  {
    base: "#160d14",
    chat: "#241622",
    side: "#1c111b",
    panel: "#180e16",
    raised: "#30202e",
    input: "#332131",
    accent: "#c985a9",
    hover: "#b47296",
    pressed: "#a46388",
    link: "#efb3d0",
  },
  {
    base: "#081311",
    chat: "#101f1c",
    side: "#0b1916",
    panel: "#091613",
    raised: "#1b3029",
    input: "#1b3029",
    accent: "#62bda4",
    hover: "#4ba88e",
    pressed: "#39917a",
    link: "#a4e5cc",
  },
];

/** Modern Discord tokens must be set on nested theme scopes as well as :root.
 * Old background-primary alone only affects legacy surfaces. No hashed classes.
 * References and compatibility scope: docs/DISCORD_COMPATIBILITY.md.
 */
function presetCss(name: string, p: Palette, revision = 3): string {
  const tokens: Record<string, string> = {
    "app-frame-background": p.base,
    "app-frame-border": "#ffffff12",
    "background-primary": p.chat,
    "background-secondary": p.side,
    "background-secondary-alt": p.panel,
    "background-tertiary": p.base,
    "background-floating": p.raised,
    "background-base-lowest": p.base,
    "background-base-lower": p.side,
    "background-base-low": p.chat,
    "background-surface-high": p.raised,
    "background-surface-higher": p.input,
    "background-surface-highest": p.input,
    "background-accent": p.input,
    "background-code": p.panel,
    "background-mod-normal": p.raised,
    "background-mod-subtle": "#ffffff08",
    "background-mod-muted": "#ffffff0b",
    "background-mod-strong": "#ffffff14",
    "background-modifier-hover": "#ffffff09",
    "background-modifier-active": "#ffffff12",
    "background-modifier-selected": "#ffffff16",
    "background-modifier-accent": "#ffffff12",
    "background-brand": p.accent,
    "bg-base-primary": p.chat,
    "bg-base-secondary": p.side,
    "bg-base-tertiary": p.base,
    "bg-surface-overlay": p.raised,
    "bg-surface-raised": p.raised,
    "bg-surface-overlay-tmp": p.raised,
    "chat-background": p.chat,
    "chat-background-default": p.chat,
    "chat-background-selected": p.side,
    "home-background": p.chat,
    "channeltextarea-background": p.input,
    "input-background": p.input,
    "input-background-default": p.input,
    "input-text-default": "#eeeaf4",
    "input-placeholder-text-default": "#a49aaa",
    "modal-background": p.raised,
    "modal-footer-background": p.side,
    "card-primary-bg": p.raised,
    "card-background-default": p.raised,
    "activity-card-background": p.side,
    "custom-channel-members-bg": p.side,
    "brand-500": p.accent,
    "brand-560": p.hover,
    "brand-600": p.pressed,
    "brand-experiment": p.accent,
    "text-normal": "#e3dfea",
    "text-primary": "#e3dfea",
    "text-default": "#e3dfea",
    "text-secondary": "#b5acbf",
    "text-muted": "#a49aaa",
    "header-primary": "#f5f1fa",
    "header-secondary": "#b5acbf",
    "text-link": p.link,
    "text-link-low-saturation": p.link,
    "channels-default": "#b5acbf",
    "interactive-normal": "#b5acbf",
    "interactive-hover": "#f5f1fa",
    "interactive-active": "#ffffff",
    "interactive-muted": "#7c7387",
    "interactive-text-default": "#b5acbf",
    "interactive-text-hover": "#f5f1fa",
    "interactive-text-active": "#ffffff",
    "interactive-icon-default": "#b5acbf",
    "interactive-icon-hover": "#f5f1fa",
    "interactive-icon-active": "#ffffff",
    "interactive-background-hover": "#ffffff09",
    "interactive-background-selected": "#ffffff16",
    "interactive-background-active": "#ffffff12",
    "icon-default": "#b5acbf",
    "icon-muted": "#8d8399",
    "icon-strong": "#f5f1fa",
    "icon-subtle": "#b5acbf",
    "border-subtle": "#ffffff0d",
    "border-normal": "#ffffff18",
    "border-strong": "#ffffff26",
    "border-faint": "#ffffff08",
    "mention-background": `${p.accent}24`,
    "mention-foreground": p.link,
    "background-mentioned": `${p.accent}18`,
    "background-mentioned-hover": `${p.accent}26`,
    "message-mentioned-background-default": `${p.accent}18`,
    "message-mentioned-background-hover": `${p.accent}26`,
    "message-background-hover": "#ffffff05",
    "scrollbar-auto-track": p.side,
    "scrollbar-auto-thumb": p.input,
    "scrollbar-thin-thumb": p.input,
    "scrollbar-thin-track": "transparent",
    "control-primary-background-default": p.accent,
    "control-primary-background-hover": p.hover,
    "control-primary-background-active": p.pressed,
    "control-primary-text-default": "#ffffff",
    "control-primary-text-hover": "#ffffff",
    "control-primary-text-active": "#ffffff",
    "control-primary-icon-default": "#ffffff",
    "control-primary-icon-hover": "#ffffff",
    "control-primary-icon-active": "#ffffff",
    "control-secondary-background-default": p.input,
    "control-secondary-background-hover": p.raised,
    "control-secondary-background-active": p.side,
  };
  if (revision >= 3) {
    // Discord's custom backgrounds precede the solid-color fallback on surfaces.
    // A guaranteed-invalid value lets those surfaces use our semantic palette.
    for (const layer of [
      "app-frame",
      "chat",
      "chat-preview",
      "low",
      "lower",
      "lowest",
      "high",
      "higher",
      "highest",
    ]) {
      tokens[`background-gradient-${layer}`] = "initial";
    }
    tokens["vestra-theme-base"] = p.base;
    tokens["vestra-theme-chat"] = p.chat;
    tokens["vestra-theme-side"] = p.side;
    tokens["vestra-theme-input"] = p.input;
  }
  const scopes =
    revision >= 3
      ? ".theme-dark,.theme-darker,.theme-midnight,.theme-light,.custom-theme-background"
      : ".theme-dark,.theme-darker,.theme-midnight,.theme-light";
  const mount = ':is(#app-mount,[class*="appMount_"])';
  const surface = (selectors: string, color: string): string =>
    `${mount} :is(${selectors}):not(.custom-user-profile-theme):not(.custom-user-profile-theme *){background:var(--vestra-theme-${color})!important;}`;
  const surfaces =
    revision >= 3
      ? `\n${mount}{background:var(--vestra-theme-base)!important;}\n${surface('[class*="bg_"],[class*="guilds_"]', "base")}\n${surface('[class*="chat_"],[class*="chatContent_"]', "chat")}\n${surface('[class*="sidebarList_"],[class*="privateChannels_"],[class*="members_"],[class*="membersWrap_"]', "side")}\n${surface('[class*="channelTextArea_"],[class*="scrollableContainer_"]', "input")}`
      : "";
  return `/** @name ${name}\n * @author Vestra\n * @vestra-preset ${revision}\n */\n:root,body,:is(${scopes}):not(.custom-user-profile-theme){\n  color-scheme:dark;\n${Object.entries(
    tokens,
  )
    .map(([key, value]) => `  --${key}:${value}!important;`)
    .join("\n")}\n}${surfaces}`;
}

export const THEME_LIBRARY = [
  ...LEGACY_THEME_LIBRARY.map((preset, index) => ({
    ...preset,
    css: presetCss(preset.name, palettes[index]!),
  })),
  {
    name: "Vestra Afterglow",
    description: "Smoked copper · warm horizons",
    colors: ["#100b0b", "#1d1414", "#e6ad83"],
    css: afterglowCss,
  },
  {
    name: "Vestra Liquid Glass",
    description: "Pearl light · frosted floating panels",
    colors: ["#262132", "#5c4a67", "#ddd2ff"],
    css: glassCss,
  },
];
export const MIDNIGHT_THEME = THEME_LIBRARY[0]!.css;

/** Exact shipped CSS only: a custom theme sharing our name is never replaced. */
export function upgradeBuiltinThemes(store: SettingsStore): void {
  let changed = false;
  const next = store.getThemes().map((theme) => {
    const index = LEGACY_THEME_LIBRARY.findIndex(
      (preset, index) =>
        (preset.css === theme.css ||
          presetCss(preset.name, palettes[index]!, 2) === theme.css) &&
        preset.name === theme.name &&
        theme.author === "Vestra",
    );
    if (index < 0) return theme;
    changed = true;
    return { ...theme, css: THEME_LIBRARY[index]!.css };
  });
  if (changed) store.setThemes(next);
}

export function applyThemePreset(
  store: SettingsStore,
  preset: (typeof THEME_LIBRARY)[number],
): void {
  upgradeBuiltinThemes(store);
  const existing = store.getThemes().find((theme) => theme.css === preset.css);
  const selected = existing ?? importTheme(store, preset.css, "preset.css");
  store.setThemes(
    store
      .getThemes()
      .map((theme) => ({ ...theme, enabled: theme.id === selected.id })),
  );
}

export function importTheme(
  store: SettingsStore,
  css: string,
  filename: string,
): Theme {
  const theme = parseTheme(css, filename);
  store.setThemes([...store.getThemes(), theme]);
  return theme;
}

function parseTheme(css: string, filename: string): Theme {
  if (!css.trim()) throw new TypeError("The theme file is empty.");
  if (css.length > 512_000)
    throw new TypeError("Themes must be smaller than 512 KB.");
  const field = (name: string): string | undefined =>
    css.match(new RegExp(`@${name}\\s+([^\\r\\n*]+)`))?.[1]?.trim();
  const theme: Theme = {
    id: `theme-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)}`,
    name: (
      field("name") ||
      filename.replace(/\.theme\.css$|\.css$/i, "") ||
      "Untitled theme"
    ).slice(0, 120),
    author: (field("author") || "Unknown").slice(0, 120),
    css,
    enabled: false,
  };
  return theme;
}

export async function refreshLocalThemes(
  store: SettingsStore = Settings,
  native: Pick<NativeBridge, "readThemeFiles"> = Native,
): Promise<void> {
  const files = await native.readThemeFiles();
  const names = new Set(files.map((file) => file.filename));
  const current = store.getThemes();
  const next = current.map((theme) => ({
    ...theme,
    ...(theme.sourceFile
      ? { sourceMissing: !names.has(theme.sourceFile) }
      : {}),
  }));
  for (const file of files) {
    const existing = next.find((theme) => theme.sourceFile === file.filename);
    if (!file.source.trim()) {
      if (existing) existing.sourceMissing = true;
      continue;
    }
    if (existing) {
      existing.sourceMissing = false;
      if (existing.css !== file.source) {
        const parsed = parseTheme(file.source, file.filename);
        Object.assign(existing, {
          css: parsed.css,
          name: parsed.name,
          author: parsed.author,
          sourceMissing: false,
        });
      }
    } else {
      next.push({
        ...parseTheme(file.source, file.filename),
        sourceFile: file.filename,
        sourceMissing: false,
      });
    }
  }
  if (next.length > 32)
    throw new Error(
      "Your library is full (32 themes). Remove a theme before importing more files.",
    );
  if (JSON.stringify(next) !== JSON.stringify(current)) store.setThemes(next);
  upgradeBuiltinThemes(store);
}

/** Reconcile ordered theme styles; QuickCSS always wins at equal specificity. */
export function startThemes(
  store: SettingsStore = Settings,
  styles: StylesManager = Styles,
): () => void {
  const doc = typeof document !== "undefined" ? document : undefined;
  upgradeBuiltinThemes(store);
  const owned = new Set<string>();
  const sync = (): void => {
    const active = store.getThemes().filter((theme) => theme.enabled);
    const desired = new Set(active.map((theme) => `theme-${theme.id}`));
    if (active.length) desired.add("theme-profile-surfaces");
    for (const id of owned)
      if (!desired.has(id)) {
        styles.remove(id);
        owned.delete(id);
      }
    for (const theme of active) {
      const id = `theme-${theme.id}`;
      // Reattach if Discord rebuilt <head> or removed our style node.
      styles.inject(id, customizedThemeCss(theme));
      owned.add(id);
    }
    if (active.length) {
      styles.inject(
        "theme-profile-surfaces",
        `:root{--vestra-profile-activity-bg:var(--background-surface-high,var(--background-floating));--vestra-profile-activity-border:var(--border-subtle,#ffffff14)}:is(.custom-user-profile-theme,[class*="userPopout_"],[class*="userProfile_"]) :is([class*="biteSize_"],[class*="activityBiteSizePopout_"],[class*="activityCard_"],[class*="activity_"]){--background-surface-high:var(--vestra-profile-activity-bg)!important;--background-base-low:var(--vestra-profile-activity-bg)!important;background-color:var(--vestra-profile-activity-bg)!important;border-color:var(--vestra-profile-activity-border)!important;}`,
      );
      owned.add("theme-profile-surfaces");
    }
    if (doc) {
      const quick = doc.querySelector('[data-vestra-style="quickcss"]');
      if (quick && quick.parentNode && quick !== quick.parentNode.lastChild)
        quick.parentNode.appendChild(quick);
      for (const theme of active) {
        const el = doc.querySelector(`[data-vestra-style="theme-${theme.id}"]`);
        if (quick && el && quick.parentNode && el.nextSibling !== quick)
          quick.parentNode.insertBefore(el, quick);
        else if (!quick && el?.parentNode && el !== el.parentNode.lastChild)
          el.parentNode.appendChild(el);
      }
    }
  };
  sync();
  const unsubscribe = store.subscribe(sync);
  let active = true;
  let scheduled = false;
  let headObserver: MutationObserver | undefined;
  let rootObserver: MutationObserver | undefined;
  const Observer =
    doc?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (doc && typeof Observer !== "undefined") {
    const schedule = (): void => {
      if (scheduled || !active) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (active) sync();
      });
    };
    const observeHead = (): void => {
      headObserver?.disconnect();
      if (doc.head) {
        headObserver = new Observer(schedule);
        headObserver.observe(doc.head, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
      schedule();
    };
    observeHead();
    rootObserver = new Observer(observeHead);
    rootObserver.observe(doc.documentElement, { childList: true });
  }
  return () => {
    active = false;
    headObserver?.disconnect();
    rootObserver?.disconnect();
    unsubscribe();
    for (const id of owned) styles.remove(id);
    owned.clear();
  };
}
