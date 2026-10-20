import { Settings } from "../api/settings.js";
import type { PluginSettingDefinition } from "../api/plugins.js";

export const modifierSetting: PluginSettingDefinition = {
  type: "select",
  label: "Activation modifier",
  description: "Hold this key while using the mouse action.",
  default: "Alt",
  options: [
    { label: "Alt", value: "Alt" },
    { label: "Ctrl", value: "Ctrl" },
    { label: "Meta / Windows", value: "Meta" },
  ],
};
export const confirmationSetting: PluginSettingDefinition = {
  type: "boolean",
  label: "Copy confirmation",
  description: "Show a small notification after copying.",
  default: true,
};

export function numberOption(
  name: string,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Settings.getPluginSetting(name, key);
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}
export function booleanOption(
  name: string,
  key: string,
  fallback = true,
): boolean {
  const value = Settings.getPluginSetting(name, key);
  return typeof value === "boolean" ? value : fallback;
}
export function modifierMatches(
  name: string,
  event: Pick<MouseEvent, "ctrlKey" | "altKey" | "metaKey" | "shiftKey">,
  allowShift = false,
): boolean {
  const raw = Settings.getPluginSetting(name, "modifier");
  const modifier = raw === "Ctrl" || raw === "Meta" ? raw : "Alt";
  return (
    event.altKey === (modifier === "Alt") &&
    event.ctrlKey === (modifier === "Ctrl") &&
    event.metaKey === (modifier === "Meta") &&
    (allowShift || !event.shiftKey)
  );
}
