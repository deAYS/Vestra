// @vestra/core — renderer runtime entry.
// Phase 1: Core Bootstrap. `Vestra.start()` must execute a renderer bundle successfully.
// Phase 2 wired PluginManager, Phase 3 Settings, Phase 4 Styles + QuickCSS,
// Phase 5 the mountable Settings UI, Phase 6 the Webpack finder, Phase 7 the
// Patcher, Phase 8 Discord facades, Phase 9 the Native bridge, then toasts,
// the keybind overlay and the loading splash. The public `Vestra` shape grows
// additively (Logger, Plugins, Settings, Styles, UI, Webpack, Patcher,
// Discord, Native, Toasts) without breaking callers.

import { VESTRA_BRANDING, VESTRA_COLORS, VESTRA_VERSION } from "@vestra/shared";
import { Logger } from "./api/logger.js";
import { Settings, type SettingsStore } from "./api/settings.js";
import { Styles, type StylesManager } from "./api/styles.js";
import { startQuickCss } from "./quickCss.js";
import { pluginManager, type PluginManager } from "./pluginManager.js";
import { mountVestraSettings, unmountVestraSettings } from "./ui/mount.js";
import type { VestraUIDeps } from "./ui/types.js";
import { Webpack, type WebpackFinder } from "./webpack/index.js";
import { patcher, type Patcher } from "./api/patcher.js";
import { Discord, type DiscordAPI } from "./discord/index.js";
import { Native, NativeBridge } from "./api/native.js";
import { Toasts, type ToastManager } from "./api/toasts.js";
import { mountOverlay, overlayController, startOverlayShortcuts } from "./ui/Overlay.js";

export interface VestraUI {
  mountSettings(container: Element, deps?: VestraUIDeps): () => void;
  unmountSettings(container: Element): void;
  openSettings(): void;
  closeSettings(): void;
  toggleSettings(): void;
}

export interface VestraRuntime {
  readonly version: string;
  readonly started: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly Logger: typeof Logger;
  readonly Plugins: PluginManager;
  readonly Settings: SettingsStore;
  readonly Styles: StylesManager;
  readonly UI: VestraUI;
  readonly Webpack: WebpackFinder;
  readonly Patcher: Patcher;
  readonly Discord: DiscordAPI;
  readonly Native: NativeBridge;
  readonly Toasts: ToastManager;
}

let started = false;
let exposedGlobal = false;
let stopQuickCss: (() => void) | undefined;
let stopOverlay: (() => void) | undefined;
let stopShortcuts: (() => void) | undefined;

function printBanner(): void {
  // Branded console line — verified in 0.0.1 DoD ("branding appears in console").
  const style = `color:${VESTRA_COLORS.text};background:${VESTRA_COLORS.primary};padding:2px 6px;border-radius:4px`;
  console.log(
    `%c${VESTRA_BRANDING.name}%c v${VESTRA_VERSION} — ${VESTRA_BRANDING.tagline}`,
    style,
    `color:${VESTRA_COLORS.mutedText}`,
  );
}

function exposeGlobal(runtime: VestraRuntime): void {
  try {
    const g = globalThis as Record<string, unknown>;
    if (g[VESTRA_BRANDING.globalObject] === undefined) {
      g[VESTRA_BRANDING.globalObject] = runtime;
      exposedGlobal = true;
    }
  } catch (err: unknown) {
    Logger.captureError(err, "exposeGlobal");
  }
}

function revokeGlobal(): void {
  if (!exposedGlobal) return;
  try {
    const g = globalThis as Record<string, unknown>;
    if (g[VESTRA_BRANDING.globalObject] === runtime) {
      delete g[VESTRA_BRANDING.globalObject];
    }
  } catch (err: unknown) {
    Logger.captureError(err, "revokeGlobal");
  } finally {
    exposedGlobal = false;
  }
}

