import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const notices = await fs.readFile(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  "utf8",
);
await build({
  absWorkingDir: root,
  entryPoints: ["packages/core/src/index.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "Vestra",
  outfile: "packages/core/dist/vestra.js",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: `/*!\n${notices.replace(/\*\//g, "* /")}\n*/` },
  minify: true,
  logLevel: "info",
});
