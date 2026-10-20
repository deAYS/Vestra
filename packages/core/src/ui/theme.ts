import type { CSSProperties } from "react";

export const palette = { bg: "var(--vs-bg,#17161C)", sidebar: "var(--vs-sidebar,#121116)", surface: "var(--vs-surface,#1E1D25)", border: "var(--vs-border,#302E39)", text: "var(--vs-text,#F2F0F7)", muted: "var(--vs-muted,#9894A6)", accent: "var(--vs-accent,#C5BAF8)" };
export const vs = { page: "vs-settings-page", nav: "vs-settings-nav", card: "vs-plugin-card" } as const;

export const s: Record<string, CSSProperties> = {
  page: { color: palette.text, fontFamily: '"Inter","gg sans","Segoe UI",sans-serif', fontSize: 14, lineHeight: 1.55 },
  header: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 7, marginBottom: 26 },
  title: { fontSize: 27, fontWeight: 650, letterSpacing: "-.035em", lineHeight: 1.2, margin: 0, color: palette.text },
  subtitle: { color: palette.muted, fontSize: 13, margin: 0, lineHeight: 1.6 },
  nav: { display: "flex", flexDirection: "column", gap: 5 },
  navButton: { background: "var(--vs-control,#25232D)", color: palette.text, border: `1px solid ${palette.border}`, borderRadius: 9, padding: "9px 14px", cursor: "pointer", fontSize: 12, fontWeight: 500, lineHeight: "18px" },
  navButtonActive: { background: "#C5BAF814", color: palette.accent, border: "1px solid #C5BAF81A", borderRadius: 9, padding: "9px 14px", cursor: "pointer" },
  card: { background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: 13, padding: 20, marginBottom: 12 },
  row: { display: "flex", alignItems: "center", gap: 10 },
  input: { background: "#121116", color: palette.text, border: `1px solid ${palette.border}`, borderRadius: 9, padding: "11px 13px", width: "100%", boxSizing: "border-box", fontSize: 13, lineHeight: "20px", outlineOffset: 3 },
  textarea: { background: "#121116", color: "#D9D1F6", border: `1px solid ${palette.border}`, borderRadius: 12, padding: 20, width: "100%", boxSizing: "border-box", minHeight: 300, resize: "vertical", fontFamily: '"Cascadia Code","SFMono-Regular",Consolas,monospace', fontSize: 13, lineHeight: 1.9, tabSize: 2, outlineOffset: 3 },
  button: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: palette.accent, color: "#211B36", border: "1px solid transparent", borderRadius: 9, padding: "10px 16px", cursor: "pointer", fontSize: 12, fontWeight: 650, lineHeight: "18px" },
  dangerButton: { background: "#F097A409", color: "#E7A4AE", border: "1px solid #F097A423", borderRadius: 9, padding: "9px 14px", cursor: "pointer", fontSize: 12, lineHeight: "18px" },
  muted: { color: palette.muted, fontSize: 13, lineHeight: 1.65 },
  errorBox: { background: "#E78E9D0A", color: "#F3BAC3", border: "1px solid #E78E9D30", borderRadius: 10, padding: 12, marginTop: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 },
  code: { fontFamily: '"Cascadia Code",Consolas,monospace', fontSize: 11, background: "#FFFFFF06", color: "#C8C1D8", border: "1px solid #FFFFFF09", padding: "4px 8px", borderRadius: 6 },
};

export function formatError(err: unknown): string {
  try {
    if (err instanceof Error) return err.message === "" ? err.name : err.message;
    if (typeof err === "string") return err;
    return JSON.stringify(err) ?? String(err);
  } catch { return "Unknown error"; }
}

export function matchesQuery(entry: { definition: { name: string; description: string; authors: readonly string[] } }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || entry.definition.name.toLowerCase().includes(q) || entry.definition.description.toLowerCase().includes(q) || entry.definition.authors.some(author => author.toLowerCase().includes(q));
}
