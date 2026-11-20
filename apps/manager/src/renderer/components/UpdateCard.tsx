import { useState } from "react";
import { isCardPhase, type UpdatesState } from "../hooks/useUpdates.js";

export function UpdateCard({
  busy,
  updates,
}: {
  busy: boolean;
  updates: UpdatesState;
}): JSX.Element | null {
  const [confirm, setConfirm] = useState(false);
  const { state, run } = updates;
  if (state === null || !updates.cardVisible) return null;
  const phaseShown = isCardPhase(state.phase);
  const working = state.phase === "downloading" || state.phase === "installing";
  return (
    <section
      className="vs-update-card"
      aria-label="Vestra updates"
      aria-busy={working}
    >
      {phaseShown ? (
        <>
          <div className="vs-update-heading">
            <div>
              <h2>Vestra update</h2>
              <p>
                v{state.currentVersion}
                {state.version && state.version !== state.currentVersion
                  ? ` → v${state.version}`
                  : ""}
              </p>
            </div>
            {state.phase === "ready" || state.phase === "available" ? (
              <span className="vs-update-badge">
                {state.phase === "ready" ? "Verified" : "New release"}
              </span>
            ) : null}
          </div>
          {state.message && state.message !== state.handoffError ? (
            <p role="status">{state.message}</p>
          ) : null}
          {state.phase === "downloading" ? (
            <progress
              max={100}
              value={state.progress ?? 0}
              aria-label="Update download"
            >
              {state.progress ?? 0}%
            </progress>
          ) : null}
        </>
      ) : null}
      {state.handoffError ? (
        <div role="alert" className="vs-update-error">
          <span>{state.handoffError}</span>
          <button
            type="button"
            className="vs-btn vs-btn--secondary"
            onClick={() => run(() => window.vestraManager.dismissUpdateError())}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {phaseShown ? (
        <div className="vs-update-actions">
          {state.phase === "error" ? (
            <button
              type="button"
              className="vs-btn vs-btn--secondary"
              disabled={busy || !state.supported}
              onClick={() => run(() => window.vestraManager.checkUpdate())}
            >
              Check for updates
            </button>
          ) : null}
          {state.phase === "available" ? (
            <button
              type="button"
              className="vs-btn vs-btn--primary"
              disabled={busy}
              onClick={() => run(() => window.vestraManager.downloadUpdate())}
            >
              Download update
            </button>
          ) : null}
          {state.phase === "ready" ? (
            <button
              type="button"
              className="vs-btn vs-btn--primary"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Install update…
            </button>
          ) : null}
        </div>
      ) : null}
      {confirm ? (
        <div
          className="vs-update-confirm"
          role="alertdialog"
          aria-label="Install Vestra update"
          aria-describedby="vestra-update-warning"
        >
          <strong>Ready to restart?</strong>
          <p id="vestra-update-warning">
            Manager and Discord installations using Vestra will restart. Active
            calls and streams will disconnect. Your themes, plugins and
            preferences will stay.
          </p>
          <div className="vs-update-actions">
            <button
              type="button"
              className="vs-btn vs-btn--secondary"
              onClick={() => setConfirm(false)}
            >
              Later
            </button>
            <button
              type="button"
              className="vs-btn vs-btn--primary"
              disabled={busy || working}
              onClick={() => {
                setConfirm(false);
                run(() => window.vestraManager.installUpdate());
              }}
            >
              Install and restart
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
