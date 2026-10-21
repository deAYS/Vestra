# @vestra/api

Vestra's own typed plugin API. Package version `0.1.1`, host API `1.0.0`.
Requires Vestra; this package does not inject Discord or create a second runtime.

```ts
import { definePlugin, Styles, Toasts } from "@vestra/api";

export default definePlugin({
  name: "MyThemeHelper",
  description: "A small Vestra plugin.",
  authors: ["Your name"],
  start() {
    Styles.inject("MyThemeHelper", "a { text-underline-offset: 3px; }");
    Toasts.success("MyThemeHelper", "Plugin started");
  },
  stop() {
    Styles.remove("MyThemeHelper");
  },
});
```

The SDK is not published on npm yet. Build it and an example from this checkout:

```sh
bun run --cwd packages/api build
node packages/api/scripts/build-plugin.mjs plugins/example/src/index.ts plugins/example/dist/index.js
```

The packaged SDK also exposes `vestra-plugin src/index.ts dist/index.js`. The generated IIFE registers
the default export against the existing host. New store plugins are disabled
until the user enables their store entry. Renderer toggles persist independently.

For a local installation, build directly to a `.plugin.js` file:

```sh
node packages/api/scripts/build-plugin.mjs plugins/example/src/index.ts dist/Example.plugin.js
```

Open **Vestra → Plugins → Open plugin folder**, copy the built file there and fully
restart Discord. Local builds use their saved enabled state or `enabledByDefault`;
the builder defaults it to `true`. Only install plugin files whose source you trust.

## Settings

Declare `settingsSchema` to get a Configure panel. Supported field types are
`boolean`, `number`, `select`, `text` and `keybind`. Every plugin also gets an
optional enable/disable shortcut. Defaults are displayed without overwriting
saved values; `Settings.subscribe()` lets running plugins react to changes.

```ts
import { definePlugin, Settings } from "@vestra/api";

export default definePlugin({
  name: "MyPlugin",
  description: "A plugin with preferences.",
  authors: ["Your name"],
  settingsSchema: {
    intensity: {
      type: "number",
      label: "Intensity",
      default: 2,
      min: 1,
      max: 8,
      step: 1,
    },
  },
  start() {
    const intensity = Settings.getPluginSetting("MyPlugin", "intensity") ?? 2;
    console.log("Intensity:", intensity);
  },
});
```

Settings changes do not restart a plugin. Read them when handling an action or
subscribe in `start()` and unsubscribe in `stop()`. Validate values before use;
preferences can also be edited outside the panel. Keybind fields store a combo
string; the plugin implements its action. The host handles the common plugin
toggle shortcut. `Settings.activateTheme(id)` selects a single theme; `null`
returns to Discord's appearance.

Use the exact plugin name as the patch owner. Stop must undo every timer, event
listener, style and subscription created by start. The host removes owned patches
on stop or failure; it cannot infer arbitrary resources created by plugin code.

Exports: `definePlugin`, `registerPlugin`, `getVestra`, `Settings`, `Styles`,
`Patcher`, `Plugins`, `Webpack`, `Discord`, `Native`, `Toasts`, `Logger`, `UI`, and types.
Discovery methods can return `undefined` when Discord changes. Handle missing
modules and never assume Vencord or BetterDiscord APIs are available.

All third-party code runs with Discord renderer access. Install trusted source.
The npm scope must be owned by the maintainer before publishing. Nothing in the
build commands publishes automatically.

Theme appearance is available on Vestra 0.1.0-alpha.2 and newer through
`Settings.setThemeCustomization(id, appearance)`. Pass `undefined` to restore the
authored theme. `ThemeCustomization` contains `opacity` (0–100), `blur` (0–48),
`saturation` (0–200), `brightness` (0–120), `radius` (0–30), `backgroundColor`
(empty or hex), and `backgroundImage` (empty, an HTTPS image URL, or a supported
base64 image). These preferences belong to each theme and are preserved when its
local CSS file refreshes. Older hosts do not expose this additive method.

Newer hosts also accept optional `homeOpacity` (0–100), `popupOpacity` (0–100),
`settingsOpacity` (0–100), `textColor` (empty or hex), `glowColor` (hex),
`glowStrength` (0–100) and `glowSize` (1–18). Missing values use readable defaults:
55%, 94%, 96%, the authored text color and no glow. Check host support before
depending on these controls in plugins built for older Vestra releases.
Set `surfaceOverrides: false` for typography-only changes that preserve the theme's
authored surfaces. It defaults to `true` for compatibility with existing appearance
preferences. New UI edits enable surface overrides when a surface control changes.
