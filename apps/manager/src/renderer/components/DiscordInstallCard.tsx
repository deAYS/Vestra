import { channelDisplayName, type DiscordChannel } from "../../shared/channels.js";
import { channelBadge } from "../../shared/channelSelect.js";
import {
  PRIMARY_LABEL,
  rowStatusText,
  type RowModel,
  type RowPrimary,
  type RowState,
} from "../../shared/statusModel.js";
import { OperationButton } from "./OperationButton.js";
import { OverflowMenu, type OverflowItem } from "./OverflowMenu.js";
import { ProgressPanel } from "./ProgressPanel.js";

export interface RowActions {
  onInstall(channel: DiscordChannel): void;
  onRepair(channel: DiscordChannel): void;
  onRetry(channel: DiscordChannel): void;
  onRestart(channel: DiscordChannel): void;
  onUninstall(channel: DiscordChannel): void;
}

interface Props extends RowActions {
  row: RowModel;
  devMode: boolean;
  busy: boolean;
  /** This row's operation is running: progress replaces the buttons. */
  working: boolean;
  progressText: string | null;
  now: Date;
}

type Tone = "ok" | "warn" | "error" | "info" | "neutral" | "pending" | "off";

const TONE: Record<RowState, Tone> = {
  active: "ok",
  "didnt-start": "warn",
  "needs-repair": "warn",
  "check-failed": "error",
  "waiting-restart": "info",
  "awaiting-login": "neutral",
  "not-started": "neutral",
  checking: "pending",
  "not-installed": "off",
};

export function DiscordInstallCard({
  row,
  devMode,
  busy,
  working,
  progressText,
  now,
  ...actions
}: Props): JSX.Element {
  const { channel } = row;
  const name = channelDisplayName(channel);
  const badge = channelBadge(channel, devMode);
  const primaryAction: Record<RowPrimary, () => void> = {
    install: () => actions.onInstall(channel),
    repair: () => actions.onRepair(channel),
    retry: () => actions.onRetry(channel),
    restart: () => actions.onRestart(channel),
  };
  // The menu never repeats the primary action (Restart Discord is a repair).
  const menu: OverflowItem[] = [];
  if (row.installed) {
    if (row.primary !== "repair" && row.primary !== "restart")
      menu.push({
        label: "Repair",
        testId: `repair-${channel}`,
        onSelect: () => actions.onRepair(channel),
      });
    menu.push({
      label: "Uninstall",
      testId: `uninstall-${channel}`,
      danger: true,
      onSelect: () => actions.onUninstall(channel),
    });
  }

  return (
    <article
      className="vs-row"
      data-testid={`install-card-${channel}`}
      data-state={row.state}
      aria-busy={working}
    >
      <div className="vs-row__main">
        <div className="vs-row__title">
          <h3>{name}</h3>
          <span className="vs-row__sep" aria-hidden="true">
            ·
          </span>
          <span className="vs-row__version" data-testid={`version-${channel}`}>
            {row.version ?? "unknown version"}
          </span>
          {badge !== undefined ? (
            <span className="vs-row__badge" data-testid={`badge-${channel}`}>
              {badge}
            </span>
          ) : null}
        </div>
        <p
          className="vs-row__status"
          data-testid={`row-status-${channel}`}
          data-state={row.state}
        >
          <span className={`vs-dot vs-dot--${TONE[row.state]}`} aria-hidden="true" />
          {rowStatusText(row, now)}
        </p>
      </div>
      <div className="vs-row__actions">
        {working ? (
          <ProgressPanel text={progressText ?? "Working…"} />
        ) : (
          <>
            {row.primary !== undefined ? (
              <OperationButton
                label={PRIMARY_LABEL[row.primary]}
                variant="primary"
                disabled={busy}
                testId={`${row.primary}-${channel}`}
                onClick={primaryAction[row.primary]}
              />
            ) : null}
            {menu.length > 0 ? (
              <OverflowMenu
                label={`More actions for ${name}`}
                testId={`row-menu-${channel}`}
                disabled={busy}
                items={menu}
              />
            ) : (
              <span className="vs-menu-slot" aria-hidden="true" />
            )}
          </>
        )}
      </div>
    </article>
  );
}