export async function start(): Promise<void> {
  if (started) {
    Logger.warn("Vestra.start() called while already started — ignoring.");
    return;
  }
  try {
    printBanner();
    Logger.info("Starting Vestra runtime…");
    // Phase 3: load centralized settings before booting plugins so persisted
    // enabled flags (and per-plugin settings) apply. Never blocks on corrupt
    // data — Settings.load() resets/salvages with logs.
    try {
      Settings.load();
    } catch (err: unknown) {
      Logger.captureError(err, "Vestra.start.Settings.load");
    }
    // Boot persisted plugins registered before start().
    for (const p of pluginManager.list()) {
      if (p.enabled) await pluginManager.enable(p.definition.name);
    }
    // Phase 4: sync QuickCSS with Settings until stop(). Replaces any previous
    // subscription (defensive; start() is idempotent-guarded above).
    try {
      stopQuickCss?.();
      stopQuickCss = startQuickCss();
    } catch (err: unknown) {
      Logger.captureError(err, "Vestra.start.QuickCSS");
    }
    // Overlay host (toasts + keybind settings panel). Mounts into its own
    // root div; safe no-ops without a DOM.
    try {
      stopOverlay?.();
      stopShortcuts?.();
      stopOverlay = mountOverlay({ settings: Settings, plugins: pluginManager, version: VESTRA_VERSION });
      stopShortcuts = startOverlayShortcuts({ settings: Settings });
    } catch (err: unknown) {
      Logger.captureError(err, "Vestra.start.Overlay");
    }
    exposeGlobal(runtime);
    started = true;
    Logger.info("Vestra runtime started.");
    try {
      const enabled = pluginManager.list().filter((p) => p.enabled).length;
      Toasts.success(
        `${VESTRA_BRANDING.name} loaded`,
        `v${VESTRA_VERSION} — ${enabled} plugin${enabled === 1 ? "" : "s"} enabled.`,
        8000,
      );
    } catch (err: unknown) {
      Logger.captureError(err, "Vestra.start.Toast");
    }
  } catch (err: unknown) {
    Logger.captureError(err, "Vestra.start");
    revokeGlobal();
    throw err;
  }
}

export async function stop(): Promise<void> {
  if (!started) return;
  try {
    Logger.info("Stopping Vestra runtime…");
    // Suspend running plugins; enabled flags persist for next start().
    await pluginManager.shutdown();
    // Phase 4: unsubscribe QuickCSS and remove its element. Plugin-owned
    // styles are their owners' responsibility (removed in their stop()).
    try {
      stopQuickCss?.();
    } catch (err: unknown) {
      Logger.captureError(err, "Vestra.stop.QuickCSS");
    } finally {
      stopQuickCss = undefined;
    }
    try {
      stopShortcuts?.();
    } catch (err: unknown) {
      Logger.captureError(err, "Vestra.stop.Shortcuts");
    } finally {
      stopShortcuts = undefined;
    }
    try {
      stopOverlay?.();
    } catch (err: unknown) {
      Logger.captureError(err, "Vestra.stop.Overlay");
    } finally {
      stopOverlay = undefined;
    }
    try {
      Settings.save();
    } catch (err: unknown) {
      Logger.captureError(err, "Vestra.stop.Settings.save");
    }
    revokeGlobal();
  } catch (err: unknown) {
    Logger.captureError(err, "Vestra.stop");
    throw err;
  } finally {
    started = false;
    Logger.info("Vestra runtime stopped.");
  }
}

export const UI: VestraUI = {
  mountSettings: (container, deps) => mountVestraSettings(container, deps),
  unmountSettings: (container) => {
    unmountVestraSettings(container);
  },
  openSettings: () => {
    overlayController.open();
  },
  closeSettings: () => {
    overlayController.close();
  },
  toggleSettings: () => {
    overlayController.toggle();
  },
};

export const runtime: VestraRuntime = {
  version: VESTRA_VERSION,
  get started(): boolean {
    return started;
  },
  start,
  stop,
  Logger,
  Plugins: pluginManager,
  Settings,
  Styles,
  UI,
  Webpack,
  Patcher: patcher,
  Discord,
  Native,
  Toasts,
};

export const Vestra: VestraRuntime = runtime;
export default Vestra;
