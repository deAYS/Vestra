import { definePlugin } from "./api/plugins.js";
import { Styles } from "./api/styles.js";
import { QuickCSS } from "../../../plugins/quick-css/src/index.js";
import { UTILITY_PLUGINS } from "./plugins/utilities.js";

export const ReducedMotion = definePlugin({
  name: "ReducedMotion",
  description: "Calm the interface by reducing animations, transitions and smooth scrolling.",
  authors: ["Vestra"],
  start() { Styles.inject("plugin-reduced-motion", `*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}`); },
  stop() { Styles.remove("plugin-reduced-motion"); },
});

export const MessageReadability = definePlugin({
  name: "MessageReadability",
  description: "Give message text more breathing room with a comfortable line height and clearer spacing.",
  authors: ["Vestra"],
  start() { Styles.inject("plugin-message-readability", `[id^="message-content-"]{line-height:1.65!important;letter-spacing:.01em}[id^="message-content-"] pre{line-height:1.5!important}`); },
  stop() { Styles.remove("plugin-message-readability"); },
});

export const BUILTIN_PLUGINS = [QuickCSS, ReducedMotion, MessageReadability, ...UTILITY_PLUGINS];
