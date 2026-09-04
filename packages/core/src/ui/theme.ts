// @vestra/core UI — shared inline styles + formatting.
// Phase 5. Inline styles keep the UI dependency-free (no SCSS pipeline in the
// IIFE bundle yet); every root also carries a `vs-*` class and `data-vestra-*`
// attribute so themes can target them later.

import type { CSSProperties } from "react";
import { VESTRA_COLORS } from "@vestra/shared";

export const vs = {
  page: "vs-settings-page",
  nav: "vs-settings-nav",
  card: "vs-plugin-card",
} as const;

export const s: Record<string, CSSProperties> = {
  page: {
    background: VESTRA_COLORS.background,
    color: VESTRA_COLORS.text,
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
    padding: 16,
    maxWidth: 720,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: 700, margin: 0 },
  subtitle: { color: VESTRA_COLORS.mutedText, margin: 0 },
  nav: { display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" },
  navButton: {
    background: VESTRA_COLORS.surface2,
    color: VESTRA_COLORS.text,
    border: `1px solid ${VESTRA_COLORS.border}`,
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
  },
  navButtonActive: {
    background: VESTRA_COLORS.primary,
    color: VESTRA_COLORS.text,
    border: `1px solid ${VESTRA_COLORS.primaryHover}`,
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
  },
  card: {
    background: VESTRA_COLORS.surface,
    border: `1px solid ${VESTRA_COLORS.border}`,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  row: { display: "flex", alignItems: "center", gap: 8 },
  input: {
    background: VESTRA_COLORS.surface2,
    color: VESTRA_COLORS.text,
    border: `1px solid ${VESTRA_COLORS.border}`,
    borderRadius: 6,
    padding: "6px 8px",
    width: "100%",
    boxSizing: "border-box",
  },
  textarea: {
    background: VESTRA_COLORS.surface2,
    color: VESTRA_COLORS.text,
    border: `1px solid ${VESTRA_COLORS.border}`,
    borderRadius: 6,
    padding: 8,
    width: "100%",
    boxSizing: "border-box",
    minHeight: 160,
    fontFamily: "monospace",
    fontSize: 12,
  },
  button: {
    background: VESTRA_COLORS.primary,
    color: VESTRA_COLORS.text,
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
  },
  dangerButton: {
    background: "transparent",
    color: "#ff8080",
    border: "1px solid #ff8080",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
  },
  muted: { color: VESTRA_COLORS.mutedText },
  errorBox: {
    background: "#2a1215",
    color: "#ffb4b4",
    border: "1px solid #7a2e2e",
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  code: {
    fontFamily: "monospace",
    fontSize: 12,
    background: VESTRA_COLORS.surface2,
    padding: "2px 6px",
    borderRadius: 4,
  },
};

/** Render-safe one-line message for unknown thrown values. Never throws. */
export function formatError(err: unknown): string {
  try {
    if (err instanceof Error) return err.message === "" ? err.name : err.message;
    if (typeof err === "string") return err;
    return JSON.stringify(err) ?? String(err);
  } catch {
    return "Unknown error";
  }
}

/** Case-insensitive plugin search across name, description and authors. */
export function matchesQuery(
  entry: { definition: { name: string; description: string; authors: readonly string[] } },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    entry.definition.name.toLowerCase().includes(q) ||
    entry.definition.description.toLowerCase().includes(q) ||
    entry.definition.authors.some((a) => a.toLowerCase().includes(q))
  );
}
