import { useState } from "react";
import type { SettingsStore } from "../api/settings.js";
import { Logger } from "../api/logger.js";
import { formatError, s, vs } from "./theme.js";
import type { PluginListEntry, PluginManagerLike } from "./types.js";
import { Icon } from "./Brand.js";

interface PluginCardProps {
  entry: PluginListEntry;
  plugins: PluginManagerLike;
  settings: SettingsStore;
  onChanged: () => void;
}

function errorText(err: unknown): string | undefined {
  return err === undefined ? undefined : formatError(err);
}

export function PluginCard({ entry, plugins, settings, onChanged }: PluginCardProps): JSX.Element {
  const { definition, enabled, started } = entry;
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lastError = errorText(plugins.getLastError(definition.name));
  const displayName = definition.name === "QuickCSS" ? "QuickCSS" : definition.name.replace(/([a-z])([A-Z])/g,"$1 $2");
  const hasSettings = Object.keys(settings.getPluginSettings(definition.name)).length > 0;

  const toggle = (): void => {
    setPending(true);
    const done = (): void => {
      setPending(false);
      onChanged();
    };
    try {
      const result = enabled ? plugins.disable(definition.name) : plugins.enable(definition.name);
      void Promise.resolve(result).then(done, (err: unknown) => {
        Logger.captureError(err, `SettingsUI:toggle "${definition.name}"`);
        done();
      });
    } catch (err: unknown) {
      Logger.captureError(err, `SettingsUI:toggle "${definition.name}"`);
      done();
    }
  };

  return (
    <div style={s.card} className={vs.card} data-vestra-plugin={definition.name}>
      <div className="vs-plugin-heading">
        <span className="vs-plugin-glyph"><Icon name={definition.name === "QuickCSS" ? "code" : "plugins"} size={17}/></span>
        <div><strong>{displayName}</strong><small>{started ? "Enabled" : enabled ? "Starting" : "Disabled"}</small></div>
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={toggle}
            aria-label={`Enable ${definition.name}`}
          />
      </div>
      <p>{definition.description}</p>
      {lastError !== undefined ? (
        <div style={s.errorBox} data-vestra-plugin-error={definition.name}>
          <strong>Plugin error:</strong> {lastError}
        </div>
      ) : null}
      <div className="vs-plugin-footer"><span>by {definition.authors.join(", ")}</span><span style={{color:started?"#9DBDA9":"#7E748C"}}>{started?"● Running":"○ Paused"}</span>
      {hasSettings &&
        <button
          type="button"
          onClick={() => {
            setExpanded((e) => !e);
          }}
        >
          {expanded ? "Close settings" : "Configure"}
        </button>
      }
      </div>
      {expanded ? (
        <PluginSettingsEditor name={definition.name} settings={settings} />
      ) : null}
    </div>
  );
}

function PluginSettingsEditor({
  name,
  settings,
}: {
  name: string;
  settings: SettingsStore;
}): JSX.Element {
  // Snapshot read each render keeps the editor in sync with external changes.
  const values = settings.getPluginSettings(name);
  const keys = Object.keys(values);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const commit = (key: string, value: unknown): void => {
    try {
      settings.setPluginSetting(name, key, value);
    } catch (err: unknown) {
      Logger.captureError(err, `SettingsUI:settings "${name}"`);
    }
  };

  const removeKey = (key: string): void => {
    try {
      const next = settings.getPluginSettings(name);
      delete next[key];
      settings.setPluginSettings(name, next);
    } catch (err: unknown) {
      Logger.captureError(err, `SettingsUI:settings "${name}"`);
    }
  };

  const addKey = (): void => {
    const key = newKey.trim();
    if (key === "") return;
    commit(key, newValue);
    setNewKey("");
    setNewValue("");
  };

  if (keys.length === 0) {
    return (
      <div style={{ ...s.muted, marginTop: 8 }}>
        No settings stored for this plugin yet. Add one below.
        <AddKeyRow
          newKey={newKey}
          newValue={newValue}
          onKey={setNewKey}
          onValue={setNewValue}
          onAdd={addKey}
        />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      {keys.map((key) => (
        <SettingRow
          key={key}
          settingKey={key}
          value={values[key]}
          onCommit={commit}
          onDelete={removeKey}
        />
      ))}
      <AddKeyRow
        newKey={newKey}
        newValue={newValue}
        onKey={setNewKey}
        onValue={setNewValue}
        onAdd={addKey}
      />
    </div>
  );
}

function SettingRow({
  settingKey,
  value,
  onCommit,
  onDelete,
}: {
  settingKey: string;
  value: unknown;
  onCommit: (key: string, value: unknown) => void;
  onDelete: (key: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const shown = draft ?? toText(value);

  if (typeof value === "boolean") {
    return (
      <label style={{ ...s.row, marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => {
            onCommit(settingKey, e.target.checked);
          }}
        />
        <span style={s.code}>{settingKey}</span>
        <button
          type="button"
          style={s.navButton}
          onClick={() => {
            onDelete(settingKey);
          }}
          aria-label={`Delete ${settingKey}`}
        >
          ×
        </button>
      </label>
    );
  }

  if (typeof value === "string" || typeof value === "number") {
    const commitDraft = (): void => {
      if (draft === undefined) return;
      if (typeof value === "number") {
        const parsed = Number(draft);
        if (Number.isNaN(parsed)) {
          setDraft(undefined);
          return;
        }
        onCommit(settingKey, parsed);
      } else {
        onCommit(settingKey, draft);
      }
      setDraft(undefined);
    };
    return (
      <div style={{ ...s.row, marginBottom: 6 }}>
        <span style={s.code}>{settingKey}</span>
        <input
          style={s.input}
          value={shown}
          inputMode={typeof value === "number" ? "decimal" : "text"}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
            if (e.key === "Escape") setDraft(undefined);
          }}
          aria-label={settingKey}
        />
        <button
          type="button"
          style={s.navButton}
          onClick={() => {
            onDelete(settingKey);
          }}
          aria-label={`Delete ${settingKey}`}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...s.row, marginBottom: 6 }}>
      <span style={s.code}>{settingKey}</span>
      <code style={{ ...s.code, ...s.muted }}>{safePreview(value)}</code>
      <span style={s.muted}>(read-only)</span>
    </div>
  );
}

function AddKeyRow({
  newKey,
  newValue,
  onKey,
  onValue,
  onAdd,
}: {
  newKey: string;
  newValue: string;
  onKey: (v: string) => void;
  onValue: (v: string) => void;
  onAdd: () => void;
}): JSX.Element {
  return (
    <div style={{ ...s.row, marginTop: 6 }}>
      <input
        style={s.input}
        value={newKey}
        placeholder="key"
        onChange={(e) => {
          onKey(e.target.value);
        }}
        aria-label="New setting key"
      />
      <input
        style={s.input}
        value={newValue}
        placeholder="value"
        onChange={(e) => {
          onValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onAdd();
        }}
        aria-label="New setting value"
      />
      <button type="button" style={s.button} onClick={onAdd}>
        Add
      </button>
    </div>
  );
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return safePreview(value);
}

function safePreview(value: unknown): string {
  try {
    const raw = JSON.stringify(value) ?? String(value);
    return raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
  } catch {
    return "[unserializable]";
  }
}
