// @vestra/core UI — overlay controller, host + settings panel shell.
// Always renders the toast stack; renders the settings panel when the
// controller is open. Backdrop click and Escape close. Panel CSS (entrance
// animations included) is injected once through the Styles API. `mountOverlay`
// renders the host into a dedicated root div; `startOverlayShortcuts` toggles
// it on the user's keybind. Everything degrades without a DOM.

import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Logger } from "../api/logger.js";
import type { SettingsStore } from "../api/settings.js";
import { Styles } from "../api/styles.js";
import { Toasts } from "../api/toasts.js";
import { ToastsView } from "./Toasts.js";
import { VestraSettingsPanel } from "./VestraSettings.js";
import { DEFAULT_OVERLAY_KEYBIND, comboMatches, isBindable, parseCombo } from "./keybind.js";
import type { PageProps, VestraUIDeps } from "./types.js";

export const OVERLAY_ROOT_ID = "vestra-overlay-root";
const KEYBIND_SETTING_KEY = "overlayKeybind";

export type OverlayListener = (open: boolean) => void;

export interface OverlayController {
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  subscribe(listener: OverlayListener): () => void;
}

export function createOverlayController(): OverlayController {
  let open = false;
  const listeners = new Set<OverlayListener>();
  const emit = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener(open);
      } catch (err: unknown) {
        Logger.captureError(err, "Overlay.subscribe");
      }
    }
  };
  return {
    isOpen: () => open,
    open: () => {
      if (open) return;
      open = true;
      emit();
    },
    close: () => {
      if (!open) return;
      open = false;
      emit();
    },
    toggle: () => {
      open = !open;
      emit();
    },
    subscribe: (listener: OverlayListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Shared controller used by the runtime wiring (tests make their own). */
export const overlayController = createOverlayController();

/** Read the active keybind combo, falling back to the default when unset/invalid. */
export function getOverlayKeybind(settings: SettingsStore): string {
  try {
    const raw = settings.getPluginSetting("Vestra", KEYBIND_SETTING_KEY);
    if (typeof raw === "string" && parseCombo(raw) !== undefined) return raw;
  } catch (err: unknown) {
    Logger.captureError(err, "Overlay.keybind.read");
  }
  return DEFAULT_OVERLAY_KEYBIND;
}

/** Persist the keybind combo. Throws (TypeError) when not bindable. */
export function setOverlayKeybind(settings: SettingsStore, combo: string): void {
  if (!isBindable(combo)) {
    throw new TypeError(`"${combo}" is not a safe overlay keybind (use a modifier or function key).`);
  }
  settings.setPluginSetting("Vestra", KEYBIND_SETTING_KEY, combo);
}

export interface OverlayMountDeps extends VestraUIDeps {
  controller?: OverlayController | undefined;
}

export interface ShortcutDeps {
  settings: SettingsStore;
  controller?: OverlayController | undefined;
}

/** Toggle the overlay on the user's keybind. Returns a stop function. */
export function startOverlayShortcuts(deps: ShortcutDeps): () => void {
  const noop = (): void => undefined;
  const controller = deps.controller ?? overlayController;
  try {
    const win = (globalThis as Record<string, unknown>)["window"];
    if (typeof win !== "object" || win === null) return noop;
    const target = win as unknown as {
      addEventListener(type: string, listener: (e: KeyboardEvent) => void): void;
      removeEventListener(type: string, listener: (e: KeyboardEvent) => void): void;
    };
    if (typeof target.addEventListener !== "function") return noop;
    const handler = (event: KeyboardEvent): void => {
      try {
        const combo = getOverlayKeybind(deps.settings);
        if (!comboMatches(combo, event)) return;
        event.preventDefault();
        controller.toggle();
      } catch (err: unknown) {
        Logger.captureError(err, "Overlay.shortcut");
      }
    };
    target.addEventListener("keydown", handler);
    return () => {
      try {
        target.removeEventListener("keydown", handler);
      } catch (err: unknown) {
        Logger.captureError(err, "Overlay.shortcut.stop");
      }
    };
  } catch (err: unknown) {
    Logger.captureError(err, "startOverlayShortcuts");
    return noop;
  }
}

const OVERLAY_CSS_ID = "vestra-overlay";

const OVERLAY_CSS = `
#vestra-overlay-root{position:static}
.vs-overlay-backdrop{position:fixed;inset:0;z-index:2147483645;background:rgba(3,5,9,.62);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;animation:vs-overlay-fade .2s ease-out;font-family:system-ui,sans-serif}
.vs-overlay-panel{width:min(760px,100%);max-height:min(640px,calc(100vh - 48px));display:flex;flex-direction:column;background:linear-gradient(180deg,#0d1320 0%,#0c1018 100%);border:1px solid #2a3648;border-radius:18px;box-shadow:0 32px 96px rgba(0,0,0,.7),0 0 0 1px rgba(110,168,255,.06),0 0 64px rgba(24,59,115,.35);color:#f5f7fa;overflow:hidden;animation:vs-overlay-pop .22s cubic-bezier(.21,1.02,.73,1)}
.vs-overlay-header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #202938;background:rgba(255,255,255,.015)}
.vs-overlay-logo{width:26px;height:26px;flex:none;filter:drop-shadow(0 0 10px rgba(110,168,255,.55))}
.vs-overlay-title{font-size:15px;font-weight:800;letter-spacing:.02em}
.vs-overlay-tag{font-size:11px;color:#8d96a5;border:1px solid #202938;border-radius:20px;padding:2px 9px;background:rgba(255,255,255,.03)}
.vs-overlay-hint{margin-left:auto;font-size:11px;color:#8d96a5}
.vs-overlay-hint kbd{font-family:inherit;background:#121824;border:1px solid #2a3648;border-bottom-width:2px;border-radius:5px;padding:1px 6px;font-size:10px;color:#f5f7fa}
.vs-overlay-close{width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:#8d96a5;cursor:pointer;font-size:16px;line-height:1}
.vs-overlay-close:hover{background:rgba(255,255,255,.08);color:#f5f7fa}
.vs-overlay-body{overflow-y:auto;padding:4px 18px 18px}
.vs-overlay-body::-webkit-scrollbar{width:10px}
.vs-overlay-body::-webkit-scrollbar-thumb{background:#202938;border-radius:8px;border:2px solid #0c1018}
@keyframes vs-overlay-fade{from{opacity:0}to{opacity:1}}
@keyframes vs-overlay-pop{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
`;

let cssEnsured = false;

function ensureOverlayCss(): void {
  if (cssEnsured) return;
  cssEnsured = true;
  try {
    if (!Styles.has(OVERLAY_CSS_ID)) Styles.inject(OVERLAY_CSS_ID, OVERLAY_CSS);
  } catch (err: unknown) {
    Logger.captureError(err, "Overlay.css");
  }
}

export function VestraLogo({ size = 26 }: { size?: number }): JSX.Element {
  return (
    <svg className="vs-overlay-logo" viewBox="0 0 40 48" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="vs-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6ea8ff" />
          <stop offset="1" stopColor="#20509a" />
        </linearGradient>
      </defs>
      <polygon points="4,4 20,44 36,4 27,4 20,28 13,4" fill="url(#vs-logo-g)" />
    </svg>
  );
}

interface OverlayHostProps extends PageProps {
  controller: OverlayController;
}

const roots = new WeakMap<Element, Root>();

function isElement(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { appendChild?: unknown }).appendChild === "function"
  );
}

