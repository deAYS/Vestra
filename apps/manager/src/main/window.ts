// Vestra Manager (main) — BrowserWindow factory.
// Native chrome kept (no frameless/custom titlebar this phase).
// Security: contextIsolation on, nodeIntegration off; renderer reaches
// Node only through the narrow preload bridge.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow } from "electron";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function createManagerWindow(): BrowserWindow {
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
      preload: path.join(HERE, "..", "preload", "index.cjs"),
    },
  });
  void win.loadFile(path.join(HERE, "..", "renderer", "index.html"));
  return win;
}
