import * as path from "node:path";
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isManagerSender } from "./sender.js";
import type { DiscordChannel } from "@vestra/injector";
import { DiscordLifecycle } from "./discordLifecycle.js";
import { MaintenanceController, withInstallLock } from "./maintenance.js";
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
    if (!out.includes(entry as DiscordChannel))
      out.push(entry as DiscordChannel);
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

export function registerManagerIpc(
  service: InstallerService,
  lifecycle: DiscordLifecycle,
  maintenance: MaintenanceController,
): void {
  const rendererUrl = pathToFileURL(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "renderer",
      "index.html",
    ),
  ).href;
  const handle = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, raw: unknown) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, raw: unknown) => {
      if (!isManagerSender(event, rendererUrl))
        throw new Error("Untrusted Manager IPC sender.");
      return listener(event, raw);
    });
  };
  const forwardProgress =
    (sender: WebContents) =>
    (event: InstallerProgressEvent): void => {
      if (!sender.isDestroyed()) sender.send(MANAGER_IPC.progress, event);
    };

  handle(MANAGER_IPC.discover, () => service.discover());

  handle(MANAGER_IPC.status, (event, raw: unknown) =>
    service.status({
      ...argsOf(raw),
      onProgress: forwardProgress(event.sender),
    }),
  );

  handle(MANAGER_IPC.check, (event, raw: unknown) =>
    service.check({
      ...argsOf(raw),
      onProgress: forwardProgress(event.sender),
    }),
  );

  const mutate = (
    kind: "install" | "repair" | "uninstall",
    event: IpcMainInvokeEvent,
    raw: unknown,
  ) => {
    const channel = singleChannel(raw)[0]!;
    return withInstallLock(service.context.homeDir, async () => {
      const result = await lifecycle.run(
        kind,
        channel,
        forwardProgress(event.sender),
      );
      if (result.ok) await maintenance.track(channel, kind !== "uninstall");
      return result;
    });
  };
  handle(MANAGER_IPC.install, (event, raw) => mutate("install", event, raw));
  handle(MANAGER_IPC.repair, (event, raw) => mutate("repair", event, raw));
  handle(MANAGER_IPC.uninstall, (event, raw) =>
    mutate("uninstall", event, raw),
  );
  handle(MANAGER_IPC.maintenanceStatus, () => maintenance.status());
  handle(MANAGER_IPC.maintenanceSet, (_event, raw) => {
    if (typeof raw !== "boolean")
      throw new TypeError("Recovery enabled must be a boolean.");
    return withInstallLock(service.context.homeDir, () =>
      maintenance.setEnabled(raw),
    );
  });
}
