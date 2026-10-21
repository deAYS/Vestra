import { useEffect, useState } from "react";
import { Logger } from "../api/logger.js";
import { formatCombo, isBindable } from "./keybind.js";
import { getOverlayKeybind, setOverlayKeybind } from "./Overlay.js";
import { useRefreshCounter, useSettingsSnapshot } from "./hooks.js";
import { s } from "./theme.js";
import { BrandMark, Icon } from "./Brand.js";
import type { PageProps, SettingsPageId } from "./types.js";
import { LAUNCHER_POSITION_KEY } from "./launcherPosition.js";
import { LAUNCHER_HIDDEN_KEY } from "./Launcher.js";
import { shortcutConflict } from "./PluginOptions.js";

export function SettingsHomePage({
  settings,
  plugins,
  onNavigate,
}: PageProps & { onNavigate: (page: SettingsPageId) => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const snapshot = useSettingsSnapshot(settings);
  const persistence = settings.getPersistenceStatus();
  const { refresh } = useRefreshCounter();
  useEffect(() => plugins.subscribe?.(refresh), [plugins, refresh]);
  const total = plugins.list().length;
  const enabled = plugins.list().filter((p) => p.enabled).length;
  const css = settings.getCustomCss();

  const reset = async (): Promise<void> => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setResetting(true);
    try {
      for (const entry of plugins.list())
        await plugins.disable(entry.definition.name);
      settings.reset();
      for (const entry of plugins.list()) {
        if (entry.definition.enabledByDefault)
          await plugins.enable(entry.definition.name);
      }
    } catch (err: unknown) {
      Logger.captureError(err, "SettingsUI:reset");
    }
    setConfirming(false);
    setResetting(false);
  };

  return (
    <section data-vestra-page="settings">
      <div style={s.header}>
        <h2 style={s.title}>A little more you.</h2>
        <p style={s.subtitle}>
          Your space, with the finishing touches that make it yours.
        </p>
      </div>
      <div className="vs-home-hero">
        <BrandMark size={210} />
        <small>
          <span className="vs-status-dot" /> Made for your Discord
        </small>
        <h3>
          Same friends.
          <br />
          Different atmosphere.
        </h3>
        <p>Find your palette. Set the mood. Make yourself at home.</p>
        <button
          type="button"
          style={s.button}
          onClick={() => onNavigate("themes")}
        >
          Explore themes <Icon name="arrow" size={14} />
        </button>
      </div>
      <div className="vs-stat-grid">
        <div className="vs-stat">
          <span>
            <Icon name="plugins" size={12} />
            Plugins
          </span>
          <strong>
            {enabled}
            <small>/ {total} enabled</small>
          </strong>
        </div>
        <div className="vs-stat">
          <span>
            <Icon name="themes" size={12} />
            Themes
          </span>
          <strong>
            {snapshot.themes.length}
            <small>in your library</small>
          </strong>
        </div>
        <div className="vs-stat">
          <span>
            <Icon name="code" size={12} />
            QuickCSS
          </span>
          <strong style={{ fontSize: 18 }}>
            {css.enabled &&
            css.css.trim() &&
            plugins
              .list()
              .some((p) => p.definition.name === "QuickCSS" && p.started)
              ? "Live"
              : "Off"}
            <small>custom styling</small>
          </strong>
        </div>
      </div>
      <h3 className="vs-section-label">Make it yours</h3>
      <div className="vs-setting-row">
        <div>
          <strong>Plugins</strong>
          <p>Small additions. A better everyday experience.</p>
        </div>
        <button
          type="button"
          style={s.navButton}
          onClick={() => onNavigate("plugins")}
        >
          Manage plugins
        </button>
      </div>
      <div className="vs-setting-row">
        <div>
          <strong>Custom styling</strong>
          <p>The last word on how your Discord looks.</p>
        </div>
        <button
          type="button"
          style={s.navButton}
          onClick={() => onNavigate("quickcss")}
        >
          Open editor
        </button>
      </div>
      <KeybindCard settings={settings} plugins={plugins} />
      <div className="vs-setting-row">
        <div>
          <strong>Startup notification</strong>
          <p>A quiet confirmation when Vestra is ready.</p>
        </div>
        <input
          type="checkbox"
          aria-label="Show startup notification"
          checked={
            snapshot.plugins.Vestra?.settings.startupNotification !== false
          }
          onChange={(event) =>
            settings.setPluginSetting(
              "Vestra",
              "startupNotification",
              event.target.checked,
            )
          }
        />
      </div>
      <div className="vs-setting-row">
        <div>
          <strong>Match your Discord theme</strong>
          <p>
            Use your theme’s surfaces and accent for Vestra settings, the
            floating button and its menu. Turn off to keep Vestra purple.
          </p>
        </div>
        <input
          type="checkbox"
          aria-label="Match your Discord theme"
          checked={snapshot.plugins.Vestra?.settings.followTheme !== false}
          onChange={(event) =>
            settings.setPluginSetting(
              "Vestra",
              "followTheme",
              event.target.checked,
            )
          }
        />
      </div>
      <div className="vs-setting-row">
        <div>
          <strong>Floating Vestra button</strong>
          <p>
            Drag to move. Right-click to hide. Your shortcut always opens
            Vestra.
          </p>
        </div>
        <input
          type="checkbox"
          aria-label="Show floating Vestra button"
          checked={
            snapshot.plugins.Vestra?.settings[LAUNCHER_HIDDEN_KEY] !== true
          }
          onChange={(event) =>
            settings.setPluginSetting(
              "Vestra",
              LAUNCHER_HIDDEN_KEY,
              !event.target.checked,
            )
          }
        />
        <button
          type="button"
          style={s.navButton}
          onClick={() =>
            settings.setPluginSetting("Vestra", LAUNCHER_POSITION_KEY, null)
          }
        >
          Reset position
        </button>
      </div>
      <details
        className="vs-advanced"
        style={{ marginTop: 24, color: "#82768F", fontSize: 11 }}
      >
        <summary style={{ cursor: "pointer", padding: "10px 0" }}>
          Advanced preferences
        </summary>
        <div className="vs-setting-row">
          <div>
            <strong>Preferences storage</strong>
            <p>
              {persistence.error ??
                (persistence.backend === "file"
                  ? "Saved to Vestra's own settings file."
                  : persistence.backend === "browser"
                    ? "Saved in this browser."
                    : "Temporary memory only. Preferences will be lost on restart.")}
            </p>
          </div>
          <span>{persistence.backend}</span>
        </div>
        <div className="vs-setting-row">
          <div>
            <strong>Start fresh</strong>
            <p>Reset settings, plugins, themes and custom CSS.</p>
          </div>
          <button
            type="button"
            style={s.dangerButton}
            disabled={resetting}
            onClick={() => void reset()}
          >
            {confirming ? "Click again to confirm reset" : "Reset all settings"}
          </button>
        </div>
      </details>
    </section>
  );
}

