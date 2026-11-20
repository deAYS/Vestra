import { useCallback, useEffect, useRef, useState } from "react";
import {
  channelDisplayName,
  type DiscordChannel,
} from "../../shared/channels.js";
import {
  composeNotice,
  runInstallFlow,
  runRepairFlow,
  runUninstallFlow,
  type FlowErr,
  type FlowOk,
  type ServiceLike,
} from "../../shared/flows.js";
import type {
  DiscordInstallation,
  InstallerErrorCode,
  InstallerProgressEvent,
  InstallStatus,
  RunStatusMap,
} from "../../shared/types.js";
import { managerApi } from "../types.js";

export type OperationKind = "install" | "repair" | "uninstall" | "restart";

/** Operations that ask first: uninstall always, install/repair only while Discord runs. */
export type ConfirmKind = "install" | "repair" | "uninstall";

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
  run: RunStatusMap;
  activeOp: { channel: DiscordChannel; kind: OperationKind } | null;
  progress: InstallerProgressEvent | null;
  progressText: string | null;
  error: OperationError | null;
  errorChannel: DiscordChannel | null;
  /** discover() itself threw (or the bridge is unreachable). Distinct from []. */
  discoveryError: OperationError | null;
  notice: string | null;
  confirm: { kind: ConfirmKind; channel: DiscordChannel } | null;
  refresh(): Promise<void>;
  install(channel: DiscordChannel): Promise<void>;
  repair(channel: DiscordChannel): Promise<void>;
  restart(channel: DiscordChannel): Promise<void>;
  retry(channel: DiscordChannel): Promise<void>;
  requestUninstall(channel: DiscordChannel): void;
  cancelConfirm(): void;
  confirmNow(): Promise<void>;
  dismissError(): void;
  dismissNotice(): void;
}

/** Start status changes outside the Manager (Discord opens, recovery runs). */
const RUN_STATUS_POLL_MS = 15000;

function phaseText(event: InstallerProgressEvent): string {
  switch (event.phase) {
    case "discovering":
      return "Preparing Vestra…";
    case "staging":
      return "Staging Vestra…";
    case "stopping":
      return "Closing Discord…";
    case "restarting":
      return "Restarting Discord…";
    case "patching": {
      const label = event.installation
        ? channelDisplayName(event.installation.channel)
        : "Discord";
      return `Patching ${label}…`;
    }
    case "verifying":
      return "Verifying…";
    case "complete":
      return "Done.";
  }
}

const OPERATIONS: Record<
  OperationKind,
  {
    flow: (service: ServiceLike, channel: DiscordChannel) => Promise<FlowOk | FlowErr>;
    success: string;
    failure: string;
  }
> = {
  install: {
    flow: runInstallFlow,
    success: "Vestra installed successfully.",
    failure: "Installation failed.",
  },
  repair: {
    flow: runRepairFlow,
    success: "Vestra repaired successfully.",
    failure: "Repair failed.",
  },
  restart: {
    // Restart Discord is recovery's repair: close, patch, verify, reopen.
    flow: (service, channel) =>
      runRepairFlow(
        {
          ...service,
          repair: (args) => managerApi().restartDiscord(args),
        },
        channel,
      ),
    success: "Discord restarted with Vestra.",
    failure: "Restart failed.",
  },
  uninstall: {
    flow: runUninstallFlow,
    success: "Vestra was removed.",
    failure: "Uninstall failed.",
  },
};

