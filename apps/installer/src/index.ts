export { resolveHome, layoutHome } from "./home.js";
export type { HomeLayout, HomeOptions } from "./home.js";

export {
  stagePayload,
  verifyPayload,
  readPayloadManifest,
  loadPayloadSources,
  payloadDirFor,
  sha256Hex,
  PAYLOAD_FILES,
} from "./payload.js";
export type { PayloadManifest, StageOptions } from "./payload.js";

export { loadRegistry, loadRegistryWithDiagnostics, saveRegistry } from "./registry.js";
export type { InstallRegistry, RegistryEntry, RegistryLoadDiagnostics } from "./registry.js";

export { installAll, uninstallAll, repairAll, checkHealth, statusAll, resetToBackup, assessStaleRecord, findStaleRecords, pruneStaleRecords, channelMatches } from "./operations.js";
export type {
  BatchResult,
  HealthReport,
  KeepReason,
  OperationContext,
  PerInstallResult,
  PruneResult,
  PruneSkipped,
  PruneStaleDetail,
  StaleDecision,
  StaleReason,
} from "./operations.js";

export { createInstallerService, toDiscordInstallation, toErrorCode } from "./service.js";
export type {
  CheckOptions,
  CheckSummary,
  DiscoverOptions,
  DiscordInstallation,
  InstallHealth,
  InstallOptions,
  InstallerErrorCode,
  InstallerOperation,
  InstallerPhase,
  InstallerProgressEvent,
  InstallerProgressListener,
  InstallerService,
  InstallerServiceContext,
  InstallStatus,
  OperationSummary,
  PruneOptions,
  PruneSummary,
  RepairOptions,
  ServicePerInstallResult,
  StatusOptions,
  StatusSummary,
  UninstallOptions,
} from "./service.js";

export { runCli } from "./cli.js";
export type { CliIO } from "./cli.js";
