import { Logger, type ScopedLogger } from "./api/logger.js";
import { Settings, type SettingsStore } from "./api/settings.js";
import { Styles, type StylesManager } from "./api/styles.js";

/** Styles id owned by QuickCSS. Do not inject under this id from elsewhere. */
export const QUICKCSS_STYLE_ID = "quickcss";

export interface QuickCssState {
  enabled: boolean;
  css: string;
}

export interface StartQuickCssDeps {
  settings?: SettingsStore;
  styles?: StylesManager;
  logger?: ScopedLogger;
}

/** One-shot apply of a customCss snapshot. Never throws; errors go through Logger. */
export function applyQuickCssState(state: QuickCssState, styles?: StylesManager): void {
  const target = styles ?? Styles;
  try {
    if (state.enabled && state.css.trim() !== "") {
      target.inject(QUICKCSS_STYLE_ID, state.css);
    } else {
      target.remove(QUICKCSS_STYLE_ID);
    }
  } catch (err: unknown) {
    Logger.captureError(err, "QuickCSS.apply");
  }
}

/**
 * Sync QuickCSS with Settings from now until the returned stop function runs.
 * Applies the current snapshot immediately, then re-applies on changes.
 * Stop unsubscribes and removes the element (safe to call twice).
 */
export function startQuickCss(deps?: StartQuickCssDeps): () => void {
  const settings = deps?.settings ?? Settings;
  const styles = deps?.styles ?? Styles;
  const logger = deps?.logger ?? Logger.extend("QuickCSS");

  let lastKey: string | undefined;
  const apply = (state: QuickCssState): void => {
    try {
      const key = `${state.enabled}:${state.css}`;
      if (key === lastKey) return;
      lastKey = key;
      applyQuickCssState(state, styles);
    } catch (err: unknown) {
      logger.captureError(err, "QuickCSS.apply");
    }
  };

  try {
    apply(settings.getCustomCss());
  } catch (err: unknown) {
    logger.captureError(err, "QuickCSS.start");
  }

  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = settings.subscribe((snapshot) => {
      apply(snapshot.customCss);
    });
  } catch (err: unknown) {
    logger.captureError(err, "QuickCSS.subscribe");
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      unsubscribe?.();
    } catch (err: unknown) {
      logger.captureError(err, "QuickCSS.stop.unsubscribe");
    }
    try {
      styles.remove(QUICKCSS_STYLE_ID);
    } catch (err: unknown) {
      logger.captureError(err, "QuickCSS.stop.remove");
    }
  };
}
