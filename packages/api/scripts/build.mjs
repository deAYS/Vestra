import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
for (const [format, extension] of [["esm", "js"], ["cjs", "cjs"]]) {
  await build({ entryPoints: [path.join(root, "src/index.ts")], bundle: true, platform: "browser", format, outfile: path.join(root, `dist/index.${extension}`), logLevel: "info" });
}
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", path.join(root, "tsconfig.json")], { stdio: "inherit" });
await fs.copyFile(path.join(root, "../../LICENSE"), path.join(root, "LICENSE"));
