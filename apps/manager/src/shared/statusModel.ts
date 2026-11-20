import type { RunState } from "@vestra/shared";
import type { ChannelRecovery } from "../main/recovery/state.js";
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

// ---------------------------------------------------------------------------
// Row model: one truthful status line and at most one primary action.
// ---------------------------------------------------------------------------

export type RowState =
  | "not-installed"
  | "checking"
  | "active"
  | "not-started"
  | "awaiting-login"
  | "didnt-start"
  | "needs-repair"
  | "check-failed"
  | "waiting-restart";

export type RowPrimary = "install" | "repair" | "retry" | "restart";

export interface RowModel {
  channel: DiscordChannel;
  version: string | null;
  state: RowState;
  /** The files on disk carry Vestra (Repair/Uninstall make sense). */
  installed: boolean;
  primary?: RowPrimary;
  /** Plain-language reason for didnt-start only; never raw check detail. */
  detail?: string;
  startedAt?: number;
}

export const PRIMARY_LABEL: Record<RowPrimary, string> = {
  install: "Install Vestra",
  repair: "Repair",
  retry: "Try again",
  restart: "Restart Discord",
};

const UNRECOGNIZED_WINDOW = new Set([
  "untrusted-url",
  "subframe",
  "no-frame",
  "no-sender",
]);

/** Start failure reason code -> short plain text. Unknown codes are loading failures. */
export function startFailureText(reason: string): string {
  return UNRECOGNIZED_WINDOW.has(reason)
    ? "Discord's window wasn't recognized"
    : "Vestra failed while loading";
}

function row(
  card: CardModel,
  state: RowState,
  installed: boolean,
  extra: Pick<RowModel, "primary" | "detail" | "startedAt"> = {},
): RowModel {
  return {
    channel: card.channel,
    version: card.version,
    state,
    installed,
    ...extra,
  };
}

/**
 * Files first (not-installed, checking, needs-repair, check-failed), then a
 * recovery waiting for Discord to exit, then what the last start reported.
 * One exception: recovery records waiting-for-exit only when the running
 * version's files are unpatched, which status reports as not-installed. A
 * waiting record for exactly that version is the truthful line.
 */
export function rowModel(
  card: CardModel,
  run: RunState | undefined,
  recovery: ChannelRecovery | undefined,
): RowModel {
  const waiting = recovery?.phase === "waiting-for-exit";
  switch (card.state) {
    case "not-installed":
      if (
        waiting &&
        card.version !== null &&
        recovery.version !== undefined &&
        recovery.version === card.version
      )
        return row(card, "waiting-restart", false, { primary: "restart" });
      return row(card, "not-installed", false, { primary: "install" });
    case "installed-checking":
      return row(card, "checking", true);
    case "needs-repair":
      return row(card, "needs-repair", true, { primary: "repair" });
    case "check-failed":
      return row(card, "check-failed", true, { primary: "retry" });
    case "healthy":
      break;
  }
  if (waiting) return row(card, "waiting-restart", true, { primary: "restart" });
  switch (run?.kind) {
    case "active":
      return row(card, "active", true, { startedAt: run.at });
    case "failed":
      return row(card, "didnt-start", true, {
        primary: "repair",
        detail: startFailureText(run.reason),
      });
    case "awaiting-login":
      return row(card, "awaiting-login", true);
    default:
      return row(card, "not-started", true);
  }
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dayIndex(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000,
  );
}

/** "Nov 18", or "Nov 18, 2025" outside the current year (local time). */
export function formatShortDate(at: number, now: Date): string {
  const date = new Date(at);
  const base = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear()
    ? base
    : `${base}, ${date.getFullYear()}`;
}

/** "today 14:41", "yesterday 09:05", else a short date (local time). */
export function formatStartedAt(at: number, now: Date): string {
  const date = new Date(at);
  const days = dayIndex(now) - dayIndex(date);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return formatShortDate(at, now);
}

export function rowStatusText(model: RowModel, now: Date): string {
  switch (model.state) {
    case "active":
      return model.startedAt === undefined
        ? "Vestra active"
        : `Vestra active · started ${formatStartedAt(model.startedAt, now)}`;
    case "didnt-start":
      return `Installed, but didn't start — ${model.detail ?? "Vestra failed while loading"}`;
    case "awaiting-login":
      return "Installed · starts after you log in to Discord";
    case "not-started":
      return "Installed · will start next time Discord opens";
    case "waiting-restart":
      return "Waiting for Discord restart";
    case "needs-repair":
      return "Needs repair";
    case "checking":
      return "Checking…";
    case "check-failed":
      return "Couldn't check";
    case "not-installed":
      return "Not installed";
  }
}

/** The most recent re-install recovery completed, for the footer. */
export function lastReinstall(
  state: Partial<Record<DiscordChannel, ChannelRecovery>>,
): { version: string; at: number } | undefined {
  let latest: { version: string; at: number } | undefined;
  for (const record of Object.values(state)) {
    if (record?.phase !== "patched" || record.version === undefined) continue;
    if (latest === undefined || record.at > latest.at)
      latest = { version: record.version, at: record.at };
  }
  return latest;
}

export function recoverySubline(
  last: { version: string; at: number },
  now: Date,
): string {
  return `Last re-installed into ${last.version} · ${formatShortDate(last.at, now)}`;
}
