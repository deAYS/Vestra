import { useEffect, useRef, useState } from "react";
import type { SettingsStore } from "../api/settings.js";
import { BrandMark } from "./Brand.js";
import { Toasts } from "../api/toasts.js";
import { DEFAULT_OVERLAY_KEYBIND } from "./keybind.js";
import { useSettingsSnapshot } from "./hooks.js";

export const LAUNCHER_HIDDEN_KEY = "launcherHidden";
import {
  LAUNCHER_POSITION_KEY,
  launcherBounds,
  readLauncherPosition,
  type LauncherPosition,
} from "./launcherPosition.js";

export function Launcher({
  settings,
  open,
  toggle,
}: {
  settings: SettingsStore;
  open: boolean;
  toggle: () => void;
}): JSX.Element {
  const snapshot = useSettingsSnapshot(settings);
  const followTheme = snapshot.plugins.Vestra?.settings.followTheme !== false && (snapshot.themes.some(theme => theme.enabled) || snapshot.customCss.enabled);
  const [position, setPosition] = useState(() =>
    readLauncherPosition(
      settings.getPluginSetting("Vestra", LAUNCHER_POSITION_KEY),
    ),
  );
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
    buttonWidth: 83,
    buttonHeight: 37,
  });
  const [dragging, setDragging] = useState(false);
  const [hidden, setHidden] = useState(
    settings.getPluginSetting("Vestra", LAUNCHER_HIDDEN_KEY) === true,
  );
  const [vanishing, setVanishing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const button = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    start: LauncherPosition;
    moved: boolean;
  }>();
  const suppressClick = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout>>();
  const positionRef = useRef(position);
  const bounds = launcherBounds(
    size.width,
    size.height,
    size.buttonWidth,
    size.buttonHeight,
  );
  const update = (next: LauncherPosition): void => {
    positionRef.current = next;
    setPosition(next);
  };
  useEffect(
    () => () => {
      if (openTimer.current !== undefined) clearTimeout(openTimer.current);
      openTimer.current = undefined;
    },
    [open],
  );
  useEffect(() => {
    const measure = (): void => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
        buttonWidth: button.current?.offsetWidth ?? 83,
        buttonHeight: button.current?.offsetHeight ?? 37,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    const unsubscribe = settings.subscribe(() => {
      const next =
        settings.getPluginSetting("Vestra", LAUNCHER_HIDDEN_KEY) === true;
      setHidden(next);
      if (next) setVanishing(false);
      update(
        readLauncherPosition(
          settings.getPluginSetting("Vestra", LAUNCHER_POSITION_KEY),
        ),
      );
    });
    return () => {
      window.removeEventListener("resize", measure);
      unsubscribe();
    };
  }, [settings]);
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector("button")?.focus();
    const dismiss = (event: PointerEvent): void => {
      if (!menuElement.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMenu(null);
        button.current?.focus();
      }
    };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [menu]);
  const hide = (): void => {
    setMenu(null);
    setVanishing(true);
    const finish = (): void => {
      settings.setPluginSetting("Vestra", LAUNCHER_HIDDEN_KEY, true);
      const shortcut =
        settings.getPluginSetting("Vestra", "overlayKeybind") ||
        DEFAULT_OVERLAY_KEYBIND;
      Toasts.info(
        "Floating button hidden",
        `Use ${shortcut} to open Vestra, then choose Show floating button in the sidebar.`,
        4000,
      );
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else hideTimer.current = setTimeout(finish, 480);
  };
  const persist = (): void =>
    settings.setPluginSetting(
      "Vestra",
      LAUNCHER_POSITION_KEY,
      positionRef.current,
    );
  return hidden ? (
    <></>
  ) : (
    <>
      <button
        ref={button}
        type="button"
        className="vs-settings-launcher"
        data-theme-follow={followTheme}
        data-dragging={dragging}
        data-hiding={vanishing}
        style={{
          left: bounds.left + position.x * bounds.travelX,
          top: bounds.top + position.y * bounds.travelY,
        }}
        aria-label="Open Vestra settings"
        aria-expanded={open}
        title="Open Vestra · drag to move · arrow keys to reposition · Home to reset"
        onContextMenu={(event) => {
          event.preventDefault();
          if (!vanishing)
            setMenu({
              x: Math.min(event.clientX, window.innerWidth - 220),
              y: Math.min(event.clientY, window.innerHeight - 90),
            });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (openTimer.current !== undefined) {
            clearTimeout(openTimer.current);
            openTimer.current = undefined;
          }
          suppressClick.current = false;
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            start: position,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g || g.id !== event.pointerId) return;
          const dx = event.clientX - g.x,
            dy = event.clientY - g.y;
          if (!g.moved && Math.hypot(dx, dy) < 5) return;
          g.moved = true;
          suppressClick.current = true;
          setDragging(true);
          update(
            readLauncherPosition({
              x: g.start.x + dx / (bounds.travelX || 1),
              y: g.start.y + dy / (bounds.travelY || 1),
            }),
          );
        }}
        onPointerUp={(event) => {
          const g = gesture.current;
          if (!g || g.id !== event.pointerId) return;
          gesture.current = undefined;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          if (g.moved) persist();
        }}
        onLostPointerCapture={() => {
          if (gesture.current?.moved) persist();
          gesture.current = undefined;
          setDragging(false);
        }}
        onPointerCancel={() => {
          if (gesture.current?.moved) persist();
          gesture.current = undefined;
          suppressClick.current = true;
          setDragging(false);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({
              x: Math.max(8, Math.min(rect.left, window.innerWidth - 220)),
              y: Math.max(
                8,
                Math.min(rect.bottom + 8, window.innerHeight - 90),
              ),
            });
            return;
          }
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          };
          const direction = directions[event.key];
          if (event.key === "Home") {
            event.preventDefault();
            update(readLauncherPosition(null));
            persist();
          } else if (direction) {
            event.preventDefault();
            const step = event.shiftKey ? 24 : 8;
            update(
              readLauncherPosition({
                x: position.x + (direction[0] * step) / (bounds.travelX || 1),
                y: position.y + (direction[1] * step) / (bounds.travelY || 1),
              }),
            );
            persist();
          }
        }}
        onClick={(event) => {
          if (vanishing) return;
          if (suppressClick.current) {
            suppressClick.current = false;
            event.preventDefault();
            return;
          }
          if (openTimer.current !== undefined) return;
          const animated = !window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          if (animated) {
            event.currentTarget.animate?.(
              [
                { transform: "translateY(0) scale(1)" },
                { transform: "translateY(3px) scale(.82)", offset: 0.18 },
                { transform: "translateY(-3px) scale(1.12)", offset: 0.48 },
                { transform: "translateY(1px) scale(.97)", offset: 0.75 },
                { transform: "translateY(0) scale(1)" },
              ],
              { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" },
            );
          }
          // Let the press read visually before the modal's blur covers the launcher.
          if (animated)
            openTimer.current = setTimeout(() => {
              openTimer.current = undefined;
              toggle();
            }, 160);
          else toggle();
        }}
      >
        <BrandMark size={23} />
        <span>Vestra</span>
      </button>
      {menu && (
        <div
          ref={menuElement}
          className="vs-launcher-menu"
          data-theme-follow={followTheme}
          role="menu"
          aria-label="Vestra button"
          style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}
        >
          <button type="button" role="menuitem" onClick={hide}>
            Hide floating button <span>↗</span>
          </button>
          <p>Your keyboard shortcut stays available.</p>
        </div>
      )}
    </>
  );
}
