import type { DiscordChannel } from "../../shared/channels.js";
import type { RecoveryPhase } from "./state.js";

export type NoticeKind = "waiting-for-exit" | "failed";

export interface NoticeContent {
  title: string;
  body: string;
  actions: Array<{ type: "button"; text: string }>;
}

export const NOTICE_CONTENT: Record<NoticeKind, NoticeContent> = {
  "waiting-for-exit": {
    title: "Discord updated",
    body: "Restart Discord to bring Vestra back.",
    actions: [{ type: "button", text: "Restart Discord" }],
  },
  failed: {
    title: "Vestra couldn't re-install",
    body: "Restart Discord to try again, or open Vestra Manager to repair.",
    actions: [{ type: "button", text: "Restart Discord" }],
  },
};

/** The parts of Electron's Notification this module uses. */
export interface NoticeHandle {
  on(event: "click" | "action", listener: () => void): unknown;
  show(): void;
  close(): void;
}

interface OpenNotice {
  channel: DiscordChannel;
  kind: NoticeKind;
  id: string;
  handle: NoticeHandle;
}

/**
 * Holds every shown notification until it is clicked or its channel leaves the
 * phase it was about. Windows fires "close" when a toast times out into Action
 * Center, where it can still be clicked, so "close" does not release it. At
 * most one notice per (kind, channel, id).
 */
export class RecoveryNotices {
  private readonly open = new Map<string, OpenNotice>();

  constructor(
    private readonly create: (content: NoticeContent) => NoticeHandle | null,
    private readonly onClick: (channel: DiscordChannel) => void,
  ) {}

  get size(): number {
    return this.open.size;
  }

  show(channel: DiscordChannel, kind: NoticeKind, id: string): void {
    const key = `${kind}:${channel}:${id}`;
    if (this.open.has(key)) return;
    const handle = this.create(NOTICE_CONTENT[kind]);
    if (!handle) return;
    let clicked = false;
    const click = (): void => {
      if (clicked) return;
      clicked = true;
      this.open.delete(key);
      this.onClick(channel);
    };
    // Windows (Electron 34) has no action buttons: the body click is the path.
    handle.on("click", click);
    handle.on("action", click);
    this.open.set(key, { channel, kind, id, handle });
    handle.show();
  }

  /**
   * A notice about another phase or another version is stale: withdraw it and
   * drop the reference. Ids are versions.
   */
  phase(channel: DiscordChannel, phase: RecoveryPhase, version?: string): void {
    for (const [key, notice] of this.open) {
      if (notice.channel !== channel) continue;
      if (notice.kind === phase && (version === undefined || notice.id === version))
        continue;
      this.open.delete(key);
      try {
        notice.handle.close();
      } catch {
        /* already gone */
      }
    }
  }
}
