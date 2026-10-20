import { useState } from "react";
import type { SettingsStore } from "../api/settings.js";
import { Logger } from "../api/logger.js";
import { formatError, s, vs } from "./theme.js";
import type { PluginListEntry, PluginManagerLike } from "./types.js";
import { Icon } from "./Brand.js";
import { PluginOptions } from "./PluginOptions.js";

interface PluginCardProps {
  entry: PluginListEntry;
  plugins: PluginManagerLike;
  settings: SettingsStore;
  onChanged: () => void;
}

function errorText(err: unknown): string | undefined {
  return err === undefined ? undefined : formatError(err);
}

export function PluginCard({
  entry,
  plugins,
  settings,
  onChanged,
}: PluginCardProps): JSX.Element {
  const { definition, enabled, started } = entry;
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lastError = errorText(plugins.getLastError(definition.name));
  const displayName =
    definition.name === "QuickCSS"
      ? "QuickCSS"
      : definition.name.replace(/([a-z])([A-Z])/g, "$1 $2");

  const toggle = (): void => {
    setPending(true);
    const done = (): void => {
      setPending(false);
      onChanged();
    };
    try {
      const result = enabled
        ? plugins.disable(definition.name)
        : plugins.enable(definition.name);
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
    <div
      style={s.card}
      className={vs.card}
      data-vestra-plugin={definition.name}
    >
      <div className="vs-plugin-heading">
        <span className="vs-plugin-glyph">
          <Icon
            name={definition.name === "QuickCSS" ? "code" : "plugins"}
            size={17}
          />
        </span>
        <div>
          <strong>{displayName}</strong>
          <small>
            {started ? "Enabled" : enabled ? "Starting" : "Disabled"}
          </small>
        </div>
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
      <div className="vs-plugin-footer">
        <span>by {definition.authors.join(", ")}</span>
        <span style={{ color: started ? "#9DBDA9" : "#7E748C" }}>
          {started ? "● Running" : "○ Paused"}
        </span>
        <button
          type="button"
          onClick={() => {
            setExpanded((e) => !e);
          }}
        >
          {expanded ? "Close settings" : "Configure"}
        </button>
      </div>
      {expanded ? (
        <PluginOptions
          definition={definition}
          settings={settings}
          plugins={plugins}
        />
      ) : null}
    </div>
  );
}
