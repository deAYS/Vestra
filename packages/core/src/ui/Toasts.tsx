import { useEffect, useRef, useState } from "react";
import { Styles } from "../api/styles.js";
import { Settings } from "../api/settings.js";
import type { Toast, ToastManager } from "../api/toasts.js";
import { VESTRA_MARK_PATH } from "@vestra/shared";

const CSS = `
.vs-toasts{position:fixed;right:24px;bottom:24px;z-index:2147483646;display:flex;flex-direction:column;gap:10px;width:min(380px,calc(100vw - 32px));font:13px/1.55 system-ui,sans-serif;pointer-events:none;color:#f2ecfa;text-align:left}
.vs-toast{--toast-accent:#c5baf8;position:relative;display:flex;gap:13px;padding:18px 44px 18px 18px;overflow:hidden;border:1px solid #c5baf82b;border-radius:17px;background:linear-gradient(125deg,#c5baf80c,transparent 65%),#1b1723;box-shadow:0 16px 50px #0005,inset 0 1px #ffffff08;pointer-events:auto;animation:vs-toast-in .35s cubic-bezier(.16,1,.3,1);text-shadow:none}
.vs-toasts[data-theme-follow=true] .vs-toast{background:linear-gradient(125deg,#ffffff08,transparent 65%),color-mix(in srgb,var(--background-floating,#1b1723) 85%,#1b1723);border-color:color-mix(in srgb,var(--text-link,#c5baf8) 18%,transparent);--toast-accent:var(--text-link,#c5baf8)}
.vs-toast[data-type=success]{--toast-accent:#9bd6b8}.vs-toast[data-type=warn]{--toast-accent:#e7c58e}.vs-toast[data-type=error]{--toast-accent:#efa6b5}
.vs-toast.vs-toast-leaving{animation:vs-toast-out .2s ease-in both;pointer-events:none}
.vs-toast-symbol{width:32px;height:32px;display:grid;place-items:center;flex:none;color:var(--toast-accent);border-radius:11px;background:color-mix(in srgb,var(--toast-accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--toast-accent) 16%,transparent)}
.vs-toast-symbol>svg{width:18px;height:18px}.vs-toast-copy{flex:1;min-width:0}.vs-toast-title{font-size:14px;line-height:1.4;font-weight:600;letter-spacing:-.015em;color:#f2ecfa;overflow-wrap:anywhere}
.vs-toast-message{font-size:13px;color:#bdb2cc;margin-top:5px;line-height:1.6;overflow-wrap:anywhere}
.vs-toast-close{position:absolute;top:10px;right:9px;width:28px;height:28px;display:grid;place-items:center;border:1px solid transparent;border-radius:8px;background:none;color:#a69ab8;cursor:pointer}
.vs-toast-close svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5}.vs-toast-close:hover{background:#ffffff09;border-color:#ffffff10;color:#fff}.vs-toast-close:focus-visible{outline:2px solid var(--toast-accent);outline-offset:2px}
.vs-toast-bar{position:absolute;inset:auto 18px 0;height:2px;border-radius:2px;background:var(--toast-accent);opacity:.35;transform-origin:left;animation:vs-toast-time linear both}
.vs-toast[data-paused=true] .vs-toast-bar{animation-play-state:paused}
@keyframes vs-toast-in{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
@keyframes vs-toast-out{to{opacity:0;transform:translateX(18px) scale(.97)}}
@keyframes vs-toast-time{to{transform:scaleX(0)}}
@media(prefers-reduced-motion:reduce){.vs-toast,.vs-toast.vs-toast-leaving{animation:none}.vs-toast-bar{display:none}}
@media(max-width:520px){.vs-toasts{right:16px;bottom:16px}}
`;

export function VMark({
  color = "currentColor",
}: {
  color?: string;
}): JSX.Element {
  return (
    <svg className="vs-toast-mark" viewBox="0 0 64 64" aria-hidden="true">
      <path d={VESTRA_MARK_PATH} fill={color} fillRule="evenodd" />
    </svg>
  );
}

function Symbol({ type }: { type: Toast["type"] }): JSX.Element {
  if (type === "info") return <VMark />;
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {type === "success" ? (
        <path d="m4 10 4 4 8-8" />
      ) : (
        <>
          <path d={type === "warn" ? "M10 3 18 17H2Z" : "M4 4h12v12H4z"} />
          <path d="M10 7v4m0 3h.01" />
        </>
      )}
    </svg>
  );
}

