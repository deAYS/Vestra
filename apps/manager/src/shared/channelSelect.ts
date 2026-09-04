// Vestra Manager — default channel selection.
// Compile-time dev flag: the build scripts provide __VESTRA_MANAGER_DEV__
// via esbuild `define`. Dev bundles preselect Canary; production bundles
// preselect Stable. Never inferred from NODE_ENV or user env at runtime.

import type { DiscordChannel } from "./channels.js";

declare const __VESTRA_MANAGER_DEV__: boolean;

/** Baked at build time. True in dev bundles, false in production bundles. */
export function isDevelopmentBuild(devFlag?: boolean): boolean {
  if (devFlag !== undefined) return devFlag;
  if (typeof __VESTRA_MANAGER_DEV__ !== "undefined") return __VESTRA_MANAGER_DEV__;
  return false;
}

/** Explicit default: canary in dev, stable in production. */
export function defaultChannel(devFlag?: boolean): DiscordChannel {
  return isDevelopmentBuild(devFlag) ? "canary" : "stable";
}

/**
 * Pick the selected installation for a single-channel install action.
 * - Exactly one discovered install => that channel (no guessing).
 * - Multiple => the build default when present, else the first discovered.
 * - None => undefined.
 */
export function selectDefaultChannel(
  discovered: readonly DiscordChannel[],
  devFlag?: boolean,
): DiscordChannel | undefined {
  if (discovered.length === 0) return undefined;
  if (discovered.length === 1) return discovered[0];
  const preferred = defaultChannel(devFlag);
  if (discovered.includes(preferred)) return preferred;
  return discovered[0];
}

/** Badge line for a channel card: Recommended (prod/stable) or Dev target. */
export function channelBadge(channel: DiscordChannel, devFlag?: boolean): string | undefined {
  const dev = isDevelopmentBuild(devFlag);
  if (!dev && channel === "stable") return "Recommended";
  if (dev && channel === "canary") return "Development target";
  return undefined;
}
