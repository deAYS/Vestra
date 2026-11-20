export const MANAGER_IPC_PREFIX = "vestra-manager:" as const;

export const MANAGER_IPC = {
  discover: "vestra-manager:discover",
  status: "vestra-manager:status",
  check: "vestra-manager:check",
  install: "vestra-manager:install",
  repair: "vestra-manager:repair",
  uninstall: "vestra-manager:uninstall",
  progress: "vestra-manager:progress",
  maintenanceStatus: "vestra-manager:maintenance-status",
  maintenanceSet: "vestra-manager:maintenance-set",
  windowAction: "vestra-manager:window-action",
  windowState: "vestra-manager:window-state",
  updateGet: "vestra-manager:update-get",
  updateCheck: "vestra-manager:update-check",
  updateDownload: "vestra-manager:update-download",
  updateInstall: "vestra-manager:update-install",
  updateDismissError: "vestra-manager:update-dismiss-error",
  updateState: "vestra-manager:update-state",
  runStatus: "vestra-manager:run-status",
  restartDiscord: "vestra-manager:restart-discord",
  discordRunning: "vestra-manager:discord-running",
} as const;

export type ManagerWindowAction = "minimize" | "toggle-maximize" | "close";
export interface ManagerWindowState {
  maximized: boolean;
}

export type ManagerIpcChannel = (typeof MANAGER_IPC)[keyof typeof MANAGER_IPC];

export type DiscordChannel = "stable" | "ptb" | "canary";

export const ALL_CHANNELS: readonly DiscordChannel[] = [
  "stable",
  "ptb",
  "canary",
];

export function isDiscordChannel(value: unknown): value is DiscordChannel {
  return value === "stable" || value === "ptb" || value === "canary";
}

export function channelDisplayName(channel: DiscordChannel): string {
  switch (channel) {
    case "stable":
      return "Discord Stable";
    case "canary":
      return "Discord Canary";
    case "ptb":
      return "Discord PTB";
  }
}
