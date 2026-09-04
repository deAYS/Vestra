// Vestra Manager — installation card list. Only discovered installs render;
// missing channels never get fake entries.

import type { DiscordChannel } from "../../shared/channels.js";
import type { CardModel } from "../../shared/statusModel.js";
import type { OperationKind } from "../hooks/useManager.js";
import { DiscordInstallCard } from "./DiscordInstallCard.js";

interface Props {
  cards: CardModel[];
  devMode: boolean;
  selected: DiscordChannel | undefined;
  busy: boolean;
  activeOp: { channel: DiscordChannel; kind: OperationKind } | null;
  progressText: string | null;
  onSelect(channel: DiscordChannel): void;
  onInstall(channel: DiscordChannel): void;
  onRepair(channel: DiscordChannel): void;
  onUninstall(channel: DiscordChannel): void;
}

export function DiscordInstallList(props: Props): JSX.Element {
  if (props.cards.length === 0) {
    return (
      <div className="vs-empty" data-testid="install-list-empty">
        No Discord installations detected.
      </div>
    );
  }
  return (
    <div className="vs-list" data-testid="install-list">
      {props.cards.map((card) => (
        <DiscordInstallCard
          key={card.channel}
          card={card}
          devMode={props.devMode}
          selected={props.selected === card.channel}
          busy={props.busy}
          activeOp={props.activeOp}
          progressText={props.progressText}
          onSelect={props.onSelect}
          onInstall={props.onInstall}
          onRepair={props.onRepair}
          onUninstall={props.onUninstall}
        />
      ))}
    </div>
  );
}
