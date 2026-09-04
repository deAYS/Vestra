// Vestra Manager — InstallerErrorCode to friendly UI copy.
// Keeps the raw `detail` available for a "Show details" disclosure;
// the normal UI never dumps stack traces.

import type { InstallerErrorCode } from "./types.js";

export interface FriendlyError {
  title: string;
  hint: string;
}

export function friendlyErrorMessage(code: InstallerErrorCode | undefined): FriendlyError {
  switch (code) {
    case "permission-denied":
      return {
        title: "Vestra couldn't modify this Discord installation.",
        hint: "Try running Vestra with the required permissions.",
      };
    case "backup-missing":
      return {
        title: "Vestra could not find the original Discord backup.",
        hint: "Reinstall Discord, then install Vestra again.",
      };
    case "verification-failed":
      return {
        title: "Installation completed, but verification failed.",
        hint: "Try repairing this installation.",
      };
    case "safety-refusal":
      return {
        title: "Operation was blocked by Vestra's safety checks.",
        hint: "The target looked unsafe, so nothing was modified.",
      };
    case "discord-not-found":
      return {
        title: "Discord installation not found.",
        hint: "It may have been moved or uninstalled. Try Refresh.",
      };
    case "invalid-asar":
      return {
        title: "Discord's installation files look invalid.",
        hint: "Reinstall Discord, then install Vestra again.",
      };
    case "receipt-invalid":
      return {
        title: "Vestra's install receipt is missing or invalid.",
        hint: "Try repairing this installation.",
      };
    case "patch-failed":
      return {
        title: "Vestra could not patch this Discord installation.",
        hint: "Close Discord and try again.",
      };
    case "unknown":
    case undefined:
      return {
        title: "Something went wrong.",
        hint: "Try again. Details are available below.",
      };
  }
}

const PHASE_LABELS: Record<string, string> = {
  discovering: "Preparing Vestra...",
  staging: "Staging Vestra...",
  patching: "Patching Discord...",
  verifying: "Verifying...",
  complete: "Done.",
};

/** Phase label for progress UI. Never a fake percentage. */
export function progressLabel(phase: string, channelLabel?: string): string {
  const base = PHASE_LABELS[phase] ?? "Working...";
  if (phase === "patching" && channelLabel !== undefined) {
    return `Patching ${channelLabel}...`;
  }
  return base;
}
