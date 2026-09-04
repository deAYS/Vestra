// @vestra/core UI — settings shell.
// Phase 5. Tab navigation across the five spec pages. Each page renders inside
// its own error boundary so one bad page never blanks the whole panel.

import { useState } from "react";
import { VESTRA_BRANDING } from "@vestra/shared";
import { VestraErrorBoundary } from "./ErrorBoundary.js";
import { AboutPage } from "./AboutPage.js";
import { PluginsPage } from "./PluginsPage.js";
import { QuickCssPage } from "./QuickCssPage.js";
import { SettingsHomePage } from "./SettingsHomePage.js";
import { ThemesPage } from "./ThemesPage.js";
import { s, vs } from "./theme.js";
import type { PageProps, SettingsPageId } from "./types.js";

export const SETTINGS_PAGES: ReadonlyArray<{ id: SettingsPageId; label: string }> = [
  { id: "settings", label: "Vestra Settings" },
  { id: "plugins", label: "Plugins" },
  { id: "themes", label: "Themes" },
  { id: "quickcss", label: "QuickCSS" },
  { id: "about", label: "About" },
];

export function VestraSettingsPanel({
  settings,
  plugins,
  version,
  initialPage = "settings",
}: PageProps & { initialPage?: SettingsPageId }): JSX.Element {
  const [page, setPage] = useState<SettingsPageId>(initialPage);

  return (
    <div
      style={s.page}
      className="vs-settings-root"
      data-vestra-root={VESTRA_BRANDING.cssPrefix}
    >
      <nav style={s.nav} className={vs.nav} aria-label="Vestra settings pages">
        {SETTINGS_PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            style={page === p.id ? s.navButtonActive : s.navButton}
            onClick={() => {
              setPage(p.id);
            }}
            aria-current={page === p.id ? "page" : undefined}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <VestraErrorBoundary label={`Page:${page}`}>
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
  );
}