function KeybindCard({
  settings,
  plugins,
}: Pick<PageProps, "settings" | "plugins">): JSX.Element {
  // Subscribe so the shown combo refreshes when settings change elsewhere.
  useSettingsSnapshot(settings);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const current = getOverlayKeybind(settings);

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        setError("");
        return;
      }
      const combo = formatCombo(event);
      if (combo === "" || !isBindable(combo)) {
        setError(
          "Press a modifier combo (e.g. Ctrl+Shift+V) or a function key.",
        );
        return;
      }
      try {
        const conflict = shortcutConflict(
          combo,
          "Vestra",
          "overlayKeybind",
          settings,
          plugins,
        );
        if (conflict) {
          setError(`Already used by ${conflict}. Choose another shortcut.`);
          return;
        }
        setOverlayKeybind(settings, combo);
        setError("");
      } catch (err: unknown) {
        Logger.captureError(err, "SettingsUI:keybind");
        setError("Could not save that keybind.");
      }
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [recording, settings, plugins]);

  return (
    <div className="vs-setting-row vs-keybind-card">
      <div>
        <strong>Keyboard shortcut</strong>
        <p>A familiar way back to your workspace.</p>
      </div>
      <div style={{ ...s.row, flex: 0 }}>
        <span style={s.code}>{current}</span>
        <button
          type="button"
          style={recording ? s.dangerButton : s.button}
          data-vestra-keybind-recording={recording}
          onClick={() => {
            setError("");
            setRecording((r) => !r);
          }}
        >
          {recording ? "Press keys… (Esc cancels)" : "Change"}
        </button>
      </div>
      {error !== "" ? (
        <div style={{ ...s.muted, color: "#ff8080", marginTop: 6 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
