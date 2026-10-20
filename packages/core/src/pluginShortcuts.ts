import type { SettingsStore } from "./api/settings.js";
import type { PluginManagerLike } from "./ui/types.js";
import { comboMatches, isBindable } from "./ui/keybind.js";
import { Toasts } from "./api/toasts.js";

export const PLUGIN_SHORTCUT_KEY = "__vestraToggleShortcut";

export function startPluginShortcuts(
  settings: SettingsStore,
  plugins: PluginManagerLike,
): () => void {
  if (typeof window === "undefined") return () => {};
  const pending = new Set<string>();
  let stopped = false;
  const handle = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        '#vestra-overlay-root,input,textarea,[contenteditable="true"]',
      )
    )
      return;
    for (const entry of plugins.list()) {
      const name = entry.definition.name;
      const shortcut = settings.getPluginSetting(name, PLUGIN_SHORTCUT_KEY);
      if (
        typeof shortcut !== "string" ||
        !isBindable(shortcut) ||
        !comboMatches(shortcut, event)
      )
        continue;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending.has(name)) return;
      pending.add(name);
      void (entry.enabled ? plugins.disable(name) : plugins.enable(name))
        .then(
          (success) => {
            if (!stopped) {
              if (success)
                Toasts.info(
                  name,
                  entry.enabled ? "Plugin disabled" : "Plugin enabled",
                  1800,
                );
              else
                Toasts.error(
                  name,
                  "Could not change the plugin. Check its settings for details.",
                );
            }
          },
          () => {
            if (!stopped) Toasts.error(name, "Could not change the plugin.");
          },
        )
        .finally(() => pending.delete(name));
      return;
    }
  };
  window.addEventListener("keydown", handle, true);
  return () => {
    stopped = true;
    window.removeEventListener("keydown", handle, true);
  };
}
