// @vestra/injector — bootstrap/injection layer.
// Phase 10 (roadmap #10). Discovers Discord installs, builds the native
// payload (preload, main hook, renderer loader), and patches app.asar to load
// Vestra automatically. `uninject()` restores the pristine backup.

export { listInstalls } from "./paths.js";
export type { DiscordChannel, DiscordInstall, DiscoveryOptions } from "./paths.js";

export { buildPreloadSource } from "./preload.js";
export type { PreloadOptions } from "./preload.js";

export { buildMainHookSource, HOOKDIR_PREFIX } from "./mainHook.js";
export type { MainHookOptions } from "./mainHook.js";

export { buildLoaderSource } from "./loader.js";
export type { LoaderOptions } from "./loader.js";

export {
  planInject,
  applyInject,
  uninject,
  isInjected,
  readReceipt,
  VESTRA_DIR,
  RECEIPT_FILE,
  BACKUP_SUFFIX,
  HOOK_REQUIRE_PREFIX,
  MAIN_HOOK_FILE,
  PRELOAD_FILE,
  BUNDLE_FILE,
  LOADER_FILE,
} from "./patch.js";
export type {
  ApplyOptions,
  InjectPlan,
  InjectReceipt,
  PayloadSources,
} from "./patch.js";

export { unpackAsar, packAsar, readAsarFile, readAsarMain, AsarError } from "./asar.js";
