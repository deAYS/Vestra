import { useCallback, useEffect, useState } from "react";
import type { SettingsStore, VestraSettings } from "../api/settings.js";

/** Re-render on every Settings change. Unsubscribes on unmount. */
export function useSettingsSnapshot(settings: SettingsStore): Readonly<VestraSettings> {
  const [snapshot, setSnapshot] = useState<Readonly<VestraSettings>>(() =>
    settings.getSnapshot(),
  );
  useEffect(
    () =>
      settings.subscribe((next) => {
        setSnapshot(next);
      }),
    [settings],
  );
  return snapshot;
}

/** Bump to force a fresh `PluginManager.list()` read after async toggles. */
export function useRefreshCounter(): { rev: number; refresh: () => void } {
  const [rev, setRev] = useState(0);
  const refresh = useCallback(() => { setRev(r => r + 1); }, []);
  return {
    rev,
    refresh,
  };
}
