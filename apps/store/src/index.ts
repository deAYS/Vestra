// Vestra Store — Phase 13 (final roadmap phase: plugin repository).
// Browse feeds, install hash-verified third-party plugins into the product
// home, manage their enabled state for the preload injector. Installed
// plugins start disabled; feeds are trusted by explicit user action.

export { fetchPluginFeed, searchFeed } from "./feed.js";
export type { PluginFeed, StorePluginEntry } from "./feed.js";

export { buildPluginEnvelope, parsePluginEnvelope, writePluginPayload, PLUGIN_ENTRY_FILE } from "./envelope.js";
export type { PluginEnvelope } from "./envelope.js";

export {
  browsePlugins,
  searchPlugins,
  installPlugin,
  updatePlugin,
  removePlugin,
  setPluginEnabled,
  listInstalled,
  prunePlugins,
  getRepos,
  addRepo,
  removeRepo,
  pluginsRootFor,
} from "./store.js";
export type {
  InstalledPlugin,
  InstalledRegistry,
  InstallResult,
  StoreContext,
} from "./store.js";

export { runStoreCli } from "./cli.js";
export type { StoreCliIO } from "./cli.js";
