export interface LauncherPosition {
  x: number;
  y: number;
}
export const LAUNCHER_POSITION_KEY = "launcherPosition";

/** Store fractions of the available travel, so resizing cannot strand the button. */
export function readLauncherPosition(value: unknown): LauncherPosition {
  if (
    value &&
    typeof value === "object" &&
    "x" in value &&
    "y" in value &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  ) {
    return {
      x: Math.max(0, Math.min(1, value.x)),
      y: Math.max(0, Math.min(1, value.y)),
    };
  }
  return { x: 0, y: 0.8 };
}

export function launcherBounds(
  width: number,
  height: number,
  buttonWidth: number,
  buttonHeight: number,
) {
  const left = Math.min(12, Math.max(0, width - buttonWidth));
  const top = Math.min(36, Math.max(0, height - buttonHeight));
  return {
    left,
    top,
    travelX: Math.max(0, width - buttonWidth - left - 12),
    travelY: Math.max(0, height - buttonHeight - top - 12),
  };
}
