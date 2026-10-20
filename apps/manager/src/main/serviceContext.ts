import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { resolveHome } from "@vestra/installer";
import type { InstallerServiceContext } from "@vestra/installer";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function defaultBundlePath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "payload", "vestra.js");
  const override = process.env["VESTRA_BUNDLE"];
  if (override !== undefined && override !== "") return override;
  // dist/main/index.js -> apps/manager/dist/main/index.js, so the repo root
  // is four levels up. Packaged builds carry an independent payload resource.
  return path.join(HERE, "..", "..", "..", "..", "packages", "core", "dist", "vestra.js");
}

export function createServiceContext(): InstallerServiceContext {
  return {
    homeDir: resolveHome(),
    bundlePath: defaultBundlePath(),
  };
}
