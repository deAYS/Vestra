import { definePlugin } from "../../../packages/core/src/api/plugins.js";
import { startQuickCss } from "../../../packages/core/src/quickCss.js";

let stop: (() => void) | undefined;

export const QuickCSS = definePlugin({
  name: "QuickCSS",
  description: "Apply user-defined CSS.",
  authors: ["Vestra"],
  enabledByDefault: true,
  start: () => {
    stop?.();
    stop = startQuickCss();
  },
  stop: () => {
    stop?.();
    stop = undefined;
  },
});

export default QuickCSS;
