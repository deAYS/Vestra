import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({ absWorkingDir: root, entryPoints: ["packages/core/src/index.ts"], bundle: true, platform: "browser", format: "iife", globalName: "Vestra", outfile: "packages/core/dist/vestra.js", define: { "process.env.NODE_ENV": '"production"' }, minify: true, logLevel: "info" });
