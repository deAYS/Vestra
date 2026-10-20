# @vestra/api

Vestra's own typed plugin API. Package version `0.1.0`, host API `1.0.0`.
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
  stop() { Styles.remove("MyThemeHelper"); },
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
