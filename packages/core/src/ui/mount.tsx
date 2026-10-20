import { createRoot, type Root } from "react-dom/client";
import { VESTRA_VERSION } from "@vestra/shared";
import { Logger } from "../api/logger.js";
import { pluginManager } from "../pluginManager.js";
import { Settings } from "../api/settings.js";
import { VestraSettingsPanel } from "./VestraSettings.js";
import type { SettingsPageId, VestraUIDeps } from "./types.js";
import { ensureSettingsDesign } from "./design.js";

const roots = new WeakMap<Element, Root>();

function isElement(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { appendChild?: unknown }).appendChild === "function"
  );
}

export interface MountOptions {
  initialPage?: SettingsPageId;
}

/** Mount the settings panel. Returns an unmount function (always safe to call). */
export function mountVestraSettings(
  container: Element,
  deps?: VestraUIDeps,
  options?: MountOptions,
): () => void {
  const fallback: VestraUIDeps = {
    settings: Settings,
    plugins: pluginManager,
    version: VESTRA_VERSION,
  };
  const resolved = deps ?? fallback;
  const noop = (): void => undefined;

  if (!isElement(container)) {
    Logger.error("mountVestraSettings() requires a container element.");
    return noop;
  }
  try {
    const existing = roots.get(container);
    if (existing !== undefined) {
      existing.unmount();
      roots.delete(container);
    }
    const root = createRoot(container);
    roots.set(container, root);
    ensureSettingsDesign();
    root.render(
      <VestraSettingsPanel
        settings={resolved.settings}
        plugins={resolved.plugins}
        version={resolved.version}
        {...options}
      />,
    );
    return () => {
      unmountVestraSettings(container);
    };
  } catch (err: unknown) {
    Logger.captureError(err, "mountVestraSettings");
    return noop;
  }
}

/** Unmount a previously mounted panel. Missing roots are a no-op, never throw. */
export function unmountVestraSettings(container: Element): void {
  try {
    const root = isElement(container) ? roots.get(container) : undefined;
    if (root === undefined) return;
    root.unmount();
    roots.delete(container);
  } catch (err: unknown) {
    Logger.captureError(err, "unmountVestraSettings");
  }
}