interface Card {
  toast: Toast;
  leaving: boolean;
}

function ToastCard({
  toast,
  leaving,
  manager,
}: Card & { manager: ToastManager }): JSX.Element {
  const [paused, setPaused] = useState(false);
  const hovered = useRef(false);
  const elapsed = useRef(
    Math.max(0, toast.durationMs - manager.remainingMs(toast.id)),
  );
  const pause = (): void => {
    manager.pause(toast.id);
    setPaused(true);
  };
  const resume = (): void => {
    manager.resume(toast.id);
    setPaused(false);
  };
  return (
    <div
      className={`vs-toast${leaving ? " vs-toast-leaving" : ""}`}
      data-type={toast.type}
      data-paused={paused}
      data-vestra-toast={toast.id}
      role={toast.type === "error" ? "alert" : "status"}
      onMouseEnter={() => {
        hovered.current = true;
        pause();
      }}
      onMouseLeave={(event) => {
        hovered.current = false;
        if (
          !event.currentTarget.contains(
            event.currentTarget.ownerDocument.activeElement,
          )
        )
          resume();
      }}
      onFocusCapture={pause}
      onBlurCapture={(event) => {
        if (
          !hovered.current &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          resume();
      }}
    >
      <span className="vs-toast-symbol">
        <Symbol type={toast.type} />
      </span>
      <div className="vs-toast-copy">
        <div className="vs-toast-title">{toast.title}</div>
        {toast.message && (
          <div className="vs-toast-message">{toast.message}</div>
        )}
      </div>
      <button
        type="button"
        className="vs-toast-close"
        aria-label="Dismiss notification"
        title="Dismiss notification"
        onClick={() => manager.dismiss(toast.id)}
        tabIndex={leaving ? -1 : 0}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
      {toast.durationMs > 0 && (
        <div
          className="vs-toast-bar"
          style={{
            animationDuration: `${toast.durationMs}ms`,
            animationDelay: `-${elapsed.current}ms`,
          }}
        />
      )}
    </div>
  );
}

export function ToastsView({
  manager,
}: {
  manager: ToastManager;
}): JSX.Element {
  const [cards, setCards] = useState<Card[]>(() =>
    manager.list().map((toast) => ({ toast, leaving: false })),
  );
  const [followTheme, setFollowTheme] = useState(
    () => Settings.getPluginSetting("Vestra", "followTheme") !== false,
  );
  useEffect(() => {
    Styles.inject("vestra-toasts", CSS);
    return Settings.subscribe(() =>
      setFollowTheme(
        Settings.getPluginSetting("Vestra", "followTheme") !== false,
      ),
    );
  }, []);
  useEffect(() => {
    const present = new Map<number, Card>();
    const exits = new Map<number, ReturnType<typeof setTimeout>>();
    const publish = (): void =>
      setCards([...present.values()].sort((a, b) => b.toast.id - a.toast.id));
    const sync = (next: readonly Toast[]): void => {
      const active = new Set(next.map((toast) => toast.id));
      for (const card of present.values())
        if (!active.has(card.toast.id) && !card.leaving) {
          card.leaving = true;
          exits.set(
            card.toast.id,
            setTimeout(() => {
              present.delete(card.toast.id);
              exits.delete(card.toast.id);
              publish();
            }, 210),
          );
        }
      for (const toast of next)
        present.set(toast.id, { toast, leaving: false });
      const oldest = [...present.keys()].sort((a, b) => b - a).slice(6);
      for (const id of oldest) {
        present.delete(id);
        clearTimeout(exits.get(id));
        exits.delete(id);
      }
      publish();
    };
    const unsubscribe = manager.subscribe(sync);
    sync(manager.list());
    return () => {
      unsubscribe();
      for (const timer of exits.values()) clearTimeout(timer);
      for (const toast of manager.list()) manager.resume(toast.id);
    };
  }, [manager]);
  return (
    <div
      className="vs-toasts"
      data-theme-follow={followTheme}
      data-vestra-toasts={cards.length || "empty"}
      aria-label="Vestra notifications"
    >
      {cards.map((card) => (
        <ToastCard key={card.toast.id} {...card} manager={manager} />
      ))}
    </div>
  );
}
