// Vestra Manager (main) — BrowserWindow factory.
// Native chrome kept (no frameless/custom titlebar this phase).
// Security: contextIsolation on, nodeIntegration off; renderer reaches
// Node only through the narrow preload bridge.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow } from "electron";

declare const __VESTRA_MANAGER_DEV__: boolean;

const HERE = path.dirname(fileURLToPath(import.meta.url));

function isDevBuild(): boolean {
  return typeof __VESTRA_MANAGER_DEV__ !== "undefined" && __VESTRA_MANAGER_DEV__;
}

export function createManagerWindow(): BrowserWindow {
  // TEMPORARY dev-only diagnostics (validation phase): verify the exact
  // preload path at runtime. Production remains quiet. Path unchanged.
  const preloadPath = path.join(HERE, "..", "preload", "index.cjs");
  if (isDevBuild()) {
    console.log(`[Vestra Manager] preload path: ${preloadPath}`);
    console.log(`[Vestra Manager] preload exists: ${fs.existsSync(preloadPath)}`);
  }
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 760,
    minHeight: 520,
    resizable: true,
    title: "Vestra",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  // TEMPORARY dev-only diagnostics: mirror preload/renderer "[Vestra Manager]"
  // messages to the main terminal. Prefix-filtered; DevTools output preserved.
  // Listener lives on win.webContents and dies with the window lifecycle.
  if (isDevBuild()) {
    win.webContents.on("console-message", (_event, _level, message) => {
      if (message.startsWith("[Vestra Manager]")) {
        console.log(`[Renderer] ${message}`);
      }
    });
  }
  void win.loadFile(path.join(HERE, "..", "renderer", "index.html"));
  return win;
}
