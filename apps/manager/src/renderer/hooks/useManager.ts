// Vestra Manager — state orchestration hook.
// Startup: discover() -> cheap status() -> cards render -> async deep
// check() per apparently-installed channel. Deep verification never blocks
// the initial paint. All mutations target ONE selected channel.

import { useCallback, useEffect, useRef, useState } from "react";
import { channelDisplayName, type DiscordChannel } from "../../shared/channels.js";
import { selectDefaultChannel } from "../../shared/channelSelect.js";
import {
  ALREADY_HEALTHY_MESSAGE,
  runInstallFlow,
  runRepairFlow,
  runUninstallFlow,
} from "../../shared/flows.js";
import type {
  DiscordInstallation,
  InstallerErrorCode,
  InstallerProgressEvent,
  InstallStatus,
} from "../../shared/types.js";
import { managerApi } from "../types.js";

export type OperationKind = "install" | "repair" | "uninstall";

export interface OperationError {
  code: InstallerErrorCode | string | undefined;
  detail: string | undefined;
  message: string;
}

export interface ManagerState {
  booted: boolean;
  refreshing: boolean;
  devMode: boolean;
  installations: DiscordInstallation[];
  shallow: Partial<Record<DiscordChannel, InstallStatus>>;
  deep: Partial<Record<DiscordChannel, InstallStatus>>;
  checking: DiscordChannel[];
  selected: DiscordChannel | undefined;
  activeOp: { channel: DiscordChannel; kind: OperationKind } | null;
  progress: InstallerProgressEvent | null;
  progressText: string | null;
  error: OperationError | null;
  errorChannel: DiscordChannel | null;
  notice: string | null;
  confirmUninstall: DiscordChannel | null;
  refresh(): Promise<void>;
  select(channel: DiscordChannel): void;
  install(channel: DiscordChannel): Promise<void>;
  repair(channel: DiscordChannel): Promise<void>;
  requestUninstall(channel: DiscordChannel): void;
  cancelUninstall(): void;
  confirmUninstallNow(): Promise<void>;
  dismissError(): void;
  dismissNotice(): void;
}

function phaseText(event: InstallerProgressEvent): string {
  switch (event.phase) {
    case "discovering":
      return "Preparing Vestra...";
    case "staging":
      return "Staging Vestra...";
    case "patching": {
      const label = event.installation
        ? channelDisplayName(event.installation.channel)
        : "Discord";
      return `Patching ${label}...`;
    }
    case "verifying":
      return "Verifying...";
    case "complete":
      return "Done.";
  }
}

