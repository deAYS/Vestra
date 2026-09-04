// @vestra/core UI — Themes page.
// Phase 5. ThemeManager (enable/disable/manage themes) lands with the 0.1.0
// milestones; this page is an honest empty state, not fake functionality.

import { s } from "./theme.js";
import type { PageProps } from "./types.js";

export function ThemesPage(_props: PageProps): JSX.Element {
  return (
    <section data-vestra-page="themes">
      <div style={s.header}>
        <h2 style={s.title}>Themes</h2>
        <p style={s.subtitle}>0 installed</p>
      </div>
      <p style={s.muted}>
        Theme management (install, enable, disable) arrives with the ThemeManager
        built-in. Custom styling is available today via QuickCSS.
      </p>
    </section>
  );
}
