import { contextBridge, ipcRenderer } from "electron";
import { MANAGER_IPC } from "../shared/channels.js";
import type { UpdateState } from "../shared/updates.js";
import type {
  CheckSummary,
  DiscordInstallation,
  InstallerProgressEvent,
  OperationSummary,
  StatusSummary,
  MaintenanceStatus,
} from "../shared/types.js";
import type {
  DiscordChannel,
  ManagerWindowAction,
  ManagerWindowState,
  ManagerWindowMaterial,
} from "../shared/channels.js";

declare const __VESTRA_MANAGER_DEV__: boolean;

export interface VestraManagerApi {
  updateState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  onUpdate(listener: (state: UpdateState) => void): () => void;
  windowAction(action: ManagerWindowAction): void;
  setWindowMaterial(material: ManagerWindowMaterial): void;
  onWindowState(listener: (state: ManagerWindowState) => void): () => void;
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
  updateState: () => ipcRenderer.invoke(MANAGER_IPC.updateGet),
  checkUpdate: () => ipcRenderer.invoke(MANAGER_IPC.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(MANAGER_IPC.updateDownload),
  installUpdate: () => ipcRenderer.invoke(MANAGER_IPC.updateInstall),
  onUpdate: (listener) => {
    const wrapped = (_event: unknown, state: UpdateState): void =>
      listener(state);
    ipcRenderer.on(MANAGER_IPC.updateState, wrapped);
    return () => ipcRenderer.removeListener(MANAGER_IPC.updateState, wrapped);
  },
  windowAction: (action) => ipcRenderer.send(MANAGER_IPC.windowAction, action),
  setWindowMaterial: (material) =>
    ipcRenderer.send(MANAGER_IPC.windowMaterial, material),
  onWindowState: (listener) => {
    const wrapped = (_event: unknown, state: ManagerWindowState): void =>
      listener(state);
    ipcRenderer.on(MANAGER_IPC.windowState, wrapped);
    ipcRenderer.send(MANAGER_IPC.windowAction, "sync");
    return () => ipcRenderer.removeListener(MANAGER_IPC.windowState, wrapped);
  },
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
