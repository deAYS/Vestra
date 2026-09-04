// Vestra Installer — product home directory.
// Phase 11. The installed product lives here (locked decision): %AppData% on
// Windows, ~/Library/Application Support on macOS, ~/.config elsewhere.
// Payloads, manifests and the install registry live under it — never inside
// Discord's own directories (those hold only the asar patch + receipt).

import * as os from "node:os";
import * as path from "node:path";

export interface HomeOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  /** Explicit override (tests, portable mode, CLI --home). */
  homeDir?: string;
}

/** Resolve the Vestra product home. Never throws (falls back to cwd). */
export function resolveHome(options?: HomeOptions): string {
  if (options?.homeDir !== undefined && options.homeDir !== "") return options.homeDir;
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  if (platform === "win32") {
    const base = env["APPDATA"];
    if (base !== undefined && base !== "") return path.join(base, "Vestra");
  } else if (platform === "darwin") {
    const home = env["HOME"] ?? os.homedir();
    if (home !== "") return path.join(home, "Library", "Application Support", "Vestra");
  } else {
    const base = env["XDG_CONFIG_HOME"];
    if (base !== undefined && base !== "") return path.join(base, "Vestra");
    const home = env["HOME"] ?? os.homedir();
    if (home !== "") return path.join(home, ".config", "Vestra");
  }
  return path.join(process.cwd(), ".vestra-home");
}

export interface HomeLayout {
  homeDir: string;
  payloadRoot: string;
  registryPath: string;
}

export function layoutHome(homeDir: string): HomeLayout {
  return {
    homeDir,
    payloadRoot: path.join(homeDir, "payload"),
    registryPath: path.join(homeDir, "installs.json"),
  };
}
