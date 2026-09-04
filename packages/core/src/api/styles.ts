// @vestra/core — Styles API.
// Phase 4. Safe CSS injection where every injection is removable.
// `Styles.inject(id, css)` creates or updates a single `<style>` element per id,
// `Styles.remove(id)` takes it back out, `Styles.clear()` removes everything
// Vestra manages. Works degraded without a DOM (Bun/Node): css is still
// tracked in memory so `has`/`get`/`list` behave, DOM errors are captured via
// Logger and never thrown. Validation errors (empty id, non-string css) throw
// because they are programmer bugs.

import { VESTRA_BRANDING } from "@vestra/shared";
import { Logger, type ScopedLogger } from "./logger.js";

/** Tag placed on every Vestra-managed `<style>` element: `data-vestra-style="<id>"`. */
export const STYLE_DATA_ATTRIBUTE = `${VESTRA_BRANDING.dataAttributePrefix}style` as const;

/** Element id prefix for Vestra-managed style elements (`vs-<sanitized-id>`). */
export const STYLE_ELEMENT_PREFIX = VESTRA_BRANDING.cssPrefix;

/** Minimal style-element surface. Real DOM elements satisfy this structurally. */
export interface ManagedStyleElement {
  textContent: string | null;
  remove(): void;
}

/** Minimal document surface needed for injection. Real `document` satisfies this. */
export interface StyleDocument {
  head?: { appendChild(node: unknown): unknown } | undefined;
  createElement(tag: string): ManagedStyleElement & Record<string, unknown>;
  querySelector?(selector: string): (ManagedStyleElement & Record<string, unknown>) | null;
}

export interface StylesManagerOptions {
  logger?: ScopedLogger;
  /** Override document resolution (tests, alternate renderers). */
  getDocument?: () => StyleDocument | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveDocument(): StyleDocument | undefined {
  try {
    const doc = (globalThis as Record<string, unknown>)["document"];
    if (!isRecord(doc) || typeof doc["createElement"] !== "function") return undefined;
    return doc as unknown as StyleDocument;
  } catch {
    return undefined;
  }
}

/** Make an id safe for use as an element `id` attribute. Lookup still uses the raw id. */
export function sanitizeStyleId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, "-");
  return `${STYLE_ELEMENT_PREFIX}${cleaned === "" ? "style" : cleaned}`;
}

function setAttribute(el: Record<string, unknown>, name: string, value: string): void {
  const fn = el["setAttribute"];
  if (typeof fn === "function") {
    (fn as (n: string, v: string) => unknown).call(el, name, value);
  }
}

export class StylesManager {
  private readonly cssById = new Map<string, string>();
  private readonly elements = new Map<string, ManagedStyleElement>();
  private readonly logger: ScopedLogger;
  private readonly getDocument: () => StyleDocument | undefined;

  constructor(options?: StylesManagerOptions) {
    this.logger = options?.logger ?? Logger.extend("Styles");
    this.getDocument = options?.getDocument ?? resolveDocument;
  }

  /**
   * Inject css under `id`, creating or updating a single `<style>` element.
   * Empty css removes the injection instead (keeps the DOM clean).
   * Throws on invalid id/css; DOM failures are captured, never thrown.
   */
  inject(id: string, css: string): void {
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error("Styles.inject() requires a non-empty id.");
    }
    if (typeof css !== "string") {
      throw new Error("Styles.inject() requires css to be a string.");
    }
    if (css === "") {
      this.remove(id);
      return;
    }
    this.cssById.set(id, css);
    let doc: StyleDocument | undefined;
    try {
      doc = this.getDocument();
    } catch (err: unknown) {
      this.logger.captureError(err, "Styles.getDocument");
      return;
    }
    if (doc === undefined) {
      this.logger.debug(`Styles: no document — tracking "${id}" in memory only.`);
      return;
    }
    try {
      const existing = this.elements.get(id) ?? this.adoptExisting(doc, id);
      if (existing !== undefined) {
        existing.textContent = css;
        return;
      }
      const el = doc.createElement("style");
      setAttribute(el as unknown as Record<string, unknown>, "type", "text/css");
      setAttribute(el as unknown as Record<string, unknown>, STYLE_DATA_ATTRIBUTE, id);
      setAttribute(el as unknown as Record<string, unknown>, "id", sanitizeStyleId(id));
      el.textContent = css;
      if (doc.head === undefined || typeof doc.head.appendChild !== "function") {
        this.logger.warn(`Styles: document has no head — tracking "${id}" in memory only.`);
        return;
      }
      doc.head.appendChild(el);
      this.elements.set(id, el);
    } catch (err: unknown) {
      this.logger.captureError(err, `Styles.inject "${id}"`);
    }
  }

  /** Remove the injection for `id`. Idempotent — missing ids are a no-op, never throw. */
  remove(id: string): void {
    this.cssById.delete(id);
    const tracked = this.elements.get(id);
    if (tracked !== undefined) {
      this.elements.delete(id);
      try {
        tracked.remove();
      } catch (err: unknown) {
        this.logger.captureError(err, `Styles.remove "${id}"`);
      }
      return;
    }
    // Not placed by this instance — best effort: drop a matching element if the
    // document has one (e.g. placed before reload or by another instance).
    try {
      const doc = this.getDocument();
      const adopted = doc === undefined ? undefined : this.adoptExisting(doc, id);
      adopted?.remove();
      if (adopted !== undefined) this.elements.delete(id);
    } catch (err: unknown) {
      this.logger.captureError(err, `Styles.remove "${id}"`);
    }
  }

  /** Remove every Vestra-managed injection. Individual failures never block the rest. */
  clear(): void {
    for (const id of [...this.cssById.keys(), ...this.elements.keys()]) {
      try {
        this.remove(id);
      } catch (err: unknown) {
        this.logger.captureError(err, `Styles.clear "${id}"`);
      }
    }
    this.cssById.clear();
    this.elements.clear();
  }

  has(id: string): boolean {
    return this.cssById.has(id);
  }

  get(id: string): string | undefined {
    return this.cssById.get(id);
  }

  list(): readonly string[] {
    return [...new Set([...this.cssById.keys(), ...this.elements.keys()])];
  }

  private adoptExisting(
    doc: StyleDocument,
    id: string,
  ): ManagedStyleElement | undefined {
    if (typeof doc.querySelector !== "function") return undefined;
    try {
      const found = doc.querySelector(
        `style[${STYLE_DATA_ATTRIBUTE}="${id.replace(/"/g, "")}"]`,
      );
      if (found === null) return undefined;
      this.elements.set(id, found);
      if (!this.cssById.has(id) && typeof found.textContent === "string") {
        this.cssById.set(id, found.textContent);
      }
      return found;
    } catch {
      return undefined;
    }
  }
}

/** Default shared manager used by the renderer runtime and plugins. */
export const Styles = new StylesManager();

/** Create an isolated manager (tests, alternate documents). */
export function createStylesManager(options?: StylesManagerOptions): StylesManager {
  return new StylesManager(options);
}
