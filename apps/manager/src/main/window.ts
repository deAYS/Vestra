import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { MANAGER_IPC, type ManagerWindowState } from "../shared/channels.js";
import { isManagerSender } from "./sender.js";

declare const __VESTRA_MANAGER_DEV__: boolean;

const HERE = path.dirname(fileURLToPath(import.meta.url));

function isDevBuild(): boolean {
  return (
    typeof __VESTRA_MANAGER_DEV__ !== "undefined" && __VESTRA_MANAGER_DEV__
  );
}

export function createManagerWindow(show = true): BrowserWindow {
  const preloadPath = path.join(HERE, "..", "preload", "index.cjs");
  const rendererPath = path.join(HERE, "..", "renderer", "index.html");
  const rendererUrl = pathToFileURL(rendererPath).href;
  if (isDevBuild()) {
    console.log(`[Vestra Manager] preload path: ${preloadPath}`);
    console.log(
      `[Vestra Manager] preload exists: ${fs.existsSync(preloadPath)}`,
    );
  }
  const win = new BrowserWindow({
    show,
    width: 960,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    resizable: true,
    frame: false,
    backgroundColor: "#100e14",
    title: "Vestra",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  // This window only displays bundled Manager files.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  const publishState = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send(MANAGER_IPC.windowState, {
        maximized: win.isMaximized(),
      } satisfies ManagerWindowState);
  };
  const windowAction = (event: IpcMainEvent, action: unknown): void => {
    if (
      event.sender !== win.webContents ||
      !isManagerSender(event, rendererUrl)
    )
      return;
    switch (action) {
      case "sync":
        publishState();
        break;
      case "minimize":
        win.minimize();
        break;
      case "toggle-maximize":
        win.isMaximized() ? win.unmaximize() : win.maximize();
        break;
      case "close":
        win.close();
        break;
    }
  };
  ipcMain.on(MANAGER_IPC.windowAction, windowAction);
  win.on("maximize", publishState);
  win.on("unmaximize", publishState);
  win.once("closed", () => {
    ipcMain.removeListener(MANAGER_IPC.windowAction, windowAction);
  });
  if (isDevBuild()) {
    win.webContents.on("console-message", (_event, _level, message) => {
      if (message.startsWith("[Vestra Manager]")) {
        console.log(`[Renderer] ${message}`);
      }
    });
  }
  void win.loadFile(rendererPath);
  return win;
}