export function useManager(): ManagerState {
  const [booted, setBooted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [devMode] = useState(() => {
    try {
      return managerApi().isDevelopmentBuild();
    } catch {
      return false;
    }
  });
  const [installations, setInstallations] = useState<DiscordInstallation[]>([]);
  const [shallow, setShallow] = useState<Partial<Record<DiscordChannel, InstallStatus>>>({});
  const [deep, setDeep] = useState<Partial<Record<DiscordChannel, InstallStatus>>>({});
  const [checking, setChecking] = useState<DiscordChannel[]>([]);
  const [selected, setSelected] = useState<DiscordChannel | undefined>(undefined);
  const [activeOp, setActiveOp] = useState<{ channel: DiscordChannel; kind: OperationKind } | null>(
    null,
  );
  const [progress, setProgress] = useState<InstallerProgressEvent | null>(null);
  const [error, setError] = useState<OperationError | null>(null);
  const [errorChannel, setErrorChannel] = useState<DiscordChannel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<DiscordChannel | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const devModeRef = useRef(devMode);
  devModeRef.current = devMode;

  const checkOne = useCallback(async (channel: DiscordChannel): Promise<void> => {
    setChecking((prev) => (prev.includes(channel) ? prev : [...prev, channel]));
    try {
      const result = await managerApi().check({ channels: [channel] });
      if (!mounted.current) return;
      const found = result.statuses.find((s) => s.installation.channel === channel);
      if (found !== undefined) {
        setDeep((prev) => ({ ...prev, [channel]: found }));
      }
    } catch (err: unknown) {
      if (!mounted.current) return;
      const detail = err instanceof Error ? err.message : String(err);
      setDeep((prev) => ({
        ...prev,
        [channel]: {
          installation: prev[channel]?.installation ?? {
            channel,
            version: null,
            rootDir: "",
            appDir: "",
            asarPath: "",
            isActive: true,
          },
          health: "error",
          vestraInstalled: false,
          repairable: true,
          detail,
          code: "unknown",
        },
      }));
    } finally {
      if (mounted.current) {
        setChecking((prev) => prev.filter((c) => c !== channel));
      }
    }
  }, []);

  const load = useCallback(
    async (isRefresh: boolean): Promise<void> => {
      if (isRefresh) {
        setRefreshing(true);
      }
      setError(null);
      setErrorChannel(null);
      try {
        const found = await managerApi().discover();
        if (!mounted.current) return;
        setInstallations(found);
        const channels = found.map((f) => f.channel);
        setSelected((prev) => {
          if (prev !== undefined && channels.includes(prev)) return prev;
          return selectDefaultChannel(channels, devModeRef.current);
        });
        const summary = await managerApi().status();
        if (!mounted.current) return;
        const next: Partial<Record<DiscordChannel, InstallStatus>> = {};
        for (const s of summary.statuses) next[s.installation.channel] = s;
        setShallow(next);
        // Deep verification runs async per apparently-installed channel.
        const installed = summary.statuses.filter((s) => s.vestraInstalled);
        if (!isRefresh) setBooted(true);
        for (const s of installed) {
          await checkOne(s.installation.channel);
        }
      } catch (err: unknown) {
        if (!mounted.current) return;
        const detail = err instanceof Error ? err.message : String(err);
        setError({ code: "unknown", detail, message: "Something went wrong." });
        setBooted(true);
      } finally {
        if (mounted.current && isRefresh) setRefreshing(false);
        if (mounted.current && !isRefresh) setBooted(true);
      }
    },
    [checkOne],
  );

  useEffect(() => {
    const off = (() => {
      try {
        return managerApi().onProgress((event) => {
          if (!mounted.current) return;
          setProgress(event);
        });
      } catch {
        return undefined;
      }
    })();
    void load(false);
    return () => {
      if (typeof off === "function") off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setDeep({});
    await load(true);
  }, [load]);

  const select = useCallback((channel: DiscordChannel): void => {
    setSelected(channel);
    setNotice(null);
  }, []);

  const finishMutation = useCallback(
    async (channel: DiscordChannel): Promise<void> => {
      const summary = await managerApi().status({ channels: [channel] });
      if (!mounted.current) return;
      const found = summary.statuses.find((s) => s.installation.channel === channel);
      if (found !== undefined) {
        setShallow((prev) => ({ ...prev, [channel]: found }));
      }
      await checkOne(channel);
    },
    [checkOne],
  );

  const install = useCallback(
    async (channel: DiscordChannel): Promise<void> => {
      setActiveOp({ channel, kind: "install" });
      setProgress(null);
      setError(null);
      setErrorChannel(null);
      setNotice(null);
      try {
        const result = await runInstallFlow(managerApi(), channel);
        if (!mounted.current) return;
        await finishMutation(channel);
        if (result.ok) {
          setNotice("Vestra installed successfully.");
        } else {
          setError({
            code: result.code,
            detail: result.detail,
            message: result.message,
          });
          setErrorChannel(channel);
        }
      } catch (err: unknown) {
        if (!mounted.current) return;
        const detail = err instanceof Error ? err.message : String(err);
        setError({ code: "unknown", detail, message: "Installation failed." });
        setErrorChannel(channel);
      } finally {
        if (mounted.current) setActiveOp(null);
      }
    },
    [finishMutation],
  );

  const repair = useCallback(
    async (channel: DiscordChannel): Promise<void> => {
      setActiveOp({ channel, kind: "repair" });
      setProgress(null);
      setError(null);
      setErrorChannel(null);
      setNotice(null);
      try {
        const result = await runRepairFlow(managerApi(), channel);
        if (!mounted.current) return;
        if (result.ok && !result.repaired) {
          setNotice(ALREADY_HEALTHY_MESSAGE);
          await finishMutation(channel);
          return;
        }
        await finishMutation(channel);
        if (result.ok) {
          setNotice("Vestra repaired successfully.");
        } else {
          setError({ code: result.code, detail: result.detail, message: result.message });
          setErrorChannel(channel);
        }
      } catch (err: unknown) {
        if (!mounted.current) return;
        const detail = err instanceof Error ? err.message : String(err);
        setError({ code: "unknown", detail, message: "Repair failed." });
        setErrorChannel(channel);
      } finally {
        if (mounted.current) setActiveOp(null);
      }
    },
    [finishMutation],
  );

  const requestUninstall = useCallback((channel: DiscordChannel): void => {
    setConfirmUninstall(channel);
  }, []);

  const cancelUninstall = useCallback((): void => {
    setConfirmUninstall(null);
  }, []);

  const confirmUninstallNow = useCallback(async (): Promise<void> => {
    const channel = confirmUninstall;
    if (channel === null) return;
    setConfirmUninstall(null);
    setActiveOp({ channel, kind: "uninstall" });
    setProgress(null);
    setError(null);
    setErrorChannel(null);
    setNotice(null);
    try {
      const result = await runUninstallFlow(managerApi(), channel);
      if (!mounted.current) return;
      await finishMutation(channel);
      if (result.ok) {
        setNotice("Vestra was removed.");
      } else {
        setError({ code: result.code, detail: result.detail, message: result.message });
        setErrorChannel(channel);
      }
    } catch (err: unknown) {
      if (!mounted.current) return;
      const detail = err instanceof Error ? err.message : String(err);
      setError({ code: "unknown", detail, message: "Uninstall failed." });
      setErrorChannel(channel);
    } finally {
      if (mounted.current) setActiveOp(null);
    }
  }, [confirmUninstall, finishMutation]);

  const dismissError = useCallback((): void => {
    setError(null);
    setErrorChannel(null);
  }, []);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  return {
    booted,
    refreshing,
    devMode,
    installations,
    shallow,
    deep,
    checking,
    selected,
    activeOp,
    progress,
    progressText: progress === null ? null : phaseText(progress),
    error,
    errorChannel,
    notice,
    confirmUninstall,
    refresh,
    select,
    install,
    repair,
    requestUninstall,
    cancelUninstall,
    confirmUninstallNow,
    dismissError,
    dismissNotice,
  };
}
