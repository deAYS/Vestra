// Vestra Manager (main) — narrow IPC bridge over the InstallerService.
// The ONLY gateway from the renderer to installation logic. Six methods,
// structured args, no arbitrary invoke, no fs/path/child_process exposure.
// Uninstall always runs with purge=false (enforced here even if the
// renderer passed anything else).

import * as fs from "node:fs";
import * as path from "node:path";
import { ipcMain, type WebContents } from "electron";
import { listInstalls, getRealFs, type DiscordChannel } from "@vestra/injector";
import type { InstallerService } from "@vestra/installer";
import { MANAGER_IPC } from "../shared/channels.js";
import type { InstallerProgressEvent } from "../shared/types.js";

declare const __VESTRA_MANAGER_DEV__: boolean;

function isDevBuild(): boolean {
  return typeof __VESTRA_MANAGER_DEV__ !== "undefined" && __VESTRA_MANAGER_DEV__;
}

// TEMPORARY dev-only diagnostics (validation phase): read-only discovery
// inputs. No filesystem writes; discovery algorithm untouched.
function logDiscoveryInputs(): void {
  const platform = process.platform;
  const localAppData = process.env["LOCALAPPDATA"];
  const appData = process.env["APPDATA"];
  console.log(`[Vestra Manager] platform: ${platform}`);
  console.log(`[Vestra Manager] LOCALAPPDATA: ${localAppData ?? "<undefined>"}`);
  console.log(`[Vestra Manager] APPDATA: ${appData ?? "<undefined>"}`);
  const base = localAppData ?? appData;
  if (base === undefined || base === "") {
    console.log("[Vestra Manager] candidate roots: <no base>");
  } else {
    for (const dir of ["Discord", "DiscordCanary", "DiscordPTB"]) {
      const root = path.join(base, dir);
      console.log(`[Vestra Manager] candidate root: ${root} exists=${fs.existsSync(root)}`);
      try {
        const entries = fs.readdirSync(root);
        const appDirs = entries.filter((e) => e.startsWith("app-"));
        console.log(`[Vestra Manager] readdir ${dir}: entries=${entries.length} appDirs=[${appDirs.join(",")}]`);
        for (const appDir of appDirs) {
          const asar = path.join(root, appDir, "resources", "app.asar");
          try {
            console.log(`[Vestra Manager] stat ${dir}/${appDir}: asarIsFile=${getRealFs().statSync(asar).isFile()}`);
          } catch (err: unknown) {
            console.log(
              `[Vestra Manager] stat ${dir}/${appDir}: asarError=${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } catch (err: unknown) {
        console.log(
          `[Vestra Manager] readdir ${dir} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  try {
    const installs = listInstalls();
    for (const channel of ["stable", "ptb", "canary"] as const) {
      const found = installs.find((i) => i.channel === channel);
      console.log(
        `[Vestra Manager] channel ${channel}: found=${found !== undefined}` +
          (found ? ` version=${found.version}` : ""),
      );
    }
  } catch (err: unknown) {
    console.error(
      `[Vestra Manager] channel probe failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const CHANNELS: readonly string[] = ["stable", "ptb", "canary"];

function parseChannels(value: unknown): DiscordChannel[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("channels must be an array.");
  const out: DiscordChannel[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !CHANNELS.includes(entry)) {
      throw new TypeError(`Unknown channel "${String(entry)}".`);
    }
    if (!out.includes(entry as DiscordChannel)) out.push(entry as DiscordChannel);
  }
  return out;
}

function argsOf(raw: unknown): { channels?: DiscordChannel[] | undefined } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object") throw new TypeError("Invalid arguments.");
  const channels = (raw as { channels?: unknown }).channels;
  return { channels: parseChannels(channels) };
}

function singleChannel(raw: unknown): DiscordChannel[] {
  const { channels } = argsOf(raw);
  if (channels === undefined || channels.length !== 1) {
    throw new TypeError("Exactly one channel is required.");
  }
  return channels;
}

export function registerManagerIpc(service: InstallerService): void {
  const forwardProgress =
    (sender: WebContents) =>
    (event: InstallerProgressEvent): void => {
      sender.send(MANAGER_IPC.progress, event);
    };

  // TEMPORARY dev-only diagnostics (validation phase): trace discover
  // requests through the real InstallerService. Production remains quiet.
  if (isDevBuild()) {
    console.log("[Vestra Manager] installer IPC handlers registered");
  }

  ipcMain.handle(MANAGER_IPC.discover, async () => {
    if (isDevBuild()) {
      console.log("[Vestra Manager] discover request received");
      logDiscoveryInputs();
    }
    try {
      const result = await service.discover();
      if (isDevBuild()) {
        console.log(`[Vestra Manager] discover result count: ${result.length}`);
      }
      return result;
    } catch (err: unknown) {
      if (isDevBuild()) {
        console.error(
          `[Vestra Manager] discover failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }
  });

  ipcMain.handle(MANAGER_IPC.status, (event, raw: unknown) =>
    service.status({ ...argsOf(raw), onProgress: forwardProgress(event.sender) }),
  );

  ipcMain.handle(MANAGER_IPC.check, (event, raw: unknown) =>
    service.check({ ...argsOf(raw), onProgress: forwardProgress(event.sender) }),
  );

  ipcMain.handle(MANAGER_IPC.install, (event, raw: unknown) =>
    service.install({ channels: singleChannel(raw), onProgress: forwardProgress(event.sender) }),
  );

  ipcMain.handle(MANAGER_IPC.repair, (event, raw: unknown) =>
    service.repair({ channels: singleChannel(raw), onProgress: forwardProgress(event.sender) }),
  );

  ipcMain.handle(MANAGER_IPC.uninstall, (event, raw: unknown) =>
    service.uninstall({
      channels: singleChannel(raw),
      purge: false,
      onProgress: forwardProgress(event.sender),
    }),
  );
}