/** Mount the overlay host (toasts always render; panel follows the controller). */
export function mountOverlay(deps: OverlayMountDeps): () => void {
  const noop = (): void => undefined;
  let doc: Document | undefined;
  try {
    const raw = (globalThis as Record<string, unknown>)["document"] as unknown as
      | { createElement?: unknown; body?: unknown; getElementById?: unknown }
      | undefined;
    if (raw === undefined || raw === null || typeof raw.createElement !== "function") return noop;
    doc = raw as unknown as Document;
  } catch {
    return noop;
  }
  if (typeof doc.body?.appendChild !== "function") {
    Logger.debug("mountOverlay() without a document body — skipping.");
    return noop;
  }
  try {
    let container = doc.getElementById(OVERLAY_ROOT_ID);
    if (container === null || container === undefined) {
      container = doc.createElement("div");
      container.id = OVERLAY_ROOT_ID;
      doc.body.appendChild(container);
    }
    if (!isElement(container)) return noop;
    const existing = roots.get(container);
    if (existing !== undefined) {
      existing.unmount();
      roots.delete(container);
    }
    const root = createRoot(container);
    roots.set(container, root);
    root.render(
      <OverlayHost
        settings={deps.settings}
        plugins={deps.plugins}
        version={deps.version}
        controller={deps.controller ?? overlayController}
      />,
    );
    return () => {
      try {
        const current = roots.get(container as Element);
        current?.unmount();
        roots.delete(container as Element);
        (container as Element).remove();
      } catch (err: unknown) {
        Logger.captureError(err, "unmountOverlay");
      }
    };
  } catch (err: unknown) {
    Logger.captureError(err, "mountOverlay");
    return noop;
  }
}

export function OverlayHost({ settings, plugins, version, controller }: OverlayHostProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(() => controller.isOpen());

  useEffect(() => {
    ensureOverlayCss();
    return controller.subscribe((next) => {
      setOpen(next);
    });
  }, [controller]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") controller.close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, controller]);

  return (
    <>
      <ToastsView manager={Toasts} />
      {open ? (
        <div
          className="vs-overlay-backdrop"
          data-vestra-overlay="open"
          onClick={(event) => {
            if (event.target === event.currentTarget) controller.close();
          }}
        >
          <div className="vs-overlay-panel" role="dialog" aria-label="Vestra settings">
            <div className="vs-overlay-header">
              <VestraLogo />
              <span className="vs-overlay-title">Vestra</span>
              <span className="vs-overlay-tag">v{version}</span>
              <span className="vs-overlay-hint">
                <kbd>Esc</kbd> to close
              </span>
              <button
                type="button"
                className="vs-overlay-close"
                onClick={() => {
                  controller.close();
                }}
                aria-label="Close settings"
              >
                ×
              </button>
            </div>
            <div className="vs-overlay-body">
              <VestraSettingsPanel settings={settings} plugins={plugins} version={version} />
            </div>
          </div>
        </div>
      ) : (
        <div data-vestra-overlay="closed" style={{ display: "none" }} />
      )}
    </>
  );
}


