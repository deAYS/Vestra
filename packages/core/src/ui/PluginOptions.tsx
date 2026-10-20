import { useEffect, useRef, useState } from "react";
import type {
  PluginDefinition,
  PluginSettingDefinition,
} from "../api/plugins.js";
import type { SettingsStore } from "../api/settings.js";
import type { PluginManagerLike } from "./types.js";
import {
  DEFAULT_OVERLAY_KEYBIND,
  combosEqual,
  formatCombo,
  isBindable,
} from "./keybind.js";
import { useSettingsSnapshot } from "./hooks.js";
import { s } from "./theme.js";
import { PLUGIN_SHORTCUT_KEY } from "../pluginShortcuts.js";

export function shortcutConflict(
  combo: string,
  name: string,
  key: string,
  settings: SettingsStore,
  plugins: PluginManagerLike,
): string | undefined {
  if (!combo) return;
  const same = (value: unknown): boolean =>
    typeof value === "string" && combosEqual(value, combo);
  if (
    name !== "Vestra" &&
    same(
      settings.getPluginSetting("Vestra", "overlayKeybind") ??
        DEFAULT_OVERLAY_KEYBIND,
    )
  )
    return "Open Vestra";
  for (const entry of plugins.list()) {
    const owner = entry.definition.name;
    if (
      (owner !== name || key !== PLUGIN_SHORTCUT_KEY) &&
      same(settings.getPluginSetting(owner, PLUGIN_SHORTCUT_KEY))
    )
      return `${owner} toggle`;
    for (const [field, definition] of Object.entries(
      entry.definition.settingsSchema ?? {},
    )) {
      if (
        definition.type === "keybind" &&
        (owner !== name || field !== key) &&
        same(settings.getPluginSetting(owner, field) ?? definition.default)
      )
        return `${owner}: ${definition.label}`;
    }
  }
  return;
}

function Shortcut({
  value,
  defaultValue,
  label,
  save,
}: {
  value: string;
  defaultValue: string;
  label: string;
  save: (value: string) => string | undefined;
}): JSX.Element {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="vs-shortcut-editor">
      <button
        type="button"
        style={recording ? s.button : s.navButton}
        aria-label={`Change ${label}`}
        data-vestra-keybind-recording={recording}
        onBlur={() => setRecording(false)}
        onClick={() => {
          setError("");
          setRecording(!recording);
        }}
        onKeyDown={(event) => {
          if (!recording) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            setRecording(false);
            setError("");
            return;
          }
          const combo = formatCombo(event);
          if (!combo) return;
          if (!isBindable(combo)) {
            setError(
              "Include Ctrl, Alt, Shift or Meta, or use a function key.",
            );
            return;
          }
          const problem = save(combo);
          setError(problem ?? "");
          if (!problem) setRecording(false);
        }}
      >
        {recording ? "Press keys…" : value || "Not assigned"}
      </button>
      {value && (
        <button
          type="button"
          className="vs-option-reset"
          aria-label={`Clear ${label}`}
          onClick={() => {
            save("");
            setError("");
          }}
        >
          Clear
        </button>
      )}
      {value !== defaultValue && defaultValue && (
        <button
          type="button"
          className="vs-option-reset"
          aria-label={`Reset ${label}`}
          onClick={() => setError(save(defaultValue) ?? "")}
        >
          Reset
        </button>
      )}
      {error && (
        <p role="alert" style={{ color: "#e7a4ae", width: "100%" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function PluginOptions({
  definition,
  settings,
  plugins,
}: {
  definition: PluginDefinition;
  settings: SettingsStore;
  plugins: PluginManagerLike;
}): JSX.Element {
  useSettingsSnapshot(settings);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, []);
  const fields: Record<string, PluginSettingDefinition> = {
    ...(definition.settingsSchema ?? {}),
    [PLUGIN_SHORTCUT_KEY]: {
      type: "keybind",
      label: "Toggle plugin shortcut",
      description:
        "Enable or disable this plugin from Discord. Empty means no shortcut.",
      default: "",
    },
  };
  return (
    <div className="vs-plugin-options" ref={panel}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h4>Make it yours</h4>
        <button
          type="button"
          className="vs-option-reset"
          onClick={() => {
            const next = settings.getPluginSettings(definition.name);
            for (const key of Object.keys(fields)) delete next[key];
            settings.setPluginSettings(definition.name, next);
          }}
        >
          Reset defaults
        </button>
      </div>
      {Object.entries(fields).map(([key, field]) => {
        const raw = settings.getPluginSetting(definition.name, key);
        const value =
          field.type === "boolean"
            ? typeof raw === "boolean"
              ? raw
              : field.default
            : field.type === "number"
              ? typeof raw === "number" && Number.isFinite(raw)
                ? Math.max(
                    field.min ?? -Infinity,
                    Math.min(field.max ?? Infinity, raw),
                  )
                : field.default
              : field.type === "select"
                ? typeof raw === "string" &&
                  field.options.some((option) => option.value === raw)
                  ? raw
                  : field.default
                : field.type === "keybind"
                  ? typeof raw === "string" && (!raw || isBindable(raw))
                    ? raw
                    : field.default
                  : typeof raw === "string"
                    ? raw
                    : field.default;
        const save = (next: unknown): void =>
          settings.setPluginSetting(definition.name, key, next);
        return (
          <div className="vs-option-row" key={key}>
            <div>
              <strong>{field.label}</strong>
              {field.description && <p>{field.description}</p>}
            </div>
            {field.type === "boolean" ? (
              <input
                type="checkbox"
                aria-label={field.label}
                checked={value === true}
                onChange={(event) => save(event.target.checked)}
              />
            ) : field.type === "select" ? (
              <select
                aria-label={field.label}
                value={typeof value === "string" ? value : field.default}
                onChange={(event) => save(event.target.value)}
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "number" ? (
              <div className="vs-number-option">
                <input
                  type="range"
                  aria-label={field.label}
                  min={field.min ?? 0}
                  max={field.max ?? 100}
                  step={field.step ?? 1}
                  value={
                    typeof value === "number" && Number.isFinite(value)
                      ? value
                      : field.default
                  }
                  onChange={(event) => save(Number(event.target.value))}
                />
                <output>{String(value)}</output>
              </div>
            ) : field.type === "keybind" ? (
              <Shortcut
                value={typeof value === "string" ? value : field.default}
                defaultValue={field.default}
                label={field.label}
                save={(next) => {
                  const owner = shortcutConflict(
                    next,
                    definition.name,
                    key,
                    settings,
                    plugins,
                  );
                  if (owner)
                    return `Already used by ${owner}. Choose another shortcut.`;
                  save(next);
                  return;
                }}
              />
            ) : (
              <input
                style={{ ...s.input, width: 180 }}
                aria-label={field.label}
                value={String(value)}
                maxLength={500}
                onChange={(event) => save(event.target.value)}
              />
            )}
          </div>
        );
      })}
      <p className="vs-options-note">
        Saved automatically. Changes apply immediately.
      </p>
    </div>
  );
}
