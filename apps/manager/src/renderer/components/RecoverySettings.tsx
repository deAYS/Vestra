import { useEffect, useState } from "react";
import { managerApi } from "../types.js";
import type { DiscordChannel } from "../../shared/channels.js";
import type { MaintenanceStatus } from "../../shared/types.js";
import { lastReinstall, recoverySubline } from "../../shared/statusModel.js";
import type { ChannelRecovery } from "../../main/recovery/state.js";

const LABEL = "Keep Vestra installed after Discord updates";

interface Props {
  busy: boolean;
  recovery: Partial<Record<DiscordChannel, ChannelRecovery>>;
}

export function RecoverySettings({ busy, recovery }: Props): JSX.Element {
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
  const last = lastReinstall(recovery);
  const subline =
    status && !status.available
      ? "Available in the Windows Setup and Portable builds."
      : status?.available && status.channels.length === 0
        ? "Turns on when you install Vestra."
        : last !== undefined
          ? recoverySubline(last, new Date())
          : null;
  return (
    <footer className="vs-recovery" aria-label="Automatic recovery">
      <label className="vs-recovery__label">
        <input
          type="checkbox"
          aria-label={LABEL}
          checked={status?.enabled ?? false}
          disabled={
            busy || saving || !status?.available || status.channels.length === 0
          }
          onChange={(event) => void update(event.currentTarget.checked)}
        />
        <span className="vs-recovery__text">
          <span className="vs-recovery__title">{LABEL}</span>
          {subline !== null ? (
            <span className="vs-recovery__sub" data-testid="recovery-subline">
              {subline}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p className="vs-recovery__error" role="alert">
          {error}
        </p>
      ) : null}
    </footer>
  );
}
