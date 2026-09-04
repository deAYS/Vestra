// @vestra/core UI — Vestra Settings home page.
// Phase 5. Overview + navigation shortcuts + the danger zone (reset all
// settings with a two-step confirm). Reset never throws: store errors go
// through Logger.

import { useEffect, useState } from "react";
import { VESTRA_BRANDING, VESTRA_STORAGE_KEY } from "@vestra/shared";
import { Logger } from "../api/logger.js";
import { formatCombo, isBindable } from "./keybind.js";
import { getOverlayKeybind, setOverlayKeybind } from "./Overlay.js";
import { useSettingsSnapshot } from "./hooks.js";
import { s } from "./theme.js";
import type { PageProps, SettingsPageId } from "./types.js";

export function SettingsHomePage({
  settings,
  plugins,
  onNavigate,
}: PageProps & { onNavigate: (page: SettingsPageId) => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const total = plugins.list().length;
  const enabled = plugins.list().filter((p) => p.enabled).length;
  const css = settings.getCustomCss();

  const reset = (): void => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    try {
      settings.reset();
    } catch (err: unknown) {
      Logger.captureError(err, "SettingsUI:reset");
    }
    setConfirming(false);
  };

  return (
    <section data-vestra-page="settings">
      <div style={s.header}>
        <h2 style={s.title}>{VESTRA_BRANDING.name} Settings</h2>
        <p style={s.subtitle}>{VESTRA_BRANDING.tagline}</p>
      </div>
      <div style={s.card} className="vs-overview-card">
        <div>
          Plugins <span style={s.code}>{enabled}/{total} enabled</span>
        </div>
        <div style={{ marginTop: 6 }}>
          QuickCSS{" "}
          <span style={s.code}>{css.enabled ? "on" : "off"}</span>
        </div>
        <div style={{ marginTop: 6 }}>
          Storage <span style={s.code}>{VESTRA_STORAGE_KEY}</span>
        </div>
        <div style={{ ...s.row, marginTop: 10 }}>
          <button type="button" style={s.button} onClick={() => void onNavigate("plugins")}>
            Manage plugins
          </button>
          <button type="button" style={s.navButton} onClick={() => void onNavigate("quickcss")}>
            Edit QuickCSS
          </button>
        </div>
      </div>
      <KeybindCard settings={settings} />
      <div style={s.card} className="vs-danger-card">
        <strong>Danger zone</strong>
        <p style={s.muted}>Reset every Vestra setting (plugins, toggles, QuickCSS) to defaults.</p>
        <button type="button" style={s.dangerButton} onClick={reset}>
          {confirming ? "Click again to confirm reset" : "Reset all settings"}
        </button>
      </div>
    </section>
  );
}

function KeybindCard({ settings }: { settings: PageProps["settings"] }): JSX.Element {
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
        setError("Press a modifier combo (e.g. Ctrl+Shift+V) or a function key.");
        return;
      }
      try {
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
  }, [recording, settings]);

  return (
    <div style={s.card} className="vs-keybind-card">
      <strong>Overlay keybind</strong>
      <p style={s.muted}>Toggle the Vestra panel from anywhere in Discord.</p>
      <div style={s.row}>
        <span style={s.code}>{current}</span>
        <button
          type="button"
          style={recording ? s.dangerButton : s.button}
          onClick={() => {
            setError("");
            setRecording((r) => !r);
          }}
        >
          {recording ? "Press keys… (Esc cancels)" : "Change"}
        </button>
      </div>
      {error !== "" ? <div style={{ ...s.muted, color: "#ff8080", marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}
