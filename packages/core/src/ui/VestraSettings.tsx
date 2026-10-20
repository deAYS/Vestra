import { useEffect, useRef, useState } from "react";
import { VESTRA_BRANDING } from "@vestra/shared";
import { VestraErrorBoundary } from "./ErrorBoundary.js";
import { AboutPage } from "./AboutPage.js";
import { PluginsPage } from "./PluginsPage.js";
import { QuickCssPage } from "./QuickCssPage.js";
import { SettingsHomePage } from "./SettingsHomePage.js";
import { ThemesPage } from "./ThemesPage.js";
import { s, vs } from "./theme.js";
import { BrandMark, Icon } from "./Brand.js";
import { ensureSettingsDesign } from "./design.js";
import { useSettingsSnapshot } from "./hooks.js";
import { DEFAULT_OVERLAY_KEYBIND, parseCombo } from "./keybind.js";
import type { PageProps, SettingsPageId } from "./types.js";

export const SETTINGS_PAGES: ReadonlyArray<{ id: SettingsPageId; label: string }> = [
  { id: "settings", label: "Overview" },
  { id: "plugins", label: "Plugins" },
  { id: "themes", label: "Themes" },
  { id: "quickcss", label: "QuickCSS" },
  { id: "about", label: "About Vestra" },
];

export function VestraSettingsPanel({
  settings,
  plugins,
  version,
  initialPage = "settings",
}: PageProps & { initialPage?: SettingsPageId }): JSX.Element {
  const [page, setPage] = useState<SettingsPageId>(initialPage);
  const content = useRef<HTMLDivElement>(null);
  useEffect(ensureSettingsDesign, []);
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [page]);
  const snapshot = useSettingsSnapshot(settings);
  const savedCombo = snapshot.plugins["Vestra"]?.settings["overlayKeybind"];
  const shortcut = typeof savedCombo === "string" && parseCombo(savedCombo) ? savedCombo : DEFAULT_OVERLAY_KEYBIND;
  const icons = { settings: "home", plugins: "plugins", themes: "themes", quickcss: "code", about: "info" } as const;

  return (
    <div
      style={s.page}
      className="vs-settings-root"
      data-vestra-root={VESTRA_BRANDING.cssPrefix}
    >
      <aside className="vs-settings-sidebar">
        <div className="vs-settings-brand"><BrandMark size={35} /><span className="vs-settings-wordmark">vestra</span></div>
        <p className="vs-nav-caption">Your workspace</p>
      <nav className={vs.nav} aria-label="Vestra settings pages">
        {SETTINGS_PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-label={p.label}
            title={p.label}
            onClick={() => {
              setPage(p.id);
            }}
            aria-current={page === p.id ? "page" : undefined}
          >
            <Icon name={icons[p.id]} size={17} /><span>{p.label}</span>
          </button>
        ))}
      </nav>
      <div className="vs-sidebar-bottom"><span>Your Discord. Your rules.</span>v{version}<br/>{shortcut.split("+").map((key,index)=><kbd key={index} style={{marginRight:3}}>{key}</kbd>)} to toggle</div>
      </aside>
      <div className="vs-settings-content" ref={content}>
      <div className="vs-content-eyebrow">Workspace <span>/</span> <span>{SETTINGS_PAGES.find(p => p.id === page)?.label}</span></div>
      <VestraErrorBoundary key={page} label={`Page:${page}`}>
        {page === "settings" ? (
          <SettingsHomePage settings={settings} plugins={plugins} version={version} onNavigate={setPage} />
        ) : null}
        {page === "plugins" ? (
          <PluginsPage settings={settings} plugins={plugins} version={version} />
        ) : null}
        {page === "themes" ? (
          <ThemesPage settings={settings} plugins={plugins} version={version} />
        ) : null}
        {page === "quickcss" ? (
          <QuickCssPage settings={settings} plugins={plugins} version={version} />
        ) : null}
        {page === "about" ? (
          <AboutPage settings={settings} plugins={plugins} version={version} />
        ) : null}
      </VestraErrorBoundary>
      </div>
    </div>
  );
}
