#!/usr/bin/env node
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
const [entry, output = "dist/index.js"] = process.argv.slice(2);
if (!entry || entry === "--help") {
  console.log("Usage: vestra-plugin <src/index.ts> [dist/index.js]");
  process.exit(entry === "--help" ? 0 : 2);
}
const sdk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
await build({
  stdin: { contents: `import plugin from ${JSON.stringify(path.resolve(entry))}; import {registerPlugin} from '@vestra/api'; void registerPlugin({...plugin,enabledByDefault:plugin.enabledByDefault ?? true}).catch(error => console.error('[Vestra plugin]',error));`, resolveDir: process.cwd() },
  bundle: true, platform: "browser", format: "iife", outfile: path.resolve(output), target: "es2022",
  plugins: [{ name: "vestra-host-api", setup(builder) { builder.onResolve({ filter: /^@vestra\/api$/ }, () => ({ path: sdk })); } }],
  logLevel: "info",
});
