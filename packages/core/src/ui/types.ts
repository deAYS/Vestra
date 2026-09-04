// @vestra/core UI — shared dependency types.
// Phase 5. Narrow interfaces so pages stay testable without the singletons.
// `PluginManager` satisfies `PluginManagerLike` structurally.

import type { PluginDefinition } from "../api/plugins.js";
import type { SettingsStore } from "../api/settings.js";

export type SettingsPageId = "settings" | "plugins" | "themes" | "quickcss" | "about";

export interface PluginListEntry {
  readonly definition: PluginDefinition;
  readonly enabled: boolean;
  readonly started: boolean;
}

export interface PluginManagerLike {
  list(): readonly PluginListEntry[];
  enable(name: string): Promise<boolean>;
  disable(name: string): Promise<boolean>;
  getLastError(name: string): unknown;
}

export interface VestraUIDeps {
  settings: SettingsStore;
  plugins: PluginManagerLike;
  version: string;
}

export interface PageProps {
  settings: SettingsStore;
  plugins: PluginManagerLike;
  version: string;
}
