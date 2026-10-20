import type { DiscordChannel } from "./channels.js";
import type { InstallHealth, InstallStatus } from "./types.js";

export type CardState =
  | "not-installed"
  | "installed-checking"
  | "healthy"
  | "needs-repair"
  | "check-failed";

export interface CardModel {
  channel: DiscordChannel;
  version: string | null;
  state: CardState;
  detail?: string | undefined;
}

/**
 * Initial card from a cheap status() entry.
 * vestraInstalled => installed-checking (deep verification pending).
 */
export function cardFromShallow(status: InstallStatus): CardModel {
  return {
    channel: status.installation.channel,
    version: status.installation.version,
    state: status.vestraInstalled ? "installed-checking" : "not-installed",
    detail: status.detail,
  };
}

/** Map an authoritative deep health value onto a card state. */
export function cardStateFromDeepHealth(health: InstallHealth): CardState {
  switch (health) {
    case "healthy":
      return "healthy";
    case "drifted":
    case "stale":
      return "needs-repair";
    case "error":
      return "check-failed";
    case "not-installed":
      return "not-installed";
  }
}

/** Apply a deep check() entry over its card (matched by channel upstream). */
export function applyDeepResult(card: CardModel, deep: InstallStatus | undefined): CardModel {
  if (deep === undefined) return card;
  return {
    channel: card.channel,
    version: deep.installation.version ?? card.version,
    state: cardStateFromDeepHealth(deep.health),
    detail: deep.detail,
  };
}