function bridgeService(): ServiceLike {
  const api = managerApi();
  return {
    check: (args) => api.check(args),
    install: (args) => api.install(args),
    repair: (args) => api.repair(args),
    uninstall: (args) => api.uninstall(args),
  };
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
  const [shallow, setShallow] = useState<
    Partial<Record<DiscordChannel, InstallStatus>>
  >({});
  const [deep, setDeep] = useState<
    Partial<Record<DiscordChannel, InstallStatus>>
  >({});
  const [checking, setChecking] = useState<DiscordChannel[]>([]);
  const [run, setRun] = useState<RunStatusMap>({});
  const [activeOp, setActiveOp] = useState<{
    channel: DiscordChannel;
    kind: OperationKind;
  } | null>(null);
  const [progress, setProgress] = useState<InstallerProgressEvent | null>(null);
  const [error, setError] = useState<OperationError | null>(null);
  const [errorChannel, setErrorChannel] = useState<DiscordChannel | null>(null);
  const [discoveryError, setDiscoveryError] = useState<OperationError | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: ConfirmKind;
    channel: DiscordChannel;
  } | null>(null);
  const mounted = useRef(true);
  /** Set synchronously so a double click cannot start two operations. */
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const devModeRef = useRef(devMode);
  devModeRef.current = devMode;

  /** Last seen recovery record per channel, to notice background re-installs. */
  const recoverySeen = useRef<Partial<Record<DiscordChannel, string>>>({});

  /**
   * A failed read keeps what is shown; with nothing shown rows read neutral.
   * Returns channels whose recovery record changed since the previous read.
   */
  const loadRun = useCallback(async (): Promise<DiscordChannel[]> => {
    let next: RunStatusMap;
    try {
      next = await managerApi().runStatus();
    } catch {
      /* bridge or file trouble: never a reason to claim a state */
      return [];
    }
    if (!mounted.current) return [];
    setRun(next);
    const changed: DiscordChannel[] = [];
    for (const [key, status] of Object.entries(next)) {
      const channel = key as DiscordChannel;
      const record = status?.recovery;
      const seen = record
        ? `${record.phase}|${record.version ?? ""}|${record.at}`
        : "";
      const before = recoverySeen.current[channel];
      if (before !== undefined && before !== seen) changed.push(channel);
      recoverySeen.current[channel] = seen;
    }
    return changed;
  }, []);

  const checkOne = useCallback(
    async (channel: DiscordChannel): Promise<void> => {
      setChecking((prev) =>
        prev.includes(channel) ? prev : [...prev, channel],
      );
      try {
        const result = await managerApi().check({ channels: [channel] });
        if (!mounted.current) return;
        const found = result.statuses.find(
          (s) => s.installation.channel === channel,
        );
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
    },
    [],
  );

  const load = useCallback(
    async (isRefresh: boolean): Promise<void> => {
      if (isRefresh) {
        setRefreshing(true);
      }
      setError(null);
      setErrorChannel(null);
      setDiscoveryError(null);
      try {
        let found: DiscordInstallation[];
        try {
          // TEMPORARY dev-only diagnostics (validation phase): trace the
          // initial discover call. Error/empty-list semantics unchanged.
          if (devModeRef.current) {
            console.log("[Vestra Manager] renderer discover start");
          }
          found = await managerApi().discover();
          if (devModeRef.current) {
            console.log(
              `[Vestra Manager] renderer discover result: ${found.length}`,
            );
          }
        } catch (err: unknown) {
          // Discovery failure is NOT an empty list: the bridge may be down
          // (e.g. preload failed) or the service threw. Surface it distinctly
          // and never erase previously discovered installations here —
          // callers only replace them on success below.
          if (!mounted.current) return;
          const detail = err instanceof Error ? err.message : String(err);
          if (devModeRef.current) {
            console.error(
              `[Vestra Manager] renderer discover error: ${detail}`,
            );
          }
          setDiscoveryError({
            code: "unknown",
            detail,
            message: "Discord discovery failed.",
          });
          return;
        }
        if (!mounted.current) return;
        setInstallations(found);
        const summary = await managerApi().status();
        if (!mounted.current) return;
        const next: Partial<Record<DiscordChannel, InstallStatus>> = {};
        for (const s of summary.statuses) next[s.installation.channel] = s;
        setShallow(next);
        // Start status before deep checks, so rows don't flash a neutral line.
        await loadRun();
        if (!mounted.current) return;
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
    [checkOne, loadRun],
  );

  /**
   * Background refresh. Recovery can re-install Vestra while the Manager is
   * open; when a channel's recovery record changes, re-read that row's files
   * too, since file state outranks start status in the row.
   */
  const pollRun = useCallback(async (): Promise<void> => {
    const changed = await loadRun();
    for (const channel of changed) {
      if (busy.current || !mounted.current) return;
      try {
        const summary = await managerApi().status({ channels: [channel] });
        if (!mounted.current) return;
        const found = summary.statuses.find(
          (s) => s.installation.channel === channel,
        );
        if (found === undefined) continue;
        setShallow((prev) => ({ ...prev, [channel]: found }));
        if (found.vestraInstalled) await checkOne(channel);
      } catch {
        /* shown again on the next Refresh */
      }
    }
  }, [checkOne, loadRun]);

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
    const poll = setInterval(() => void pollRun(), RUN_STATUS_POLL_MS);
    const onFocus = (): void => void pollRun();
    window.addEventListener("focus", onFocus);
    return () => {
      if (typeof off === "function") off();
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setDeep({});
    await load(true);
  }, [load]);

  const finishMutation = useCallback(
    async (channel: DiscordChannel): Promise<void> => {
      const summary = await managerApi().status({ channels: [channel] });
      if (!mounted.current) return;
      const found = summary.statuses.find(
        (s) => s.installation.channel === channel,
      );
      if (found !== undefined) {
        setShallow((prev) => ({ ...prev, [channel]: found }));
      }
      await loadRun();
      await checkOne(channel);
    },
    [checkOne, loadRun],
  );

  /** Caller holds `busy`; this always releases it. */
  const perform = useCallback(
    async (channel: DiscordChannel, kind: OperationKind): Promise<void> => {
      const operation = OPERATIONS[kind];
      busy.current = true;
      setActiveOp({ channel, kind });
      setProgress(null);
      setError(null);
      setErrorChannel(null);
      setNotice(null);
      try {
        const result = await operation.flow(bridgeService(), channel);
        if (!mounted.current) return;
        await finishMutation(channel);
        if (result.ok) {
          setNotice(composeNotice(operation.success, result.warning));
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
        setError({ code: "unknown", detail, message: operation.failure });
        setErrorChannel(channel);
      } finally {
        busy.current = false;
        if (mounted.current) setActiveOp(null);
      }
    },
    [finishMutation],
  );

  /** Install/Repair warn first only when that Discord is open (it will restart). */
  const closeAndRun = useCallback(
    async (channel: DiscordChannel, kind: "install" | "repair"): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      setActiveOp({ channel, kind });
      setProgress(null);
      let running = true;
      try {
        running = await managerApi().discordRunning({ channels: [channel] });
      } catch {
        // Unknown: warn rather than close Discord unannounced.
        running = true;
      }
      if (!mounted.current) return;
      if (running) {
        busy.current = false;
        setActiveOp(null);
        setConfirm({ kind, channel });
        return;
      }
      await perform(channel, kind);
    },
    [perform],
  );

  const install = useCallback(
    (channel: DiscordChannel) => closeAndRun(channel, "install"),
    [closeAndRun],
  );
  const repair = useCallback(
    (channel: DiscordChannel) => closeAndRun(channel, "repair"),
    [closeAndRun],
  );

  const restart = useCallback(
    async (channel: DiscordChannel): Promise<void> => {
      if (busy.current) return;
      await perform(channel, "restart");
    },
    [perform],
  );

  const retry = useCallback(
    async (channel: DiscordChannel): Promise<void> => {
      await checkOne(channel);
      await loadRun();
    },
    [checkOne, loadRun],
  );

  const requestUninstall = useCallback((channel: DiscordChannel): void => {
    if (busy.current) return;
    setConfirm({ kind: "uninstall", channel });
  }, []);

  const cancelConfirm = useCallback((): void => {
    setConfirm(null);
  }, []);

  const confirmNow = useCallback(async (): Promise<void> => {
    if (confirm === null || busy.current) return;
    setConfirm(null);
    await perform(confirm.channel, confirm.kind);
  }, [confirm, perform]);

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
    run,
    activeOp,
    progress,
    progressText: progress === null ? null : phaseText(progress),
    error,
    errorChannel,
    discoveryError,
    notice,
    confirm,
    refresh,
    install,
    repair,
    restart,
    retry,
    requestUninstall,
    cancelConfirm,
    confirmNow,
    dismissError,
    dismissNotice,
  };
}
