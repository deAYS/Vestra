// Vestra Manager — renderer-safe DTOs.
// Structural mirrors of the installer-service contract
// (apps/installer/src/service.ts). Main imports the real service types;
// renderer + preload use these so the browser bundle never pulls Node code.

import type { DiscordChannel } from "./channels.js";

export type InstallHealth = "healthy" | "not-installed" | "drifted" | "stale" | "error";

export interface DiscordInstallation {
  channel: DiscordChannel;
  version: string | null;
  rootDir: string;
  appDir: string;
  asarPath: string;
  isActive: boolean;
}

export type InstallerErrorCode =
  | "discord-not-found"
  | "permission-denied"
  | "invalid-asar"
  | "receipt-invalid"
  | "backup-missing"
  | "patch-failed"
  | "verification-failed"
  | "safety-refusal"
  | "unknown";

export interface InstallStatus {
  installation: DiscordInstallation;
  health: InstallHealth;
  vestraInstalled: boolean;
  repairable: boolean;
  detail?: string | undefined;
  code?: InstallerErrorCode | undefined;
}

export interface StatusSummary {
  statuses: InstallStatus[];
  stale: string[];
}

export interface CheckSummary {
  statuses: InstallStatus[];
  stale: string[];
}

export interface PerInstallResult {
  asarPath: string;
  channel: string;
  ok: boolean;
  action: string;
  detail?: string | undefined;
  code?: InstallerErrorCode | undefined;
}

export interface OperationSummary {
  ok: boolean;
  results: PerInstallResult[];
}

export type InstallerOperation =
  | "discover"
  | "status"
  | "check"
  | "install"
  | "repair"
  | "uninstall"
  | "prune";

export type InstallerPhase = "discovering" | "staging" | "patching" | "verifying" | "complete";

export interface InstallerProgressEvent {
  operation: InstallerOperation;
  phase: InstallerPhase;
  installation?: DiscordInstallation | undefined;
  index?: number | undefined;
  total?: number | undefined;
}
