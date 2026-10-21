import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/manager/package.json"));
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-manager-"));
try {
  const define = {
    __VESTRA_MANAGER_DEV__: "false",
    "process.env.NODE_ENV": '"production"',
  };
  await Promise.all([
    build({
      entryPoints: [path.join(root, "apps/manager/src/main/updates.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["electron", "original-fs"],
      define,
      outfile: path.join(fixture, "manager/main/updates.mjs"),
    }),
    build({
      entryPoints: [path.join(root, "apps/manager/src/main/window.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["electron"],
      define,
      outfile: path.join(fixture, "manager/main/window.mjs"),
    }),
    build({
      entryPoints: [path.join(root, "apps/manager/src/preload/index.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      define,
      outfile: path.join(fixture, "manager/preload/index.cjs"),
    }),
    build({
      entryPoints: [path.join(root, "apps/manager/src/renderer/main.tsx")],
      bundle: true,
      platform: "browser",
      format: "iife",
      minify: true,
      define,
      outfile: path.join(fixture, "manager/renderer/renderer.js"),
    }),
  ]);
  await fs.copyFile(
    path.join(root, "apps/manager/src/renderer/index.html"),
    path.join(fixture, "manager/renderer/index.html"),
  );
  await fs.copyFile(
    path.join(root, "apps/manager/src/renderer/styles/manager.css"),
    path.join(fixture, "manager/renderer/manager.css"),
  );
  await fs.copyFile(
    path.join(root, "scripts/manager-smoke.cjs"),
    path.join(fixture, "main.cjs"),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [path.join(fixture, "main.cjs")], {
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) throw new Error(`Manager smoke failed: ${code}`);
} finally {
  const resolved = path.resolve(fixture);
  if (
    resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
    path.basename(resolved).startsWith("vestra-manager-")
  )
    await fs.rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
}
