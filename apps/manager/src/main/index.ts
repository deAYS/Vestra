import { app, BrowserWindow } from "electron";
import * as fs from "node:fs";
import { createInstallerService } from "@vestra/installer";
import { registerManagerIpc } from "./installerBridge.js";
import { createServiceContext } from "./serviceContext.js";
import { createManagerWindow } from "./window.js";

const service = createInstallerService(createServiceContext());
registerManagerIpc(service);

async function boot(): Promise<void> {
  if (process.argv.includes("--diagnose")) {
    const context = createServiceContext();
    const payloadPresent = Boolean(context.bundlePath && fs.existsSync(context.bundlePath));
    const installations = await service.discover();
    const win = createManagerWindow(false);
    await new Promise<void>((resolve, reject) => {
      win.webContents.once("did-finish-load", () => resolve());
      win.webContents.once("did-fail-load", (_event, code, description) => reject(new Error(`${code}: ${description}`)));
    });
    const rendererChannels = await win.webContents.executeJavaScript("window.vestraManager.discover().then(installs => installs.map(i => i.channel))") as string[];
    console.log(JSON.stringify({ packaged: app.isPackaged, payloadPresent, channels: installations.map(i => i.channel), rendererChannels }));
    win.destroy();
    app.exit(payloadPresent ? 0 : 1);
    return;
  }
  createManagerWindow();
}

void app.whenReady().then(boot).catch(error => { console.error(error); app.exit(1); });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createManagerWindow();
});
