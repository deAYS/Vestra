import { contextBridge, ipcRenderer } from "electron";
import { MANAGER_IPC } from "../shared/channels.js";
import type {
  CheckSummary,
  DiscordInstallation,
  InstallerProgressEvent,
  OperationSummary,
  StatusSummary,
  MaintenanceStatus,
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
  maintenanceStatus(): Promise<MaintenanceStatus>;
  setMaintenance(enabled: boolean): Promise<MaintenanceStatus>;
}

const api: VestraManagerApi = {
  discover: () => ipcRenderer.invoke(MANAGER_IPC.discover),
  status: (args) => ipcRenderer.invoke(MANAGER_IPC.status, args ?? {}),
  check: (args) => ipcRenderer.invoke(MANAGER_IPC.check, args ?? {}),
  install: (args) => ipcRenderer.invoke(MANAGER_IPC.install, args),
  repair: (args) => ipcRenderer.invoke(MANAGER_IPC.repair, args),
  uninstall: (args) => ipcRenderer.invoke(MANAGER_IPC.uninstall, args),
  maintenanceStatus: () => ipcRenderer.invoke(MANAGER_IPC.maintenanceStatus),
  setMaintenance: (enabled) =>
    ipcRenderer.invoke(MANAGER_IPC.maintenanceSet, enabled),
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
    typeof __VESTRA_MANAGER_DEV__ !== "undefined"
      ? __VESTRA_MANAGER_DEV__
      : false,
};

// TEMPORARY dev-only diagnostics (validation phase): trace preload boot.
// Production remains quiet. No extra APIs exposed.
if (typeof __VESTRA_MANAGER_DEV__ !== "undefined" && __VESTRA_MANAGER_DEV__) {
  console.log("[Vestra Manager] preload loaded");
}

try {
  contextBridge.exposeInMainWorld("vestraManager", api);
} catch (err: unknown) {
  if (typeof __VESTRA_MANAGER_DEV__ !== "undefined" && __VESTRA_MANAGER_DEV__) {
    console.error(
      `[Vestra Manager] preload expose failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  throw err;
}
