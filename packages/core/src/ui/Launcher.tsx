import { useEffect, useRef, useState } from "react";
import type { SettingsStore } from "../api/settings.js";
import { BrandMark } from "./Brand.js";
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
    const unsubscribe = settings.subscribe(() =>
      update(
        readLauncherPosition(
          settings.getPluginSetting("Vestra", LAUNCHER_POSITION_KEY),
        ),
      ),
    );
    return () => {
      window.removeEventListener("resize", measure);
      unsubscribe();
    };
  }, [settings]);
  const persist = (): void =>
    settings.setPluginSetting(
      "Vestra",
      LAUNCHER_POSITION_KEY,
      positionRef.current,
    );
  return (
    <button
      ref={button}
      type="button"
      className="vs-settings-launcher"
      data-dragging={dragging}
      style={{
        left: bounds.left + position.x * bounds.travelX,
        top: bounds.top + position.y * bounds.travelY,
      }}
      aria-label="Open Vestra settings"
      aria-expanded={open}
      title="Open Vestra · drag to move · arrow keys to reposition · Home to reset"
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
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          return;
        }
        if (openTimer.current !== undefined) return;
        const animated = !window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches;
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
  );
}
