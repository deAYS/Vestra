import { useEffect, useState } from "react";
import type { UpdateState } from "../../shared/updates.js";

export function UpdateCard({ busy }: { busy: boolean }): JSX.Element {
  const [state, setState] = useState<UpdateState | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    const api = window.vestraManager;
    const unsubscribe = api.onUpdate((value) => {
      if (active) setState(value);
    });
    void api
      .updateState()
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const run = (action: () => Promise<UpdateState>): void => {
    void action()
      .then(setState)
      .catch((error) =>
        setState((previous) => ({
          ...previous!,
          phase: "error",
          message: String(error),
        })),
      );
  };
  if (!state) return <></>;
  const working = ["checking", "downloading", "installing"].includes(
    state.phase,
  );
  return (
    <section
      className="vs-update-card"
      aria-label="Vestra updates"
      aria-busy={working}
    >
      <div className="vs-update-heading">
        <div>
          <h2>Vestra updates</h2>
          <p>
            v{state.currentVersion}
            {state.version && state.phase !== "current"
              ? ` → v${state.version}`
              : ""}
          </p>
        </div>
        <span className="vs-update-badge">
          {state.phase === "ready"
            ? "Verified"
            : state.phase === "available"
              ? "New release"
              : "GitHub releases"}
        </span>
      </div>
      <p role="status">{state.message ?? "Check for a new release."}</p>
      {state.phase === "downloading" ? (
        <progress
          max={100}
          value={state.progress ?? 0}
          aria-label="Update download"
        >
          {state.progress ?? 0}%
        </progress>
      ) : null}
      <div className="vs-update-actions">
        <button
          className="vs-btn vs-btn--secondary"
          disabled={
            busy || working || !state.supported || state.phase === "ready"
          }
          onClick={() => run(() => window.vestraManager.checkUpdate())}
        >
          Check for updates
        </button>
        {state.phase === "available" ? (
          <button
            className="vs-btn"
            disabled={busy}
            onClick={() => run(() => window.vestraManager.downloadUpdate())}
          >
            Download update
          </button>
        ) : null}
        {state.phase === "ready" ? (
          <button
            className="vs-btn"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Install update…
          </button>
        ) : null}
      </div>
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
              className="vs-btn vs-btn--secondary"
              onClick={() => setConfirm(false)}
            >
              Later
            </button>
            <button
              className="vs-btn"
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
