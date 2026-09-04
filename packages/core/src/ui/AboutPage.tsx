// @vestra/core UI — About page.
// Phase 5. Branding + build facts. Satisfies the 0.0.1 DoD row "Vestra
// branding appears in the console and settings UI" on the UI side.

import { VESTRA_BRANDING, VESTRA_STORAGE_KEY } from "@vestra/shared";
import { s } from "./theme.js";
import type { PageProps } from "./types.js";

export function AboutPage({ plugins, version }: PageProps): JSX.Element {
  const total = plugins.list().length;
  const enabled = plugins.list().filter((p) => p.enabled).length;
  return (
    <section data-vestra-page="about">
      <div style={s.header}>
        <h2 style={s.title}>{VESTRA_BRANDING.name}</h2>
        <p style={s.subtitle}>{VESTRA_BRANDING.tagline}</p>
      </div>
      <div style={s.card} className="vs-about-card">
        <div>
          Version <span style={s.code}>v{version}</span>
        </div>
        <div style={{ marginTop: 6 }}>
          Plugins <span style={s.code}>{enabled}/{total} enabled</span>
        </div>
        <div style={{ marginTop: 6 }}>
          Storage <span style={s.code}>{VESTRA_STORAGE_KEY}</span>
        </div>
      </div>
    </section>
  );
}
