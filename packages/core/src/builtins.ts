import { definePlugin } from "./api/plugins.js";
import { Styles } from "./api/styles.js";
import { QuickCSS } from "../../../plugins/quick-css/src/index.js";
import { UTILITY_PLUGINS } from "./plugins/utilities.js";
import { numberOption } from "./plugins/options.js";
import { Settings } from "./api/settings.js";

export const ReducedMotion = definePlugin({
  name: "ReducedMotion",
  description:
    "Calm the interface by reducing animations, transitions and smooth scrolling.",
  authors: ["Vestra"],
  start() {
    Styles.inject(
      "plugin-reduced-motion",
      `*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}`,
    );
  },
  stop() {
    Styles.remove("plugin-reduced-motion");
  },
});

let stopReadability: (() => void) | undefined;
export const MessageReadability = definePlugin({
  name: "MessageReadability",
  description:
    "Give message text more breathing room with a comfortable line height and clearer spacing.",
  authors: ["Vestra"],
  settingsSchema: {
    lineHeight: {
      type: "number",
      label: "Message line height",
      default: 1.65,
      min: 1.2,
      max: 2.2,
      step: 0.05,
    },
    letterSpacing: {
      type: "number",
      label: "Letter spacing",
      description: "Spacing in em units.",
      default: 0.01,
      min: 0,
      max: 0.08,
      step: 0.01,
    },
  },
  start() {
    stopReadability?.();
    const update = (): void => {
      const css = `[id^="message-content-"]{line-height:${numberOption("MessageReadability", "lineHeight", 1.65, 1.2, 2.2)}!important;letter-spacing:${numberOption("MessageReadability", "letterSpacing", 0.01, 0, 0.08)}em}[id^="message-content-"] pre{line-height:1.5!important}`;
      if (Styles.get("plugin-message-readability") !== css)
        Styles.inject("plugin-message-readability", css);
    };
    update();
    stopReadability = Settings.subscribe(update);
  },
  stop() {
    stopReadability?.();
    stopReadability = undefined;
    Styles.remove("plugin-message-readability");
  },
});

export const BUILTIN_PLUGINS = [
  QuickCSS,
  ReducedMotion,
  MessageReadability,
  ...UTILITY_PLUGINS,
];
