// @vestra/core UI — Plugins page.
// Phase 5. Search plugins, enable/disable, description + authors, per-plugin
// settings, plugin errors inline. Spec: plugin_settings_requirements.

import { useMemo, useState } from "react";
import { useRefreshCounter } from "./hooks.js";
import { VestraErrorBoundary } from "./ErrorBoundary.js";
import { PluginCard } from "./PluginCard.js";
import { matchesQuery, s } from "./theme.js";
import type { PageProps } from "./types.js";

export function PluginsPage({ plugins, settings }: PageProps): JSX.Element {
  const [query, setQuery] = useState("");
  const { rev, refresh } = useRefreshCounter();

  const entries = useMemo(() => plugins.list(), [plugins, rev]);
  const filtered = useMemo(
    () => entries.filter((e) => matchesQuery(e, query)),
    [entries, query],
  );
  const enabledCount = entries.filter((e) => e.enabled).length;

  return (
    <section data-vestra-page="plugins">
      <div style={s.header}>
        <h2 style={s.title}>Plugins</h2>
        <p style={s.subtitle}>
          {enabledCount}/{entries.length} enabled
        </p>
      </div>
      <input
        style={{ ...s.input, marginBottom: 12 }}
        value={query}
        placeholder="Search plugins…"
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        aria-label="Search plugins"
      />
      {filtered.length === 0 ? (
        <p style={s.muted}>
          {entries.length === 0 ? "No plugins registered." : "No plugins match your search."}
        </p>
      ) : (
        filtered.map((entry) => (
          <VestraErrorBoundary key={entry.definition.name} label={entry.definition.name}>
            <PluginCard
              entry={entry}
              plugins={plugins}
              settings={settings}
              onChanged={refresh}
            />
          </VestraErrorBoundary>
        ))
      )}
    </section>
  );
}
