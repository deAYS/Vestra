// Vestra Manager — one Discord installation card.

import { channelDisplayName, type DiscordChannel } from "../../shared/channels.js";
import { channelBadge } from "../../shared/channelSelect.js";
import type { CardModel } from "../../shared/statusModel.js";
import type { OperationKind } from "../hooks/useManager.js";
import { OperationButton } from "./OperationButton.js";
import { ProgressPanel } from "./ProgressPanel.js";
import { StatusBadge } from "./StatusBadge.js";

interface Props {
  card: CardModel;
  devMode: boolean;
  selected: boolean;
  busy: boolean;
  activeOp: { channel: DiscordChannel; kind: OperationKind } | null;
  progressText: string | null;
  onSelect(channel: DiscordChannel): void;
  onInstall(channel: DiscordChannel): void;
  onRepair(channel: DiscordChannel): void;
  onUninstall(channel: DiscordChannel): void;
}

export function DiscordInstallCard({
  card,
  devMode,
  selected,
  busy,
  activeOp,
  progressText,
  onSelect,
  onInstall,
  onRepair,
  onUninstall,
}: Props): JSX.Element {
  const badge = channelBadge(card.channel, devMode);
  const isActive = activeOp !== null && activeOp.channel === card.channel;
  const version = card.version ?? "unknown version";

  return (
    <article
      className={`vs-card${selected ? " vs-card--selected" : ""}`}
      data-testid={`install-card-${card.channel}`}
      onClick={() => onSelect(card.channel)}
    >
      <header className="vs-card__header">
        <h3>{channelDisplayName(card.channel)}</h3>
        {badge !== undefined ? (
          <span className="vs-card__badge" data-testid={`badge-${card.channel}`}>
            {badge}
          </span>
        ) : null}
      </header>
      <div className="vs-card__version" data-testid={`version-${card.channel}`}>
        {version}
      </div>
      <StatusBadge state={card.state} />
      {card.state === "installed-checking" ? (
        <div className="vs-card__checking">Checking...</div>
      ) : null}

      <div className="vs-card__actions">
        {card.state === "not-installed" ? (
          <OperationButton
            label="Install Vestra"
            variant="primary"
            disabled={busy}
            testId={`install-${card.channel}`}
            onClick={() => onInstall(card.channel)}
          />
        ) : null}
        {card.state === "installed-checking" ? (
          <span className="vs-card__muted">Installed — verifying…</span>
        ) : null}
        {card.state === "healthy" ? (
          <>
            <OperationButton
              label="Repair"
              disabled={busy}
              testId={`repair-${card.channel}`}
              onClick={() => onRepair(card.channel)}
            />
            <OperationButton
              label="Uninstall"
              variant="danger"
              disabled={busy}
              testId={`uninstall-${card.channel}`}
              onClick={() => onUninstall(card.channel)}
            />
          </>
        ) : null}
        {card.state === "needs-repair" ? (
          <>
            <OperationButton
              label="Repair Vestra"
              variant="primary"
              disabled={busy}
              testId={`repair-${card.channel}`}
              onClick={() => onRepair(card.channel)}
            />
            <OperationButton
              label="Uninstall"
              variant="danger"
              disabled={busy}
              testId={`uninstall-${card.channel}`}
              onClick={() => onUninstall(card.channel)}
            />
          </>
        ) : null}
        {card.state === "check-failed" ? (
          <OperationButton
            label="Try Again"
            variant="primary"
            disabled={busy}
            testId={`repair-${card.channel}`}
            onClick={() => onRepair(card.channel)}
          />
        ) : null}
      </div>

      {isActive && progressText !== null ? <ProgressPanel text={progressText} /> : null}
    </article>
  );
}
