// Vestra Manager (main) — narrow IPC bridge over the InstallerService.
// The ONLY gateway from the renderer to installation logic. Six methods,
// structured args, no arbitrary invoke, no fs/path/child_process exposure.
// Uninstall always runs with purge=false (enforced here even if the
// renderer passed anything else).

import { ipcMain, type WebContents } from "electron";
import type { DiscordChannel } from "@vestra/injector";
import type { InstallerService } from "@vestra/installer";
import { MANAGER_IPC } from "../shared/channels.js";
import type { InstallerProgressEvent } from "../shared/types.js";

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

  ipcMain.handle(MANAGER_IPC.discover, () => service.discover());

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
