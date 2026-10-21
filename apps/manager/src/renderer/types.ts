import type {
  DiscordChannel,
  ManagerWindowAction,
  ManagerWindowState,
  ManagerWindowMaterial,
} from "../shared/channels.js";
import type {
  CheckSummary,
  DiscordInstallation,
  InstallerProgressEvent,
  OperationSummary,
  StatusSummary,
  MaintenanceStatus,
} from "../shared/types.js";
import type { UpdateState } from "../shared/updates.js";

export interface VestraManagerApi {
  updateState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  onUpdate(listener:(state:UpdateState)=>void):()=>void;
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

declare global {
  interface Window {
    vestraManager: VestraManagerApi;
  }
}

export function managerApi(): VestraManagerApi {
  return window.vestraManager;
}
