// Vestra Manager (renderer) — window API typings.
// The narrow preload bridge is the only native surface available here.

import type { DiscordChannel } from "../shared/channels.js";
import type {
  CheckSummary,
  DiscordInstallation,
  InstallerProgressEvent,
  OperationSummary,
  StatusSummary,
} from "../shared/types.js";

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

declare global {
  interface Window {
    vestraManager: VestraManagerApi;
  }
}

export function managerApi(): VestraManagerApi {
  return window.vestraManager;
}
