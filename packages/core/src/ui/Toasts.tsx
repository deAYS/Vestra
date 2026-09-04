// @vestra/core UI — toast stack.
// Renders `ToastManager` toasts bottom-right: glass cards, per-type accent,
// slide-in + timed progress bar (pauses on hover), click × or auto-dismiss.
// CSS (keyframes included) is injected once through the Styles API.

import { useEffect, useRef, useState } from "react";
import { Logger } from "../api/logger.js";
import { Styles } from "../api/styles.js";
import type { Toast, ToastManager } from "../api/toasts.js";

const TOAST_CSS_ID = "vestra-toasts";

const TOAST_CSS = `
.vs-toasts{position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;flex-direction:column;gap:10px;max-width:min(360px,calc(100vw - 32px));font-family:system-ui,sans-serif}
.vs-toast{position:relative;overflow:hidden;background:rgba(12,16,24,.94);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid #202938;border-left:3px solid #20509a;border-radius:12px;padding:11px 36px 11px 14px;color:#f5f7fa;box-shadow:0 12px 40px rgba(0,0,0,.55);animation:vs-toast-in .38s cubic-bezier(.21,1.02,.73,1)}
.vs-toast[data-type="success"]{border-left-color:#3fb950}
.vs-toast[data-type="warn"]{border-left-color:#d29922}
.vs-toast[data-type="error"]{border-left-color:#f85149}
.vs-toast.vs-toast-leaving{animation:vs-toast-out .22s ease-in forwards}
.vs-toast-title{font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px}
.vs-toast-mark{width:16px;height:16px;flex:none}
.vs-toast-message{font-size:12px;color:#8d96a5;margin-top:3px;line-height:1.45;word-break:break-word}
.vs-toast-close{position:absolute;top:6px;right:6px;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:#8d96a5;cursor:pointer;font-size:14px;line-height:1}
.vs-toast-close:hover{background:rgba(255,255,255,.08);color:#f5f7fa}
.vs-toast-bar{position:absolute;left:0;bottom:0;height:2px;width:100%;transform-origin:left;background:linear-gradient(90deg,#20509a,#6ea8ff);animation:vs-toast-bar linear forwards}
.vs-toast:hover .vs-toast-bar{animation-play-state:paused}
.vs-toast[data-type="success"] .vs-toast-bar{background:linear-gradient(90deg,#238636,#3fb950)}
.vs-toast[data-type="warn"] .vs-toast-bar{background:linear-gradient(90deg,#9e6a03,#d29922)}
.vs-toast[data-type="error"] .vs-toast-bar{background:linear-gradient(90deg,#da3633,#f85149)}
@keyframes vs-toast-in{from{opacity:0;transform:translateX(48px) scale(.96)}to{opacity:1;transform:none}}
@keyframes vs-toast-out{to{opacity:0;transform:translateX(48px) scale(.96)}}
@keyframes vs-toast-bar{from{transform:scaleX(1)}to{transform:scaleX(0)}}
`;

let cssEnsured = false;

function ensureToastCss(): void {
  if (cssEnsured) return;
  cssEnsured = true;
  try {
    if (!Styles.has(TOAST_CSS_ID)) Styles.inject(TOAST_CSS_ID, TOAST_CSS);
  } catch (err: unknown) {
    Logger.captureError(err, "Toasts.css");
  }
}

const TYPE_COLOR: Record<Toast["type"], string> = {
  info: "#6ea8ff",
  success: "#3fb950",
  warn: "#d29922",
  error: "#f85149",
};

export function VMark({ color }: { color: string }): JSX.Element {
  return (
    <svg className="vs-toast-mark" viewBox="0 0 40 44" width="16" height="16" aria-hidden="true">
      <polygon points="4,6 20,38 36,6 28,6 20,26 12,6" fill={color} />
    </svg>
  );
}

function ToastCard({ toast, manager }: { toast: Toast; manager: ToastManager }): JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  // Remaining-time tracking so hover truly pauses the countdown.
  const remaining = useRef(toast.durationMs);
  const deadline = useRef(0);

  useEffect(() => {
    if (toast.durationMs <= 0) return;
    if (paused) {
      remaining.current = Math.max(0, deadline.current - Date.now());
      return;
    }
    deadline.current = Date.now() + remaining.current;
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => {
        try {
          manager.dismiss(toast.id);
        } catch (err: unknown) {
          Logger.captureError(err, "Toasts.dismiss");
        }
      }, 220);
    }, remaining.current);
    return () => {
      clearTimeout(timer);
    };
  }, [toast, manager, paused]);

  const close = (): void => {
    setLeaving(true);
    setTimeout(() => {
      try {
        manager.dismiss(toast.id);
      } catch (err: unknown) {
        Logger.captureError(err, "Toasts.dismiss");
      }
    }, 200);
  };

  return (
    <div
      className={leaving ? "vs-toast vs-toast-leaving" : "vs-toast"}
      data-type={toast.type}
      data-vestra-toast={toast.id}
      role="status"
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
    >
      <div className="vs-toast-title">
        <VMark color={TYPE_COLOR[toast.type]} />
        <span>{toast.title}</span>
      </div>
      {toast.message !== "" ? <div className="vs-toast-message">{toast.message}</div> : null}
      <button type="button" className="vs-toast-close" onClick={close} aria-label="Dismiss">
        ×
      </button>
      {toast.durationMs > 0 ? (
        <div className="vs-toast-bar" style={{ animationDuration: `${toast.durationMs}ms` }} />
      ) : null}
    </div>
  );
}

export function ToastsView({ manager }: { manager: ToastManager }): JSX.Element {
  const [toasts, setToasts] = useState<readonly Toast[]>(() => manager.list());

  useEffect(() => {
    ensureToastCss();
    return manager.subscribe((next) => {
      setToasts(next);
    });
  }, [manager]);

  if (toasts.length === 0) return <div className="vs-toasts" data-vestra-toasts="empty" />;
  return (
    <div className="vs-toasts" data-vestra-toasts={toasts.length}>
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} manager={manager} />
      ))}
    </div>
  );
}
