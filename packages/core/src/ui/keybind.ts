export const DEFAULT_OVERLAY_KEYBIND = "Ctrl+Shift+V";

export interface KeyEventLike {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  key: string;
}

export interface ParsedCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

/** Normalize a KeyboardEvent into a combo string. Returns "" when unusable. */
export function formatCombo(event: KeyEventLike): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  const key = normalizeKey(event.key);
  if (key === "") return "";
  parts.push(key);
  return parts.join("+");
}

/** True when the combo is safe to bind (modifier or function key present). */
export function isBindable(combo: string): boolean {
  const parsed = parseCombo(combo);
  if (parsed === undefined) return false;
  if (parsed.ctrl || parsed.shift || parsed.alt || parsed.meta) return true;
  return /^F\d{1,2}$/.test(parsed.key);
}

/** Parse "Ctrl+Shift+V" back into parts. Undefined when malformed. */
export function parseCombo(combo: string): ParsedCombo | undefined {
  if (typeof combo !== "string") return undefined;
  const parts = combo
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return undefined;
  const key = parts[parts.length - 1] as string;
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  if (mods.size !== parts.length - 1) return undefined;
  for (const m of mods) {
    if (m !== "ctrl" && m !== "shift" && m !== "alt" && m !== "meta")
      return undefined;
  }
  if (key === "" || key.includes("+")) return undefined;
  return {
    ctrl: mods.has("ctrl"),
    shift: mods.has("shift"),
    alt: mods.has("alt"),
    meta: mods.has("meta"),
    key,
  };
}

/** True when a keydown matches the combo (case-insensitive key). */
export function comboMatches(combo: string, event: KeyEventLike): boolean {
  const parsed = parseCombo(combo);
  if (parsed === undefined) return false;
  if (parsed.ctrl !== event.ctrlKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.meta !== event.metaKey) return false;
  return normalizeKey(event.key).toLowerCase() === parsed.key.toLowerCase();
}

export function combosEqual(left: string, right: string): boolean {
  const parsed = parseCombo(right);
  return (
    parsed !== undefined &&
    comboMatches(left, {
      key: parsed.key,
      ctrlKey: parsed.ctrl,
      altKey: parsed.alt,
      shiftKey: parsed.shift,
      metaKey: parsed.meta,
    })
  );
}

function normalizeKey(key: string): string {
  if (typeof key !== "string" || key === "") return "";
  if (["Dead", "Process", "Unidentified"].includes(key)) return "";
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (/^F\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";
  return key.length > 12 ? "" : key;
}
