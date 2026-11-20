import { app, BrowserWindow, Notification } from "electron";
import * as fs from "node:fs";
import { createInstallerService, withInstallLock } from "@vestra/installer";
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
import { createRecoveryLoop } from "./recovery/loop.js";
import {
  RecoveryMonitor,
  reasonCode,
  repairFailure,
} from "./recovery/monitor.js";
import { RecoveryNotices } from "./recovery/notices.js";
import { watchRoots } from "./recovery/watch.js";
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

/** Recovery log lines carry only a reason code: messages can embed paths. */
function logRecovery(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Another installation operation")) return;
  const log = path.join(service.context.homeDir, "recovery.log");
  try {
    if (fs.existsSync(log) && fs.statSync(log).size > 65536)
      fs.writeFileSync(log, "");
    fs.appendFileSync(log, `${new Date().toISOString()} ${reasonCode(error)}\n`);
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
    if (!result.ok) throw repairFailure(result);
  });
}

async function runRecovery(): Promise<void> {
  const home = service.context.homeDir;
  const notices = new RecoveryNotices(
    (content) => {
      if (!Notification.isSupported()) return null;
      return new Notification(content);
    },
    (channel) => void monitor.restartAndRepair(channel).catch(logRecovery),
  );
  const monitor: RecoveryMonitor = new RecoveryMonitor(
    {
      service,
      processesFor: (target) => processesUnder(target),
      isAlive,
      patch: patchWithoutRestart,
      notify: (channel, version) =>
        notices.show(channel, "waiting-for-exit", version),
      notifyFailed: (channel, version) =>
        notices.show(channel, "failed", version),
      onPhase: (channel, phase, version) =>
        notices.phase(channel, phase, version),
      now: () => Date.now(),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onError: logRecovery,
    },
    lifecycle,
  );
  const loop = createRecoveryLoop({
    readConfig: () => readMaintenance(home),
    evaluate: (config, trigger) => monitor.evaluate(config, trigger),
    targets: (config) => monitor.targets(config),
    watch: watchRoots,
    isOtherRuntime: (runtime) =>
      path.resolve(runtime) !== path.resolve(process.execPath),
    async handoff(runtime) {
      app.releaseSingleInstanceLock();
      await windowsDiscordSystem.launch(runtime, ["--maintain"]);
    },
    reacquire: () => app.requestSingleInstanceLock(),
    quit: () => app.quit(),
    log: logRecovery,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
  });
  await loop.run("sweep");
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
