// Vestra Manager — esbuild pipeline.
// main:    platform=node, ESM, external electron + workspace libs (resolved at runtime).
// preload: platform=node, CJS, external electron (preload must be CJS).
// renderer: platform=browser, IIFE, React bundled.
// __VESTRA_MANAGER_DEV__ is baked per --dev flag (or VESTRA_MANAGER_DEV=1).
// Output: apps/manager/dist/{main,preload,renderer}/ + index.html + css.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const dist = path.join(root, "dist");

const dev =
  process.argv.includes("--dev") || process.env["VESTRA_MANAGER_DEV"] === "1";

const define = { __VESTRA_MANAGER_DEV__: dev ? "true" : "false" };

await fs.promises.rm(dist, { recursive: true, force: true });
await fs.promises.mkdir(path.join(dist, "main"), { recursive: true });
await fs.promises.mkdir(path.join(dist, "preload"), { recursive: true });
await fs.promises.mkdir(path.join(dist, "renderer"), { recursive: true });

// NOTE: only "electron" is external. @vestra/* are TypeScript sources —
// Electron's Node runtime cannot load .ts, so they must be bundled in.
// `original-fs` is provided by Electron at runtime and must stay external:
// bundling it would break the unpatched-filesystem bypass.
await build({
  entryPoints: [path.join(root, "src", "main", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  define,
  external: ["electron", "original-fs"],
  outfile: path.join(dist, "main", "index.js"),
  logLevel: "info",
});

// NOTE: .cjs extension is load-bearing. apps/manager/package.json declares
// "type": "module", so a CJS bundle emitted as .js is parsed as ESM and
// crashes before contextBridge runs (verified: "module is not defined in ES
// module scope"). .cjs is unambiguous CJS under any package type.
await build({
  entryPoints: [path.join(root, "src", "preload", "index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  define,
  external: ["electron"],
  outfile: path.join(dist, "preload", "index.cjs"),
  logLevel: "info",
});

await build({
  entryPoints: [path.join(root, "src", "renderer", "main.tsx")],
  bundle: true,
  platform: "browser",
  format: "iife",
  define,
  loader: { ".js": "jsx" },
  outfile: path.join(dist, "renderer", "renderer.js"),
  logLevel: "info",
});

await fs.promises.copyFile(
  path.join(root, "src", "renderer", "index.html"),
  path.join(dist, "renderer", "index.html"),
);
await fs.promises.copyFile(
  path.join(root, "src", "renderer", "styles", "manager.css"),
  path.join(dist, "renderer", "manager.css"),
);

console.log(`Vestra Manager build complete (dev=${dev ? "true" : "false"}).`);
