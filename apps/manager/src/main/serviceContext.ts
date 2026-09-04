// Vestra Manager (main) — build the InstallerServiceContext.
// Production: resolveHome() (%AppData%/Vestra) + bundled core payload.
// Development: same home resolution; bundle resolves to the repo's
// packages/core/dist/vestra.js so dev payloads track the working tree.
// An explicit VESTRA_BUNDLE override exists for local development only.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHome } from "@vestra/installer";
import type { InstallerServiceContext } from "@vestra/installer";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function defaultBundlePath(): string {
  const override = process.env["VESTRA_BUNDLE"];
  if (override !== undefined && override !== "") return override;
  // dist/main/index.js -> apps/manager/dist/main/index.js, so the repo root
  // is three levels up. In dev this tracks packages/core/dist/vestra.js.
  // Packaged builds (future VestraSetup.exe) ship the payload next to
  // resources and should set VESTRA_BUNDLE or extend this lookup.
  return path.join(HERE, "..", "..", "..", "packages", "core", "dist", "vestra.js");
}

export function createServiceContext(): InstallerServiceContext {
  return {
    homeDir: resolveHome(),
    bundlePath: defaultBundlePath(),
  };
}
