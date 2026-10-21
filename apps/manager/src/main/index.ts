import { app, BrowserWindow } from "electron";
import * as fs from "node:fs";
import { createInstallerService } from "@vestra/installer";
import { registerManagerIpc } from "./installerBridge.js";
import { createServiceContext } from "./serviceContext.js";
import { createManagerWindow } from "./window.js";
import { ManagerUpdates } from "./updates.js";
import * as path from "node:path";
import { DiscordLifecycle, windowsDiscordSystem } from "./discordLifecycle.js";
import {
  MaintenanceController,
  RecoveryMonitor,
  readMaintenance,
} from "./maintenance.js";

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
  app.setAppUserModelId("dev.vestra.recovery");
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

async function runRecovery(): Promise<void> {
  const monitor = new RecoveryMonitor(service, lifecycle);
  const log = path.join(service.context.homeDir, "recovery.log");
  const tick = async (): Promise<void> => {
    try {
      const config = await readMaintenance(service.context.homeDir);
      if (!config.enabled || config.channels.length === 0) {
        app.quit();
        return;
      }
      if (
        config.runtime &&
        path.resolve(config.runtime) !== path.resolve(process.execPath)
      ) {
        app.releaseSingleInstanceLock();
        await windowsDiscordSystem.launch(config.runtime, ["--maintain"]);
        app.quit();
        return;
      }
      await monitor.tick(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Another installation operation")) {
        if (fs.existsSync(log) && fs.statSync(log).size > 65536)
          fs.writeFileSync(log, "");
        fs.appendFileSync(log, `${new Date().toISOString()} ${message}\n`);
      }
    }
    setTimeout(() => void tick(), 15000);
  };
  await tick();
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
  if (updates.snapshot().phase !== "error") void updates.check();
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
