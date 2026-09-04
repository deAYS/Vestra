// @vestra/core UI — QuickCSS page.
// Phase 5. Edits `Settings.customCss`; the core QuickCSS service applies it
// live, so toggling here takes effect without reload.

import { useEffect, useState } from "react";
import { useSettingsSnapshot } from "./hooks.js";
import { Logger } from "../api/logger.js";
import { s } from "./theme.js";
import type { PageProps } from "./types.js";

export function QuickCssPage({ settings }: PageProps): JSX.Element {
  const snapshot = useSettingsSnapshot(settings);
  const [text, setText] = useState(snapshot.customCss.css);

  // Sync external changes (another surface editing the same setting) without
  // clobbering in-progress typing: only overwrite when the values differ.
  useEffect(() => {
    if (snapshot.customCss.css !== text) setText(snapshot.customCss.css);
  });

  const live = snapshot.customCss.enabled && snapshot.customCss.css.trim() !== "";

  const setEnabled = (enabled: boolean): void => {
    try {
      settings.setCustomCssEnabled(enabled);
    } catch (err: unknown) {
      Logger.captureError(err, "SettingsUI:QuickCSS.enabled");
    }
  };

  const setTextLive = (value: string): void => {
    setText(value);
    try {
      settings.setCustomCssText(value);
    } catch (err: unknown) {
      Logger.captureError(err, "SettingsUI:QuickCSS.css");
    }
  };

  const clear = (): void => {
    setText("");
    try {
      settings.setCustomCss({ enabled: false, css: "" });
    } catch (err: unknown) {
      Logger.captureError(err, "SettingsUI:QuickCSS.clear");
    }
  };

  return (
    <section data-vestra-page="quickcss">
      <div style={s.header}>
        <h2 style={s.title}>QuickCSS</h2>
        <p style={s.subtitle}>{live ? "Applied live" : "Not applied"}</p>
      </div>
      <label style={{ ...s.row, marginBottom: 10, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={snapshot.customCss.enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
          }}
        />
        Enable custom CSS
      </label>
      <textarea
        style={s.textarea}
        value={text}
        onChange={(e) => {
          setTextLive(e.target.value);
        }}
        placeholder={".my-selector {\n  color: red;\n}"}
        aria-label="Custom CSS"
        spellCheck={false}
      />
      <div style={{ ...s.row, marginTop: 8 }}>
        <span style={s.muted}>{text.length} characters</span>
        <button type="button" style={s.dangerButton} onClick={clear}>
          Clear
        </button>
      </div>
    </section>
  );
}
