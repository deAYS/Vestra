import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/manager/package.json"));
const electron = require("electron");
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-electron-"));
try {
  const built = await build({ absWorkingDir: root, stdin: { contents: `export {buildPreloadSource} from './packages/injector/src/preload.ts';export {buildMainHookSource} from './packages/injector/src/mainHook.ts';export {buildLoaderSource} from './packages/injector/src/loader.ts';export {THEME_LIBRARY} from './packages/core/src/themes.ts';`, resolveDir: root }, bundle: true, platform: "node", format: "esm", write: false });
  const builders = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
  await build({ absWorkingDir: root, entryPoints: ["packages/core/src/index.ts"], bundle: true, platform: "browser", format: "iife", globalName: "Vestra", outfile: path.join(fixture, "vestra.js"), define: { "process.env.NODE_ENV": '"production"' }, minify: true });
  await fs.writeFile(path.join(fixture, "vestra-preload.cjs"), builders.buildPreloadSource());
  await fs.writeFile(path.join(fixture, "vestra-loader.js"), builders.buildLoaderSource());
  await fs.writeFile(path.join(fixture, "theme-fixture.json"), JSON.stringify(builders.THEME_LIBRARY));
  await fs.writeFile(path.join(fixture, "main-hook.cjs"), builders.buildMainHookSource({ preloadPath: path.join(fixture, "vestra-preload.cjs") }));
  const pluginRoot = path.join(fixture, "app-data/Vestra/plugins");
  execFileSync(process.execPath, [path.join(root, "packages/api/scripts/build.mjs")], { stdio: "inherit" });
  execFileSync(process.execPath, [path.join(root, "packages/api/scripts/build-plugin.mjs"), path.join(root, "plugins/example/src/index.ts"), path.join(pluginRoot, "ExamplePlugin/0.1.0/index.js")], { stdio: "inherit" });
  await fs.writeFile(path.join(pluginRoot, "installed.json"), JSON.stringify({ ExamplePlugin: { version: "0.1.0", enabled: true } }));
  await fs.copyFile(path.join(root, "scripts/electron-smoke.cjs"), path.join(fixture, "main.cjs"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(fixture, "main.cjs")], { env, stdio: "inherit", windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  process.exitCode = code ?? 1;
} finally {
  // This path comes directly from mkdtemp, and cleanup is restricted to it.
  const resolved = path.resolve(fixture);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("vestra-electron-")) {
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
