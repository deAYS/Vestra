import { useRef, useState } from "react";
import {
  applyThemePreset,
  importTheme,
  refreshLocalThemes,
  THEME_LIBRARY,
} from "../themes.js";
import { Native } from "../api/native.js";
import { AddonFolder } from "./AddonFolder.js";
import type { Theme } from "../api/settings.js";
import { useSettingsSnapshot } from "./hooks.js";
import { s } from "./theme.js";
import { Icon } from "./Brand.js";
import type { PageProps } from "./types.js";

function ThemePreview({ colors }: { colors: readonly string[] }): JSX.Element {
  return (
    <div
      className="vs-theme-art"
      style={{
        background: `radial-gradient(ellipse at 70% 10%,${colors[2]}25,transparent),${colors[0]}`,
      }}
      aria-hidden="true"
    >
      <div className="vs-mini-client" style={{ background: colors[1] }}>
        <div className="vs-mini-rail">
          <i style={{ background: colors[2] }} />
          <i />
          <i />
          <i />
        </div>
        <div className="vs-mini-channels">
          <i style={{ background: colors[2], width: "70%" }} />
          <i />
          <i style={{ width: "65%" }} />
          <i />
          <i style={{ width: "80%" }} />
        </div>
        <div className="vs-mini-chat">
          {[0, 1, 2].map((row) => (
            <div className="vs-mini-message" key={row}>
              <b
                style={{
                  background: row === 1 ? "#FFFFFF22" : colors[2],
                  opacity: row === 2 ? 0.6 : 1,
                }}
              />
              <div>
                <i style={{ width: "32%", background: colors[2] }} />
                <i style={{ width: row === 1 ? "60%" : "100%" }} />
                <i style={{ width: row === 2 ? "45%" : "75%" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ThemesPage({ settings }: PageProps): JSX.Element {
  const { themes } = useSettingsSnapshot(settings);
  const persistence = settings.getPersistenceStatus();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const filesAvailable =
    Native.isAvailable() &&
    Native.getCapabilities().includes("addons:readThemes");
  const remove = async (theme: Theme): Promise<void> => {
    setPending(true);
    try {
      if (theme.sourceFile) await Native.removeThemeFile(theme.sourceFile);
      settings.setThemes(
        settings.getThemes().filter((entry) => entry.id !== theme.id),
      );
      setError("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setPending(false);
    }
  };
  const saveFile = async (theme: Theme): Promise<void> => {
    setPending(true);
    try {
      const name =
        theme.name
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
          .replace(/\.\./g, "-")
          .slice(0, 90) || "theme";
      const sourceFile = await Native.writeThemeFile(
        `${name}.theme.css`,
        theme.css,
      );
      settings.setThemes(
        settings
          .getThemes()
          .map((entry) =>
            entry.id === theme.id ? { ...entry, sourceFile } : entry,
          ),
      );
      setError("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setPending(false);
    }
  };
  const saveSelection = async (change: () => void): Promise<void> => {
    setPending(true);
    try {
      change();
      await settings.flush();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <section data-vestra-page="themes">
      {persistence.error || persistence.backend === "memory" ? (
        <p role="alert" style={s.errorBox}>
          Preferences are not saved to disk.{" "}
          {persistence.error ?? "Only temporary memory storage is available."}
        </p>
      ) : null}
      <div style={{ ...s.header, position: "relative", paddingRight: 60 }}>
        <h2 style={s.title}>Themes</h2>
        <p style={s.subtitle}>A different atmosphere. Still your Discord.</p>
      </div>
      <AddonFolder
        kind="themes"
        pending={pending}
        refresh={() => refreshLocalThemes(settings)}
      />
      <div className="vs-collection-bar">
        <h3>Curated for Vestra</h3>
        <span>04 collections</span>
      </div>
      <div className="vs-theme-grid">
        {THEME_LIBRARY.map((preset) => {
          const active = themes.some(
            (theme) => theme.css === preset.css && theme.enabled,
          );
          return (
            <article
              className="vs-theme-card"
              key={preset.name}
              data-active={active}
            >
              <ThemePreview colors={preset.colors} />
              <div className="vs-theme-card-content">
                <div className="vs-theme-card-top">
                  <strong>{preset.name.replace("Vestra ", "")}</strong>
                  {active && (
                    <span style={{ color: "#C5BAF8", display: "flex" }}>
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </div>
                <p>{preset.description}</p>
                <div className="vs-theme-action">
                  <span>
                    {preset.colors.map((color) => (
                      <i
                        className="vs-theme-swatch"
                        key={color}
                        style={{ background: color }}
                      />
                    ))}
                    <span style={{ marginLeft: 4 }}>by Vestra</span>
                  </span>
                  <button
                    type="button"
                    style={active ? s.button : s.navButton}
                    disabled={pending || (active && !persistence.error)}
                    aria-label={`${active && !persistence.error ? (pending ? "Saving" : "Applied") : "Apply"} ${preset.name}`}
                    onClick={() =>
                      void saveSelection(() =>
                        applyThemePreset(settings, preset),
                      )
                    }
                  >
                    {active && pending
                      ? "Saving…"
                      : active && !persistence.error
                        ? "Applied"
                        : "Apply theme"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <div className="vs-collection-bar" style={{ marginTop: 30 }}>
        <h3>
          Your library{" "}
          <span style={{ color: "#6F647C", marginLeft: 5 }}>
            {themes.length}
          </span>
        </h3>
        <button
          type="button"
          style={{
            ...s.navButton,
            padding: "7px 10px",
            fontSize: 10,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
          disabled={pending}
          onClick={() => input.current?.click()}
        >
          <Icon name="upload" size={12} />
          Import CSS
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".css,text/css"
        aria-label="Choose CSS theme"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setPending(true);
          try {
            if (!file.name.toLowerCase().endsWith(".css"))
              throw new Error("Choose a .css file.");
            if (file.size > 512_000)
              throw new Error("Themes must be smaller than 512 KB.");
            if (settings.getThemes().length >= 32)
              throw new Error("Your library is full (32 themes).");
            const css = await file.text();
            if (!css.trim()) throw new Error("The theme file is empty.");
            if (filesAvailable) {
              await Native.writeThemeFile(file.name, css);
              await refreshLocalThemes(settings);
            } else importTheme(settings, css, file.name);
            setError("");
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setPending(false);
          }
        }}
      />
      {error && (
        <p role="alert" style={s.errorBox}>
          {error}
        </p>
      )}
      {!themes.length && (
        <div className="vs-empty">
          Your next favorite look belongs here.
          <br />
          <span style={{ fontSize: 10 }}>
            Apply a collection above or bring your own CSS.
          </span>
        </div>
      )}
      {themes.map((theme) => (
        <div
          key={theme.id}
          className="vs-theme-installed"
          data-vestra-theme={theme.id}
        >
          <span className="vs-plugin-glyph">
            <Icon name="themes" size={16} />
          </span>
          <div>
            <strong>{theme.name}</strong>
            <p>
              {theme.author} <span style={{ margin: "0 5px" }}>·</span>
              {theme.enabled
                ? pending
                  ? "Saving…"
                  : persistence.error
                    ? "Save failed"
                    : "Active"
                : "Ready to apply"}
            </p>
          </div>
          <input
            type="checkbox"
            checked={theme.enabled}
            disabled={pending}
            aria-label={`Enable ${theme.name}`}
            onChange={() =>
              void saveSelection(() =>
                settings.activateTheme(theme.enabled ? null : theme.id),
              )
            }
          />
          {!theme.sourceFile && filesAvailable && (
            <button
              type="button"
              disabled={pending}
              style={{ fontSize: 10 }}
              aria-label={`Save ${theme.name} to theme folder`}
              onClick={() => void saveFile(theme)}
            >
              Save file
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            title={
              theme.sourceFile
                ? "Move theme file to Trash"
                : "Remove from library"
            }
            aria-label={`Remove ${theme.name}`}
            onClick={() => void remove(theme)}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </section>
  );
}
