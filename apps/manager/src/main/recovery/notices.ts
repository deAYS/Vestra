import * as fs from "node:fs/promises";
import * as path from "node:path";
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
    body: "Click to restart Discord and bring Vestra back.",
    actions: [{ type: "button", text: "Restart Discord" }],
  },
  failed: {
    title: "Vestra couldn't re-install",
    body: "Vestra couldn't re-install after Discord updated. Click to open Vestra Manager.",
    actions: [{ type: "button", text: "Open Vestra Manager" }],
  },
};

/** Follow-up when a Restart Discord click found another operation running. */
export const BUSY_CONTENT: NoticeContent = {
  title: "Vestra is busy",
  body: "Another Vestra operation is running. Try again in a moment.",
  actions: [],
};

/** Another operation owns the install lock or the Discord lifecycle. */
export function isOperationBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Another (?:installation|Discord) operation/i.test(message);
}

/** What a click does, by notice kind. */
export interface NoticeActions {
  /** Waiting for exit: the user's Restart Discord. */
  restart(channel: DiscordChannel): Promise<void>;
  /** Failed: open the Manager, where Repair is offered. */
  openManager(): Promise<void>;
  /** Failures of a click, which has no caller to throw to. */
  onError(error: unknown): void;
}

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
    private readonly actions: NoticeActions,
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
      this.run(channel, kind);
    };
    // Windows (Electron 34) has no action buttons: the body click is the path.
    handle.on("click", click);
    handle.on("action", click);
    this.open.set(key, { channel, kind, id, handle });
    handle.show();
  }

  private run(channel: DiscordChannel, kind: NoticeKind): void {
    const action =
      kind === "failed"
        ? this.actions.openManager()
        : this.actions.restart(channel);
    void action.catch((error: unknown) => {
      if (kind === "waiting-for-exit" && isOperationBusy(error)) {
        this.busy();
        return;
      }
      this.actions.onError(error);
    });
  }

  /** An informational follow-up; nothing to click, nothing to withdraw. */
  private busy(): void {
    try {
      this.create(BUSY_CONTENT)?.show();
    } catch (error) {
      this.actions.onError(error);
    }
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

/** The file system calls the target lookup needs; injectable for tests. */
export interface TargetFs {
  readFile(file: string): Promise<string>;
  isFile(file: string): Promise<boolean>;
}

const realFs: TargetFs = {
  readFile: (file) => fs.readFile(file, "utf8"),
  isFile: async (file) => (await fs.stat(file)).isFile(),
};

/**
 * The installed Manager recorded in manager-installation.json, or `fallback`
 * (this process) when the record is missing, invalid or points nowhere. The
 * background process runs from a copy, which is not what the user installed.
 */
export async function installedManagerTarget(
  home: string,
  fallback: string,
  io: TargetFs = realFs,
): Promise<string> {
  try {
    const saved: unknown = JSON.parse(
      await io.readFile(path.join(home, "manager-installation.json")),
    );
    const target = (saved as { target?: unknown } | null)?.target;
    if (
      typeof target === "string" &&
      path.isAbsolute(target) &&
      path.extname(target).toLowerCase() === ".exe" &&
      (await io.isFile(target))
    )
      return target;
  } catch {
    /* fall through */
  }
  return fallback;
}
