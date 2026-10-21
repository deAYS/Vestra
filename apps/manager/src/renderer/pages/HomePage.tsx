import {
  applyDeepResult,
  cardFromShallow,
  type CardModel,
} from "../../shared/statusModel.js";
import type { ManagerState } from "../hooks/useManager.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DiscordInstallList } from "../components/DiscordInstallList.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { Header } from "../components/Header.js";
import { RecoverySettings } from "../components/RecoverySettings.js";

export function HomePage({ manager }: { manager: ManagerState }): JSX.Element {
  const cards: CardModel[] = manager.installations.map((installation) => {
    const shallow = manager.shallow[installation.channel];
    const base: CardModel =
      shallow !== undefined
        ? cardFromShallow(shallow)
        : {
            channel: installation.channel,
            version: installation.version,
            state: "not-installed",
          };
    if (
      manager.checking.includes(installation.channel) &&
      base.state !== "not-installed"
    ) {
      return { ...base, state: "installed-checking" as const };
    }
    const deep = manager.deep[installation.channel];
    if (deep !== undefined && base.state !== "not-installed") {
      return applyDeepResult(base, deep);
    }
    return base;
  });

  const busy = manager.activeOp !== null;

  return (
    <div>
      <Header
        refreshing={manager.refreshing}
        onRefresh={() => void manager.refresh()}
      />
      <section>
        <h2 className="vs-section-title">Discord installations</h2>
        <p className="vs-operation-hint">
          Install and Repair close the selected Discord, replace Vestra, verify
          the files and reopen Discord. Active calls and streams will
          disconnect.
        </p>
        {!manager.booted ? (
          <div data-testid="boot-loading">
            Discovering Discord installations...
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
            cards={cards}
            devMode={manager.devMode}
            selected={manager.selected}
            busy={busy}
            activeOp={manager.activeOp}
            progressText={manager.progressText}
            onSelect={manager.select}
            onInstall={(c) => void manager.install(c)}
            onRepair={(c) => void manager.repair(c)}
            onUninstall={manager.requestUninstall}
          />
        )}
      </section>
      <RecoverySettings busy={busy} />

      {manager.notice !== null ? (
        <div className="vs-notice" data-testid="notice" role="status">
          <span className="vs-notice__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8" /></svg></span>
          <div className="vs-notice__copy"><strong>All set</strong><p>{manager.notice}</p></div>
          <button
            type="button"
            onClick={manager.dismissNotice}
            data-testid="notice-dismiss"
            className="vs-notice__close"
            aria-label="Close notification"
            title="Close notification"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
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

      {manager.confirmUninstall !== null ? (
        <ConfirmDialog
          channel={manager.confirmUninstall}
          busy={busy}
          onCancel={manager.cancelUninstall}
          onConfirm={() => void manager.confirmUninstallNow()}
        />
      ) : null}
    </div>
  );
}
