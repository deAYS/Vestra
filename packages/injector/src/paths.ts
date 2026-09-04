// @vestra/injector — Discord install discovery.
// Phase 10. Pure path logic over an injectable environment so tests run
// without Discord installed. Never throws: unreadable roots yield no results.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getRealFs } from "./realFs.js";

export type DiscordChannel = "stable" | "ptb" | "canary";

export interface DiscordInstall {
  channel: DiscordChannel;
  /** e.g. `%LOCALAPPDATA%/Discord` (or the .app bundle on macOS). */
  rootDir: string;
  /** Versioned app dir, e.g. `app-1.0.9011`. */
  appDir: string;
  resourcesDir: string;
  asarPath: string;
  version: string;
}

export interface DiscoveryOptions {
  /** Override `process.platform` (tests). */
  platform?: string;
  /** Override env lookup (tests). Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Extra roots to scan as channel dirs (tests, portable installs). */
  extraRoots?: Array<{ channel: DiscordChannel; rootDir: string }>;
}

const CHANNEL_DIRS: Record<DiscordChannel, { win: string; mac: string; linux: string[] }> = {
  stable: {
    win: "Discord",
    mac: "Discord.app",
    linux: ["discord", "Discord"],
  },
  ptb: {
    win: "DiscordPTB",
    mac: "Discord PTB.app",
    linux: ["discord-ptb", "DiscordPTB"],
  },
  canary: {
    win: "DiscordCanary",
    mac: "Discord Canary.app",
    linux: ["discord-canary", "DiscordCanary"],
  },
};

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  // Physical Discord `app.asar` probe: must use the unpatched filesystem.
  // Under Electron's main process, patched `node:fs` misreports
  // `statSync(.../app.asar).isFile() === false`.
  try {
    return getRealFs().statSync(p).isFile();
  } catch {
    return false;
  }
}

function candidateRoots(platform: string, env: Record<string, string | undefined>): string[] {
  if (platform === "win32") {
    const base = env["LOCALAPPDATA"] ?? env["APPDATA"];
    return base === undefined || base === "" ? [] : [base];
  }
  if (platform === "darwin") return ["/Applications"];
  // linux and everything else: user config + classic system locations.
  const home = env["HOME"] ?? os.homedir();
  const roots = ["/usr/share", "/opt"];
  if (home !== "") roots.unshift(path.join(home, ".config"));
  return roots;
}

function pickVersionedAppDir(resourcesParent: string): { appDir: string; version: string } | undefined {
  // Layout: <root>/app-<version>/resources — find the highest app-* dir.
  let entries: string[];
  try {
    entries = fs.readdirSync(resourcesParent);
  } catch {
    return undefined;
  }
  const versions = entries
    .filter((e) => e.startsWith("app-") && isDirectory(path.join(resourcesParent, e)))
    .map((e) => e.slice(4))
    .filter((v) => v !== "");
  if (versions.length === 0) return undefined;
  versions.sort(compareVersions);
  const version = versions[versions.length - 1] as string;
  return { appDir: path.join(resourcesParent, `app-${version}`), version };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (Number.isNaN(na) || Number.isNaN(nb)) return a < b ? -1 : 1;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function fromRoot(channel: DiscordChannel, rootDir: string): DiscordInstall | undefined {
  // Versioned layout first (Windows/Squirrel: <root>/app-<version>/resources).
  const found = pickVersionedAppDir(rootDir);
  if (found !== undefined) {
    const resourcesDir = path.join(found.appDir, "resources");
    const asarPath = path.join(resourcesDir, "app.asar");
    if (isFile(asarPath)) {
      return { channel, rootDir, appDir: found.appDir, resourcesDir, asarPath, version: found.version };
    }
  }
  // Unversioned layout (Linux tarballs/debs: <root>/resources/app.asar).
  const resourcesDir = path.join(rootDir, "resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  if (isFile(asarPath)) {
    return { channel, rootDir, appDir: rootDir, resourcesDir, asarPath, version: "0.0.0" };
  }
  return undefined;
}

function fromMacBundle(channel: DiscordChannel, bundleDir: string): DiscordInstall | undefined {
  const resourcesDir = path.join(bundleDir, "Contents", "Resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  if (!isFile(asarPath)) return undefined;
  return { channel, rootDir: bundleDir, appDir: bundleDir, resourcesDir, asarPath, version: "0.0.0" };
}

/** Locate installed Discord clients. Empty array when none are found. */
export function listInstalls(options?: DiscoveryOptions): DiscordInstall[] {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  const out: DiscordInstall[] = [];
  const seen = new Set<string>();

  const push = (install: DiscordInstall | undefined): void => {
    if (install === undefined || seen.has(install.asarPath)) return;
    seen.add(install.asarPath);
    out.push(install);
  };

  for (const { channel, rootDir } of options?.extraRoots ?? []) {
    push(fromRoot(channel, rootDir));
  }

  const channels: DiscordChannel[] = ["stable", "ptb", "canary"];
  if (platform === "darwin") {
    for (const base of candidateRoots(platform, env)) {
      for (const channel of channels) {
        push(fromMacBundle(channel, path.join(base, CHANNEL_DIRS[channel].mac)));
      }
    }
    return out;
  }

  for (const base of candidateRoots(platform, env)) {
    for (const channel of channels) {
      if (platform === "win32") {
        push(fromRoot(channel, path.join(base, CHANNEL_DIRS[channel].win)));
      } else {
        for (const dir of CHANNEL_DIRS[channel].linux) {
          push(fromRoot(channel, path.join(base, dir)));
        }
      }
    }
  }
  return out;
}
