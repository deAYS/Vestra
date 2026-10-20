import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Logger } from "../api/logger.js";
import type { SettingsStore } from "../api/settings.js";
import { Styles } from "../api/styles.js";
import { Toasts } from "../api/toasts.js";
import { ToastsView } from "./Toasts.js";
import { VestraSettingsPanel } from "./VestraSettings.js";
import {
  DEFAULT_OVERLAY_KEYBIND,
  comboMatches,
  isBindable,
  parseCombo,
} from "./keybind.js";
import type { PageProps, VestraUIDeps } from "./types.js";
import { BrandMark, Icon } from "./Brand.js";
import { ensureSettingsDesign } from "./design.js";
import { Launcher } from "./Launcher.js";

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
export function setOverlayKeybind(
  settings: SettingsStore,
  combo: string,
): void {
  if (!isBindable(combo)) {
    throw new TypeError(
      `"${combo}" is not a safe overlay keybind (use a modifier or function key).`,
    );
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
      addEventListener(
        type: string,
        listener: (e: KeyboardEvent) => void,
      ): void;
      removeEventListener(
        type: string,
        listener: (e: KeyboardEvent) => void,
      ): void;
    };
    if (typeof target.addEventListener !== "function") return noop;
    const handler = (event: KeyboardEvent): void => {
      try {
        if (event.defaultPrevented || event.repeat || event.isComposing) return;
        if (
          event.target instanceof Element &&
          event.target.closest('[data-vestra-keybind-recording="true"]')
        )
          return;
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
.vs-settings-launcher[data-hiding=true]{animation:vs-launcher-vanish .48s cubic-bezier(.4,0,.65,1) both;pointer-events:none}
@keyframes vs-launcher-vanish{0%{opacity:1;transform:rotate(0) scale(1);filter:blur(0)}35%{opacity:1;transform:rotate(-18deg) scale(1.08)}100%{opacity:0;transform:translateY(-24px) rotate(210deg) scale(.08);filter:blur(5px)}}
.vs-launcher-menu{position:fixed;z-index:2147483647;width:210px;border:1px solid #c5baf825;border-radius:12px;padding:6px;background:#1c1923;box-shadow:0 16px 45px #0009;color:#eee8f6;font:12px "Segoe UI",sans-serif;animation:vs-overlay-fade .16s ease-out}
.vs-launcher-menu button{display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}
.vs-launcher-menu button:hover,.vs-launcher-menu button:focus-visible{background:#c5baf81a;outline:none}
.vs-launcher-menu p{font-size:10px;line-height:1.5;color:#9d92ad;margin:5px 10px 7px}
.vs-overlay-backdrop{position:fixed;inset:0;z-index:2147483645;background:rgba(7,6,10,.76);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:center;padding:32px 24px;box-sizing:border-box;animation:vs-overlay-fade .2s ease-out;font-family:system-ui,sans-serif}
.vs-overlay-panel{position:relative;width:min(1040px,100%);height:min(730px,calc(100dvh - 64px));display:flex;flex-direction:column;background:#17161C;border:1px solid #FFFFFF0D;border-radius:17px;box-shadow:0 40px 120px #0009,0 0 0 1px #0004;color:#F2F0F7;overflow:hidden;animation:vs-overlay-pop .52s cubic-bezier(.16,1,.3,1)}
.vs-overlay-header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #202938;background:rgba(255,255,255,.015)}
.vs-overlay-logo{width:26px;height:26px;flex:none;filter:drop-shadow(0 0 10px rgba(110,168,255,.55))}
.vs-overlay-title{font-size:15px;font-weight:800;letter-spacing:.02em}
.vs-overlay-tag{font-size:11px;color:#8d96a5;border:1px solid #202938;border-radius:20px;padding:2px 9px;background:rgba(255,255,255,.03)}
.vs-overlay-hint{margin-left:auto;font-size:11px;color:#8d96a5}
.vs-overlay-hint kbd{font-family:inherit;background:#121824;border:1px solid #2a3648;border-bottom-width:2px;border-radius:5px;padding:1px 6px;font-size:10px;color:#f5f7fa}
.vs-overlay-close{width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:#8d96a5;cursor:pointer;font-size:16px;line-height:1}
.vs-overlay-close:hover{background:rgba(255,255,255,.08);color:#f5f7fa}
.vs-overlay-body{height:100%;min-height:0;overflow:hidden;padding:0}
.vs-overlay-window-tools{position:absolute;right:17px;top:16px;display:flex;align-items:center;gap:10px;z-index:3}
.vs-overlay-window-tools .vs-overlay-hint{color:#736B80;font-size:9px}.vs-overlay-window-tools .vs-overlay-close{display:grid;place-items:center;width:26px;height:26px;color:#94889F;border:1px solid #FFFFFF0B;background:#FFFFFF03;border-radius:8px}
.vs-overlay-body::-webkit-scrollbar{width:10px}
.vs-overlay-body::-webkit-scrollbar-thumb{background:#202938;border-radius:8px;border:2px solid #0c1018}
@keyframes vs-overlay-fade{from{opacity:0}to{opacity:1}}
@keyframes vs-overlay-pop{0%{opacity:0;transform:translateY(22px) scale(.91)}65%{opacity:1;transform:translateY(-2px) scale(1.008)}100%{opacity:1;transform:none}}
.vs-overlay-backdrop[data-closing=true]{animation:vs-overlay-leave .18s ease-in both;pointer-events:none}
.vs-overlay-backdrop[data-closing=true] .vs-overlay-panel{animation:vs-panel-leave .18s ease-in both}
@keyframes vs-overlay-leave{to{opacity:0}}
@keyframes vs-panel-leave{to{opacity:0;transform:translateY(12px) scale(.96)}}
.vs-settings-launcher{position:fixed;z-index:2147483644;display:flex;align-items:center;gap:5px;border:1px solid #C5BAF83D;border-radius:12px;background:linear-gradient(145deg,#2B2437,#17141E);color:#DCD3FC;padding:6px 10px;font:600 11px system-ui;cursor:pointer;box-shadow:0 4px 18px #0005,inset 0 1px 0 #FFFFFF0C;touch-action:none;user-select:none;transition:background .2s,box-shadow .25s,border-color .2s}
.vs-settings-launcher svg{transition:transform .45s cubic-bezier(.34,1.56,.64,1),filter .25s}
.vs-settings-launcher:hover{border-color:#C5BAF880;box-shadow:0 6px 24px #0007,0 0 20px #C5BAF81A}
.vs-settings-launcher:hover svg{transform:translateY(-1px) rotate(-9deg);filter:drop-shadow(0 0 7px #C5BAF870)}
.vs-settings-launcher:active:not([data-dragging=true]) svg{transform:scale(.8)}
.vs-settings-launcher:focus-visible{outline:2px solid #C5BAF8;outline-offset:3px}
.vs-settings-launcher[data-dragging=true]{cursor:grabbing;box-shadow:0 10px 30px #0008,0 0 0 2px #C5BAF850}
@media(max-width:520px){.vs-overlay-backdrop{padding:14px 10px}.vs-overlay-panel{height:calc(100dvh - 28px);border-radius:13px}.vs-overlay-window-tools .vs-overlay-hint{display:none}}
@media(prefers-reduced-motion:reduce){.vs-overlay-backdrop,.vs-overlay-panel{animation:none!important}.vs-settings-launcher,.vs-settings-launcher svg{transition:none}}
`;

function ensureOverlayCss(): void {
  try {
    if (!Styles.has(OVERLAY_CSS_ID)) Styles.inject(OVERLAY_CSS_ID, OVERLAY_CSS);
  } catch (err: unknown) {
    Logger.captureError(err, "Overlay.css");
  }
}

export function VestraLogo({ size = 26 }: { size?: number }): JSX.Element {
  return <BrandMark size={size} />;
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
    const raw = (globalThis as Record<string, unknown>)[
      "document"
    ] as unknown as
      | { createElement?: unknown; body?: unknown; getElementById?: unknown }
      | undefined;
    if (
      raw === undefined ||
      raw === null ||
      typeof raw.createElement !== "function"
    )
      return noop;
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
    ensureOverlayCss();
    ensureSettingsDesign();
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

export function OverlayHost({
  settings,
  plugins,
  version,
  controller,
}: OverlayHostProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(() => controller.isOpen());
  const [present, setPresent] = useState(() => controller.isOpen());
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = setTimeout(
      () => setPresent(false),
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    );
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    ensureOverlayCss();
    return controller.subscribe((next) => {
      setOpen(next);
    });
  }, [controller]);

  useEffect(() => {
    if (!open || !present) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        controller.close();
      }
      if (event.key === "Tab") {
        const items = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
          ) ?? [],
        ).filter((element) => {
          const closed = element.closest("details:not([open])");
          return (
            !element.closest("[hidden]") &&
            (!closed || closed.querySelector("summary") === element) &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden"
          );
        });
        if (!items?.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next =
          current < 0
            ? event.shiftKey
              ? items.length - 1
              : 0
            : (current + (event.shiftKey ? -1 : 1) + items.length) %
              items.length;
        items[next]!.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, present, controller]);

  return (
    <>
      <ToastsView manager={Toasts} />
      <Launcher
        settings={settings}
        open={open}
        toggle={() => controller.toggle()}
      />
      {present ? (
        <div
          className="vs-overlay-backdrop"
          data-vestra-overlay="open"
          data-closing={!open}
          onClick={(event) => {
            if (event.target === event.currentTarget) controller.close();
          }}
        >
          <div
            ref={panel}
            className="vs-overlay-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Vestra settings"
            tabIndex={-1}
          >
            <div className="vs-overlay-window-tools">
              <span className="vs-overlay-hint">esc</span>
              <button
                type="button"
                className="vs-overlay-close"
                onClick={() => {
                  controller.close();
                }}
                aria-label="Close settings"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
            <div className="vs-overlay-body">
              <VestraSettingsPanel
                settings={settings}
                plugins={plugins}
                version={version}
              />
            </div>
          </div>
        </div>
      ) : (
        <div data-vestra-overlay="closed" style={{ display: "none" }} />
      )}
    </>
  );
}
