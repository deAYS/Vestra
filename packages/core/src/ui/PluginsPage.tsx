import { useEffect, useMemo, useState } from "react";
import { useRefreshCounter } from "./hooks.js";
import { VestraErrorBoundary } from "./ErrorBoundary.js";
import { PluginCard } from "./PluginCard.js";
import { matchesQuery, s } from "./theme.js";
import type { PageProps } from "./types.js";
import { Icon } from "./Brand.js";

export function PluginsPage({ plugins, settings }: PageProps): JSX.Element {
  const [query, setQuery] = useState("");
  const { rev, refresh } = useRefreshCounter();
  useEffect(() => plugins.subscribe?.(refresh), [plugins, refresh]);

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
        <p style={s.subtitle}>Useful additions for the way you use Discord.</p>
      </div>
      <div className="vs-search"><Icon name="search" size={15}/>
      <input
        style={s.input}
        value={query}
        placeholder="Search plugins…"
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        aria-label="Search plugins"
      />
      </div>
      <div className="vs-collection-bar"><h3>Your plugins</h3><span>{enabledCount} of {entries.length} enabled</span></div>
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
