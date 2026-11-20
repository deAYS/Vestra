import type { DiscordChannel } from "../../shared/channels.js";
import type { RowModel } from "../../shared/statusModel.js";
import { DiscordInstallCard, type RowActions } from "./DiscordInstallCard.js";

interface Props extends RowActions {
  rows: RowModel[];
  devMode: boolean;
  busy: boolean;
  workingChannel: DiscordChannel | null;
  progressText: string | null;
}

export function DiscordInstallList({
  rows,
  devMode,
  busy,
  workingChannel,
  progressText,
  ...actions
}: Props): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="vs-empty" data-testid="install-list-empty">
        No Discord installations detected.
      </div>
    );
  }
  const now = new Date();
  return (
    <div className="vs-list" data-testid="install-list">
      {rows.map((row) => (
        <DiscordInstallCard
          key={row.channel}
          row={row}
          devMode={devMode}
          busy={busy}
          working={workingChannel === row.channel}
          progressText={progressText}
          now={now}
          {...actions}
        />
      ))}
    </div>
  );
}
