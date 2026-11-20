import type { DiscordChannel } from "../../shared/channels.js";
import {
  applyDeepResult,
  cardFromShallow,
  rowModel,
  type CardModel,
  type RowModel,
} from "../../shared/statusModel.js";
import type { ChannelRecovery } from "../../main/recovery/state.js";
import type { ManagerState } from "../hooks/useManager.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DiscordInstallList } from "../components/DiscordInstallList.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { Header } from "../components/Header.js";
import { RecoverySettings } from "../components/RecoverySettings.js";
import { UpdateCard } from "../components/UpdateCard.js";

function cardFor(manager: ManagerState, channel: DiscordChannel, version: string | null): CardModel {
  const shallow = manager.shallow[channel];
  const base: CardModel =
    shallow !== undefined
      ? cardFromShallow(shallow)
      : { channel, version, state: "not-installed" };
  if (base.state === "not-installed") return base;
  if (manager.checking.includes(channel))
    return { ...base, state: "installed-checking" };
  return applyDeepResult(base, manager.deep[channel]);
}

export function HomePage({ manager }: { manager: ManagerState }): JSX.Element {
  const rows: RowModel[] = manager.installations.map(({ channel, version }) => {
    const status = manager.run[channel];
    return rowModel(cardFor(manager, channel, version), status?.run, status?.recovery);
  });
  const recovery: Partial<Record<DiscordChannel, ChannelRecovery>> = {};
  for (const { channel } of manager.installations) {
    const record = manager.run[channel]?.recovery;
    if (record !== undefined) recovery[channel] = record;
  }

  const busy = manager.activeOp !== null;

  return (
    <div className="vs-home">
      <Header
        refreshing={manager.refreshing}
        onRefresh={() => void manager.refresh()}
      />
      <UpdateCard busy={busy} />
      <section className="vs-installs" aria-label="Discord installations">
        {!manager.booted ? (
          <div className="vs-empty" data-testid="boot-loading">
            Looking for Discord…
          </div>
        ) : manager.discoveryError !== null ? (
          <div className="vs-error" data-testid="discovery-error" role="alert">
            <div className="vs-error__title">Discord discovery failed.</div>
            <div className="vs-error__hint">
              {manager.discoveryError.detail ??
                "Could not reach the installer bridge."}
            </div>
            <div className="vs-error__actions">
              <button
                type="button"
                className="vs-btn vs-btn--secondary"
                onClick={() => void manager.refresh()}
                data-testid="discovery-retry"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <DiscordInstallList
            rows={rows}
            devMode={manager.devMode}
            busy={busy}
            workingChannel={manager.activeOp?.channel ?? null}
            progressText={manager.progressText}
            onInstall={(c) => void manager.install(c)}
            onRepair={(c) => void manager.repair(c)}
            onRetry={(c) => void manager.retry(c)}
            onRestart={(c) => void manager.restart(c)}
            onUninstall={manager.requestUninstall}
          />
        )}
      </section>

      {manager.notice !== null ? (
        <div className="vs-notice" data-testid="notice" role="status">
          <span className="vs-notice__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m6 12 4 4 8-8" />
            </svg>
          </span>
          <div className="vs-notice__copy">
            <strong>All set</strong>
            <p>{manager.notice}</p>
          </div>
          <button
            type="button"
            onClick={manager.dismissNotice}
            data-testid="notice-dismiss"
            className="vs-notice__close"
            aria-label="Close notification"
            title="Close notification"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      ) : null}

      {manager.error !== null ? (
        <ErrorPanel
          code={manager.error.code}
          detail={manager.error.detail}
          message={manager.error.message}
          onDismiss={manager.dismissError}
        />
      ) : null}

      <RecoverySettings busy={busy} recovery={recovery} />

      {manager.confirm !== null ? (
        <ConfirmDialog
          kind={manager.confirm.kind}
          channel={manager.confirm.channel}
          busy={busy}
          onCancel={manager.cancelConfirm}
          onConfirm={() => void manager.confirmNow()}
        />
      ) : null}
    </div>
  );
}
