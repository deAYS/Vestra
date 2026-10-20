import { channelDisplayName, type DiscordChannel } from "../../shared/channels.js";

interface Props {
  channel: DiscordChannel;
  onCancel(): void;
  onConfirm(): void;
  busy: boolean;
}

export function ConfirmDialog({ channel, onCancel, onConfirm, busy }: Props): JSX.Element {
  return (
    <div className="vs-dialog-backdrop" data-testid="confirm-dialog">
      <div className="vs-dialog" role="dialog" aria-modal="true" aria-label="Confirm uninstall">
        <h2>Remove Vestra from {channelDisplayName(channel)}?</h2>
        <p>Your Vestra settings can be kept.</p>
        <div className="vs-dialog__actions">
          <button type="button" onClick={onCancel} disabled={busy} data-testid="confirm-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="vs-btn--danger"
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirm-uninstall"
          >
            Uninstall
          </button>
        </div>
      </div>
    </div>
  );
}
