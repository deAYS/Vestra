import { useEffect, useRef, type KeyboardEvent } from "react";
import { channelDisplayName, type DiscordChannel } from "../../shared/channels.js";
import type { ConfirmKind } from "../hooks/useManager.js";

interface Props {
  kind: ConfirmKind;
  channel: DiscordChannel;
  onCancel(): void;
  onConfirm(): void;
  busy: boolean;
}

const RESTART_WARNING = "Discord will restart. Calls and streams will disconnect.";

function copyFor(kind: ConfirmKind, name: string) {
  switch (kind) {
    case "uninstall":
      return {
        title: `Remove Vestra from ${name}?`,
        body: "Your Vestra settings can be kept.",
        action: "Uninstall",
        testId: "confirm-uninstall",
        variant: "danger",
      };
    case "install":
      return {
        title: `Install Vestra into ${name}?`,
        body: RESTART_WARNING,
        action: "Install and restart",
        testId: "confirm-continue",
        variant: "primary",
      };
    case "repair":
      return {
        title: `Repair Vestra in ${name}?`,
        body: RESTART_WARNING,
        action: "Repair and restart",
        testId: "confirm-continue",
        variant: "primary",
      };
  }
}

/** Modal confirm. Cancel has focus first; Escape cancels; Tab stays inside. */
export function ConfirmDialog({ kind, channel, onCancel, onConfirm, busy }: Props): JSX.Element {
  const copy = copyFor(kind, channelDisplayName(channel));
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const first = cancel.current;
    const last = confirm.current;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="vs-dialog-backdrop" data-testid="confirm-dialog" onKeyDown={onKeyDown}>
      <div
        className="vs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vs-confirm-title"
        aria-describedby="vs-confirm-body"
      >
        <h2 id="vs-confirm-title">{copy.title}</h2>
        <p id="vs-confirm-body">{copy.body}</p>
        <div className="vs-dialog__actions">
          <button
            type="button"
            ref={cancel}
            className="vs-btn vs-btn--secondary"
            onClick={onCancel}
            disabled={busy}
            data-testid="confirm-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            ref={confirm}
            className={`vs-btn vs-btn--${copy.variant}`}
            onClick={onConfirm}
            disabled={busy}
            data-testid={copy.testId}
          >
            {copy.action}
          </button>
        </div>
      </div>
    </div>
  );
}
