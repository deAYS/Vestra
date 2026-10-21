import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { MANAGER_IPC, type ManagerWindowMaterial } from "../shared/channels.js";
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
  const materialsSupported =
    process.platform === "win32" && Number(os.release().split(".")[2]) >= 22621;
  const appearanceFile = path.join(
    app.getPath("userData"),
    "window-appearance.json",
  );
  let material: ManagerWindowMaterial = materialsSupported ? "mica" : "solid";
  let appearanceError = "";
  try {
    const saved = JSON.parse(fs.readFileSync(appearanceFile, "utf8")) as {
      material?: unknown;
    };
    if (
      saved.material === "solid" ||
      (materialsSupported &&
        (saved.material === "mica" || saved.material === "acrylic"))
    )
      material = saved.material;
  } catch {
    /* A missing preference uses the platform default. */
  }
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
  const applyMaterial = (): void => {
    try {
      if (materialsSupported)
        win.setBackgroundMaterial(material === "solid" ? "none" : material);
      win.setBackgroundColor(material === "solid" ? "#100e14" : "#00000000");
    } catch {
      material = "solid";
      appearanceError = "Windows could not apply that finish. Solid is active.";
      win.setBackgroundColor("#100e14");
    }
  };
  applyMaterial();
  const publishState = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send(MANAGER_IPC.windowState, {
        maximized: win.isMaximized(),
        material,
        materialsSupported,
        appearanceError,
      });
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
  const setMaterial = (event: IpcMainEvent, value: unknown): void => {
    if (
      event.sender !== win.webContents ||
      !isManagerSender(event, rendererUrl)
    )
      return;
    if (value !== "solid" && value !== "mica" && value !== "acrylic") return;
    appearanceError = "";
    material = materialsSupported ? value : "solid";
    applyMaterial();
    try {
      fs.mkdirSync(path.dirname(appearanceFile), { recursive: true });
      fs.writeFileSync(appearanceFile + ".tmp", JSON.stringify({ material }));
      fs.renameSync(appearanceFile + ".tmp", appearanceFile);
    } catch {
      appearanceError =
        "This finish is active but could not be saved. Try again.";
    }
    publishState();
  };
  ipcMain.on(MANAGER_IPC.windowAction, windowAction);
  ipcMain.on(MANAGER_IPC.windowMaterial, setMaterial);
  win.on("maximize", publishState);
  win.on("unmaximize", publishState);
  win.once("closed", () => {
    ipcMain.removeListener(MANAGER_IPC.windowAction, windowAction);
    ipcMain.removeListener(MANAGER_IPC.windowMaterial, setMaterial);
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
