import type { DiscordChannel } from "./channels.js";

/** Recovery state types, shared by the background process, main IPC and renderer. */
export type RecoveryPhase = "idle" | "patched" | "waiting-for-exit" | "failed";

export interface ChannelRecovery {
  phase: RecoveryPhase;
  version?: string;
  at: number;
  attempts: number;
  /** Short reason code only; never a message, URL or path. */
  detail?: string;
  /**
   * Archive the attempts belong to: version folder name plus size and mtime.
   * A new folder or a replaced archive starts a fresh retry budget.
   */
  signature?: string;
}

export type RecoveryState = Partial<Record<DiscordChannel, ChannelRecovery>>;
