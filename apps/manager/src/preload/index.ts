// Vestra Manager — preload bridge (contextBridge only).
// Narrow API: six installer methods + progress subscribe + dev-mode flag.
// No fs, path, child_process, raw Node APIs, or arbitrary invoke.

import { contextBridge, ipcRenderer } from "electron";
import { MANAGER_IPC } from "../shared/channels.js";
import type {
  CheckSummary,
  DiscordInstallation,
  InstallerProgressEvent,
  OperationSummary,
  StatusSummary,
} from "../shared/types.js";
import type { DiscordChannel } from "../shared/channels.js";

declare const __VESTRA_MANAGER_DEV__: boolean;

export interface VestraManagerApi {
  discover(): Promise<DiscordInstallation[]>;
  status(args?: { channels?: DiscordChannel[] }): Promise<StatusSummary>;
  check(args?: { channels?: DiscordChannel[] }): Promise<CheckSummary>;
  install(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  repair(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  uninstall(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  onProgress(listener: (event: InstallerProgressEvent) => void): () => void;
  isDevelopmentBuild(): boolean;
}

const api: VestraManagerApi = {
  discover: () => ipcRenderer.invoke(MANAGER_IPC.discover),
  status: (args) => ipcRenderer.invoke(MANAGER_IPC.status, args ?? {}),
  check: (args) => ipcRenderer.invoke(MANAGER_IPC.check, args ?? {}),
  install: (args) => ipcRenderer.invoke(MANAGER_IPC.install, args),
  repair: (args) => ipcRenderer.invoke(MANAGER_IPC.repair, args),
  uninstall: (args) => ipcRenderer.invoke(MANAGER_IPC.uninstall, args),
  onProgress: (listener) => {
    const wrapped = (_event: unknown, event: InstallerProgressEvent): void => {
      listener(event);
    };
    ipcRenderer.on(MANAGER_IPC.progress, wrapped);
    return () => {
      ipcRenderer.removeListener(MANAGER_IPC.progress, wrapped);
    };
  },
  isDevelopmentBuild: () =>
    typeof __VESTRA_MANAGER_DEV__ !== "undefined" ? __VESTRA_MANAGER_DEV__ : false,
};

contextBridge.exposeInMainWorld("vestraManager", api);
