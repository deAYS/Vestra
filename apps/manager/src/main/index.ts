// Vestra Manager (main) — app entrypoint. Owns the InstallerService;
// registers the narrow IPC bridge; opens the manager window.

import { app, BrowserWindow } from "electron";
import { createInstallerService } from "@vestra/installer";
import { registerManagerIpc } from "./installerBridge.js";
import { createServiceContext } from "./serviceContext.js";
import { createManagerWindow } from "./window.js";

const service = createInstallerService(createServiceContext());
registerManagerIpc(service);

async function boot(): Promise<void> {
  createManagerWindow();
}

void app.whenReady().then(boot);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createManagerWindow();
});
