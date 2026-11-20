import { app, BrowserWindow, Notification } from "electron";
import * as fs from "node:fs";
import {
  createInstallerService,
  toErrorCode,
  withInstallLock,
} from "@vestra/installer";
import { registerManagerIpc } from "./installerBridge.js";
import { createServiceContext } from "./serviceContext.js";
import { createManagerWindow } from "./window.js";
import { ManagerUpdates } from "./updates.js";
import * as path from "node:path";
import {
  DiscordLifecycle,
  processesUnder,
  windowsDiscordSystem,
} from "./discordLifecycle.js";
import { MaintenanceController, readMaintenance } from "./maintenance.js";
import {
  RecoveryMonitor,
  reasonCode,
  type RecoveryTrigger,
} from "./recovery/monitor.js";
import { watchRoots, type WatchKind } from "./recovery/watch.js";
import type { DiscordChannel } from "../shared/channels.js";

const service = createInstallerService(createServiceContext());
const lifecycle = new DiscordLifecycle(service);
const maintenance = new MaintenanceController(service, {
  packaged: app.isPackaged,
  executable: process.execPath,
  localAppData: process.env["LOCALAPPDATA"] ?? app.getPath("userData"),
});
const background = process.argv.includes("--maintain");
if (background) {
  app.setName("Vestra Recovery");
  // Same id as the Setup Start Menu shortcut, so Windows shows our notifications.
  app.setAppUserModelId("dev.vestra.manager");
  app.setPath(
    "userData",
    path.join(service.context.homeDir, "recovery-session"),
  );
}
const primary = app.requestSingleInstanceLock();
if (background)
  console.log(
    "[Vestra recovery] startup",
    JSON.stringify({ primary, home: service.context.homeDir }),
  );
if (!primary) app.exit(0);
registerManagerIpc(service, lifecycle, maintenance);
const updates = new ManagerUpdates(service, maintenance);
updates.register();

const SWEEP_MS = 600_000;
const ASAR_DEBOUNCE_MS = 5_000;
const TRIGGER_RANK: Record<RecoveryTrigger, number> = {
  staged: 0,
  "asar-changed": 1,
  sweep: 2,
};

