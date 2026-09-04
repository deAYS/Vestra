// QuickCSS — apply user-defined CSS (built-in, critical).
// Phase 4. Real plugin definition: `start()` reflects the current
// `Settings.customCss` snapshot through the Styles API, `stop()` removes it
// (every injection must be removable). Live sync while running is owned by the
// core QuickCSS service (`startQuickCss`, wired in the runtime); this plugin
// stays a thin declarative wrapper so enabling/disabling it is idempotent and
// safe to register as a built-in once Phase 5 lands builtin registration.

import {
  definePlugin,
  Settings,
  Styles,
  QUICKCSS_STYLE_ID,
  applyQuickCssState,
} from "@vestra/api";

export const QuickCSS = definePlugin({
  name: "QuickCSS",
  description: "Apply user-defined CSS.",
  authors: ["Vestra"],
  enabledByDefault: true,
  start: () => {
    applyQuickCssState(Settings.getCustomCss(), Styles);
  },
  stop: () => {
    Styles.remove(QUICKCSS_STYLE_ID);
  },
});

export default QuickCSS;
