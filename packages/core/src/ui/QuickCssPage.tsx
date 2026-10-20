import { useEffect, useState } from "react";
import { useRefreshCounter, useSettingsSnapshot } from "./hooks.js";
import { Logger } from "../api/logger.js";
import { s } from "./theme.js";
import type { PageProps } from "./types.js";
import { CssEditor } from "./CssEditor.js";

export function QuickCssPage({ settings, plugins }: PageProps): JSX.Element {
  const snapshot = useSettingsSnapshot(settings);
  const [text, setText] = useState(snapshot.customCss.css);
  const { refresh } = useRefreshCounter();
  useEffect(() => plugins.subscribe?.(refresh), [plugins, refresh]);
  const running = plugins
    .list()
    .some((plugin) => plugin.definition.name === "QuickCSS" && plugin.started);

  // Sync external changes (another surface editing the same setting) without
  // clobbering in-progress typing: only overwrite when the values differ.
  useEffect(() => {
    if (snapshot.customCss.css !== text) setText(snapshot.customCss.css);
  });

  const live =
    running &&
    snapshot.customCss.enabled &&
    snapshot.customCss.css.trim() !== "";

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
        <p style={s.subtitle}>The finishing touch, written by you.</p>
      </div>
      {!running && (
        <div
          style={{
            ...s.card,
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "space-between",
          }}
        >
          <span style={s.muted}>The QuickCSS plugin is paused.</span>
          <button
            type="button"
            style={s.navButton}
            onClick={() => void plugins.enable("QuickCSS").then(refresh)}
          >
            Enable plugin
          </button>
        </div>
      )}
      <label
        className="vs-setting-row"
        style={{ cursor: "pointer", paddingTop: 0, marginBottom: 22 }}
      >
        <div style={{ flex: 1 }}>
          <strong>Custom styling</strong>
          <p>Your changes are saved automatically.</p>
        </div>
        <input
          type="checkbox"
          aria-label="Enable custom styling"
          checked={snapshot.customCss.enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
          }}
        />
      </label>
      <div className="vs-editor">
        <div className="vs-editor-toolbar">
          <span style={{ color: "#C5BAF8" }}>{"{ }"}</span>
          <span>custom.css</span>
          <span>{live ? "● Applied live" : "○ Not applied"}</span>
        </div>
        <CssEditor value={text} onChange={setTextLive} />
      </div>
      <div style={{ ...s.row, marginTop: 14, justifyContent: "space-between" }}>
        <span style={{ ...s.muted, fontSize: 10 }}>
          {text.split("\n").length} lines{" "}
          <span style={{ margin: "0 7px" }}>·</span> CSS{" "}
          <span style={{ margin: "0 7px" }}>·</span> Ctrl+F to find
        </span>
        {!text && (
          <button
            type="button"
            style={{
              ...s.navButton,
              padding: "6px 11px",
              fontSize: 10,
              marginLeft: "auto",
            }}
            onClick={() =>
              setTextLive(
                "/* Your space. Your styles. */\n\n:root {\n  --text-link: #c5baf8;\n}\n",
              )
            }
          >
            Insert starter
          </button>
        )}
        <button
          type="button"
          style={{ ...s.navButton, padding: "6px 11px", fontSize: 10 }}
          onClick={clear}
        >
          Clear editor
        </button>
      </div>
    </section>
  );
}
