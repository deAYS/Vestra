import type {
  DiscordChannel,
  ManagerWindowAction,
  ManagerWindowState,
} from "../shared/channels.js";
import type {
  CheckSummary,
  DiscordInstallation,
  InstallerProgressEvent,
  OperationSummary,
  StatusSummary,
  MaintenanceStatus,
  RunStatusMap,
} from "../shared/types.js";
import type { UpdateState } from "../shared/updates.js";

export interface VestraManagerApi {
  updateState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  dismissUpdateError(): Promise<UpdateState>;
  onUpdate(listener:(state:UpdateState)=>void):()=>void;
  windowAction(action: ManagerWindowAction): void;
  onWindowState(listener: (state: ManagerWindowState) => void): () => void;
  discover(): Promise<DiscordInstallation[]>;
  status(args?: { channels?: DiscordChannel[] }): Promise<StatusSummary>;
  check(args?: { channels?: DiscordChannel[] }): Promise<CheckSummary>;
  install(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  repair(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  uninstall(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  restartDiscord(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  discordRunning(args: { channels: DiscordChannel[] }): Promise<boolean>;
  runStatus(): Promise<RunStatusMap>;
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