/** Recovery log lines carry a reason code and a message without paths or URLs. */
function logRecovery(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Another installation operation")) return;
  const clean = message
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/(?:[A-Za-z]:|\\\\)[\\/][^\s'"]*/g, "<path>")
    .slice(0, 300);
  const log = path.join(service.context.homeDir, "recovery.log");
  try {
    if (fs.existsSync(log) && fs.statSync(log).size > 65536)
      fs.writeFileSync(log, "");
    fs.appendFileSync(
      log,
      `${new Date().toISOString()} ${reasonCode(error)} ${clean}\n`,
    );
  } catch {
    /* logging must never stop recovery */
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but may not be signalled by us.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Repair without touching Discord's processes; in-use failures keep their code. */
async function patchWithoutRestart(channel: DiscordChannel): Promise<void> {
  const home = service.context.homeDir;
  await withInstallLock(home, async () => {
    const config = await readMaintenance(home);
    if (!config.enabled || !config.channels.includes(channel))
      throw Object.assign(new Error("Automatic recovery is turned off."), {
        code: "ECANCELED",
      });
    const result = await service.repair({ channels: [channel] });
    if (result.ok) return;
    const detail = result.results.find((item) => !item.ok)?.detail ?? "";
    const code = /being used by another process/i.test(detail)
      ? "EBUSY"
      : /\b(E[A-Z]{2,15}):/.exec(detail)?.[1];
    throw Object.assign(
      new Error(`Automatic repair failed (${code ?? toErrorCode(detail)}).`),
      code === undefined ? {} : { code },
    );
  });
}

async function runRecovery(): Promise<void> {
  const home = service.context.homeDir;
  // Held so click handlers survive garbage collection.
  const notices = new Map<string, Notification>();
  const monitor: RecoveryMonitor = new RecoveryMonitor(
    {
      service,
      processesFor: (target) => processesUnder(target),
      isAlive,
      patch: patchWithoutRestart,
      notify(channel, version) {
        if (!Notification.isSupported()) return;
        const key = `${channel}:${version}`;
        const notice = new Notification({
          title: "Discord updated",
          body: "Restart Discord to bring Vestra back.",
          actions: [{ type: "button", text: "Restart Discord" }],
        });
        let clicked = false;
        const restart = (): void => {
          notices.delete(key);
          if (clicked) return;
          clicked = true;
          void monitor.restartAndRepair(channel).catch(logRecovery);
        };
        notice.on("click", restart);
        notice.on("action", restart);
        notice.on("close", () => notices.delete(key));
        notices.set(key, notice);
        notice.show();
      },
      now: () => Date.now(),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onError: logRecovery,
    },
    lifecycle,
  );
  let stopWatching = (): void => {};
  let stopped = false;
  let busy = false;
  let queued: RecoveryTrigger | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const onEvent = (_root: string, kind: WatchKind): void => {
    // Discord's own completion signal: act at once (the monitor settles 1 s).
    if (kind === "staged") {
      void run("staged");
      return;
    }
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void run("asar-changed"), ASAR_DEBOUNCE_MS);
  };
  // One run at a time; a burst collapses into one queued run.
  const run = async (trigger: RecoveryTrigger): Promise<void> => {
    if (stopped) return;
    if (busy) {
      if (!queued || TRIGGER_RANK[trigger] > TRIGGER_RANK[queued])
        queued = trigger;
      return;
    }
    busy = true;
    try {
      const config = await readMaintenance(home);
      if (!config.enabled || config.channels.length === 0) {
        stop();
        app.quit();
        return;
      }
      if (
        config.runtime &&
        path.resolve(config.runtime) !== path.resolve(process.execPath)
      ) {
        stop();
        app.releaseSingleInstanceLock();
        await windowsDiscordSystem.launch(config.runtime, ["--maintain"]);
        app.quit();
        return;
      }
      try {
        await monitor.evaluate(config, trigger);
      } catch (error) {
        logRecovery(error);
      }
      // Version folders come and go; follow the current ones.
      if (trigger !== "asar-changed") {
        const roots = [
          ...new Set(
            (await monitor.targets(config)).map((target) => target.rootDir),
          ),
        ];
        stopWatching();
        stopWatching = watchRoots(roots, onEvent);
      }
    } catch (error) {
      logRecovery(error);
    } finally {
      busy = false;
      const next = queued;
      queued = undefined;
      if (next) void run(next);
    }
  };
  const sweepTimer = setInterval(() => void run("sweep"), SWEEP_MS);
  const stop = (): void => {
    stopped = true;
    stopWatching();
    if (debounce) clearTimeout(debounce);
    clearInterval(sweepTimer);
  };
  await run("sweep");
}

async function boot(): Promise<void> {
  if (!primary) return;
  if (background) {
    await runRecovery();
    return;
  }
  if (process.argv.includes("--diagnose")) {
    const context = createServiceContext();
    const payloadPresent = Boolean(
      context.bundlePath && fs.existsSync(context.bundlePath),
    );
    const installations = await service.discover();
    const win = createManagerWindow(false);
    await new Promise<void>((resolve, reject) => {
      win.webContents.once("did-finish-load", () => resolve());
      win.webContents.once("did-fail-load", (_event, code, description) =>
        reject(new Error(`${code}: ${description}`)),
      );
    });
    const rendererChannels = (await win.webContents.executeJavaScript(
      "window.vestraManager.discover().then(installs => installs.map(i => i.channel))",
    )) as string[];
    console.log(
      JSON.stringify({
        packaged: app.isPackaged,
        payloadPresent,
        channels: installations.map((i) => i.channel),
        rendererChannels,
      }),
    );
    win.destroy();
    app.exit(payloadPresent ? 0 : 1);
    return;
  }
  createManagerWindow();
  await updates.finish();
  void updates.check();
  const updateTimer = setInterval(
    () => void updates.check(),
    6 * 60 * 60 * 1000,
  );
  updateTimer.unref();
}

void app
  .whenReady()
  .then(boot)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (background) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (background) return;
  if (BrowserWindow.getAllWindows().length === 0) createManagerWindow();
});

app.on("second-instance", () => {
  if (background) return;
  const window = BrowserWindow.getAllWindows()[0];
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
