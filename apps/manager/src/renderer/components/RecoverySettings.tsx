import { useEffect, useState } from "react";
import { managerApi } from "../types.js";
import type { MaintenanceStatus } from "../../shared/types.js";

export function RecoverySettings({ busy }: { busy: boolean }): JSX.Element {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void managerApi()
      .maintenanceStatus?.()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active)
          setError("Recovery status is unavailable. Refresh the Manager.");
      });
    return () => {
      active = false;
    };
  }, [busy]);
  const update = async (enabled: boolean): Promise<void> => {
    setSaving(true);
    setError("");
    try {
      setStatus(await managerApi().setMaintenance(enabled));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="vs-recovery" aria-label="Automatic recovery">
      <label className="vs-recovery__label">
        <span>
          <strong>Keep Vestra installed</strong>
          <span className="vs-recovery__description">
            Recover after Discord updates, including after a PC restart. Runs
            quietly at Windows sign-in and restarts Discord after restoring
            Vestra.
          </span>
        </span>
        <input
          type="checkbox"
          aria-label="Keep Vestra installed"
          checked={status?.enabled ?? false}
          disabled={
            busy || saving || !status?.available || status.channels.length === 0
          }
          onChange={(event) => void update(event.currentTarget.checked)}
        />
      </label>
      {status && !status.available ? (
        <small>Available in the Windows Setup and Portable builds.</small>
      ) : null}
      {status?.available && status.channels.length === 0 ? (
        <small>
          Enabled automatically when you install Vestra. You can turn it off
          here.
        </small>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
