import {
  isDiscordRendererUrl,
  startStatusFilename,
  VESTRA_IPC_PREFIX,
  VESTRA_NATIVE_CHANNELS,
  VESTRA_VERSION,
} from "@vestra/shared";
import { buildAddonsSource } from "./addonsSource.js";
import { senderRejection } from "./senderCheck.js";
import { buildSettingsSource } from "./settingsSource.js";
import { buildUpdatesSource } from "./updatesSource.js";

export interface MainHookOptions {
  /**
   * Preload location at Discord runtime: an absolute path, or
   * `"<hookdir>/<file>"` for a file next to the hook itself inside app.asar
   * (robust across Discord updates — preferred for installs).
   */
  preloadPath: string;
  /** Channels to serve. Defaults to the full allowlist. */
  capabilities?: readonly string[];
  /** Must match the preload builder. */
  ipcPrefix?: string;
  /** Settings filename under the userData dir. */
  settingsFile?: string;
}

/** Prefix marking a hookdir-relative preload path. */
export const HOOKDIR_PREFIX = "<hookdir>/";

/** Process-global sentinel so the fast check runs once even if the CJS is re-evaluated. */
export const FAST_HEALTH_SENTINEL_KEY = "__vestra.healthScheduled";

export type FastHealthReason =
  | "healthy"
  | "no-receipt"
  | "bad-receipt"
  | "no-backup"
  | "version-drift"
  | "no-preload"
  | "check-failed";

export interface FastHealthResult {
  healthy: boolean;
  reason: FastHealthReason;
  detail?: string | undefined;
}

/**
 * True when `p` is an existing absolute local path inside `home` after
 * resolving links. Embedded in the hook via toString(): must stay
 * self-contained plain ES2020 (fs and path are passed in).
 */
export function insideVestraHome(
  fs: { realpathSync(p: string): string },
  path: {
    isAbsolute(p: string): boolean;
    relative(from: string, to: string): string;
  },
  home: string,
  p: unknown,
): boolean {
  try {
    if (typeof p !== "string" || p === "" || p.indexOf("\0") !== -1) return false;
    if (/^[\\/]{2}/.test(p)) return false;
    if (!path.isAbsolute(p)) return false;
    const rel = path.relative(fs.realpathSync(home), fs.realpathSync(p));
    return !/^\.\.(?:[\\/]|$)/.test(rel) && !path.isAbsolute(rel);
  } catch (_) {
    return false;
  }
}

const APP_PATH_ALLOWLIST = [
  "userData",
  "home",
  "temp",
  "desktop",
  "documents",
  "downloads",
  "exe",
];

/**
 * Start-status writer embedded in the hook. File names and the reason cap are
 * baked from @vestra/shared (the hook cannot import); record field names are
 * literals, kept honest by a test that parses the output with parseStartStatus.
 * Every failure is swallowed: status files must never disturb Discord.
 */
function statusSource(): string {
  const files = {
    stable: startStatusFilename("stable"),
    ptb: startStatusFilename("ptb"),
    canary: startStatusFilename("canary"),
  };
  return `
  const STATUS_FILES = ${JSON.stringify(files)};
  const VESTRA_VERSION_LITERAL = ${JSON.stringify(VESTRA_VERSION)};
  let statusChannel;
  function resolveStatusChannel() {
    if (statusChannel) return statusChannel;
    try {
      const resources = path.dirname(app.getAppPath());
      const receipt = JSON.parse(fs.readFileSync(path.join(resources, "vestra-receipt.json"), "utf8"));
      if (receipt && (receipt.channel === "stable" || receipt.channel === "ptb" || receipt.channel === "canary")) statusChannel = receipt.channel;
    } catch (_) {}
    if (!statusChannel) {
      const exe = path.basename(process.execPath).toLowerCase();
      statusChannel = exe.indexOf("discordcanary") === 0 ? "canary" : exe.indexOf("discordptb") === 0 ? "ptb" : "stable";
    }
    return statusChannel;
  }
  // kind: "launch" | "start". Keeps the other record; atomic via tmp + rename.
  function writeStatus(kind, extra) {
    try {
      const file = path.join(app.getPath("appData"), "Vestra", ...STATUS_FILES[resolveStatusChannel()].split("/"));
      let current = {};
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
      } catch (_) {}
      let discordVersion = "";
      try { discordVersion = String(app.getVersion()); } catch (_) {}
      const record = Object.assign({ at: Date.now(), discordVersion: discordVersion, vestraVersion: VESTRA_VERSION_LITERAL }, extra);
      const next = {};
      if (current.launch) next.launch = current.launch;
      if (current.start) next.start = current.start;
      next[kind] = record;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + "." + process.pid + ".tmp";
      try {
        fs.writeFileSync(tmp, JSON.stringify(next));
        fs.renameSync(tmp, file);
      } catch (_) {
        try { fs.unlinkSync(tmp); } catch (_) {}
      }
    } catch (_) {}
  }`;
}

/** Build the main-hook CJS source. Throws (TypeError) on bad options. */
export function buildMainHookSource(options: MainHookOptions): string {
  if (typeof options?.preloadPath !== "string" || options.preloadPath === "") {
    throw new TypeError("buildMainHookSource() requires a preloadPath.");
  }
  const caps = options.capabilities ?? [...VESTRA_NATIVE_CHANNELS];
  if (caps.length === 0)
    throw new TypeError(
      "buildMainHookSource() requires at least one capability.",
    );
  for (const cap of caps) {
    if (!(VESTRA_NATIVE_CHANNELS as readonly string[]).includes(cap)) {
      throw new TypeError(
        `buildMainHookSource() unknown capability: "${cap}".`,
      );
    }
  }
  const prefix = options.ipcPrefix ?? VESTRA_IPC_PREFIX;
  if (prefix === "" || prefix.includes('"')) {
    throw new TypeError("buildMainHookSource() requires a safe ipcPrefix.");
  }
  const settingsFile = options.settingsFile ?? "vestra-settings.json";
  if (
    settingsFile === "" ||
    settingsFile.includes('"') ||
    settingsFile.includes("..")
  ) {
    throw new TypeError("buildMainHookSource() requires a safe settingsFile.");
  }
  const preloadPathExpr = options.preloadPath.startsWith(HOOKDIR_PREFIX)
    ? `path.join(__dirname, ${JSON.stringify(options.preloadPath.slice(HOOKDIR_PREFIX.length))})`
    : JSON.stringify(options.preloadPath);

  return `"use strict";
// Vestra main hook — generated by @vestra/injector. Runs in Discord's main
// process before its own bootstrap. Never throws outwards.
(function () { try {
  const path = require("path");
  const fs = require("fs");
  const { app, ipcMain, shell, BrowserWindow } = require("electron");

  // A copied hook in another Electron app must have no side effects.
  if (!/^discord(?:[ -]?(?:canary|ptb))?(?:\.exe)?$/i.test(path.basename(process.execPath))) return;
  const hookSentinel = Symbol.for("vestra.mainHook");
  if (globalThis[hookSentinel]) return;
  const trustedUrl = ${isDiscordRendererUrl.toString()};
  const senderRejection = ${senderRejection.toString()};
  function assertSender(event) {
    const reason = senderRejection(event, trustedUrl);
    if (reason !== null) throw new Error("[Vestra] untrusted IPC sender: " + reason);
  }

  const PREFIX = ${JSON.stringify(prefix)};
  ${statusSource()}
  const CAPABILITIES = ${JSON.stringify([...caps])};
  const PRELOAD_PATH = (${preloadPathExpr});
  const SETTINGS_FILE = ${JSON.stringify(settingsFile)};
  const APP_PATHS = ${JSON.stringify(APP_PATH_ALLOWLIST)};
  ${buildSettingsSource()}
  const insideVestraHome = ${insideVestraHome.toString()};
  // The resolved path, checked again: the shell never follows a link itself.
  function vestraPath(channel, p) {
    const home = path.join(app.getPath("appData"), "Vestra");
    const denied = channel + ": path outside Vestra folders";
    if (!insideVestraHome(fs, path, home, p)) throw new TypeError(denied);
    let real;
    try {
      real = fs.realpathSync(p);
    } catch (_) {
      throw new TypeError(denied);
    }
    if (!insideVestraHome(fs, path, home, real)) throw new TypeError(denied);
    return real;
  }

  // Fast health check: read-mostly, zero filesystem writes, never throws.
  // Returns a structured result for tests / future diagnostics. Healthy is
  // silent at the call site; unhealthy emits one console.warn with a stable
  // reason code. Must stay cheap (a few statSync + one small readFileSync).
  function vestraResourcesDir() {
    try {
      return path.dirname(app.getAppPath());
    } catch (_) {}
    try {
      return path.join(path.dirname(app.getPath("exe")), "resources");
    } catch (_) {}
    return "";
  }
  function fastHealthCheck() {
    try {
      const res = vestraResourcesDir();
      if (res === "") return { healthy: false, reason: "check-failed", detail: "resources dir unknown" };
      const receiptPath = path.join(res, "vestra-receipt.json");
      let raw;
      try {
        raw = fs.readFileSync(receiptPath, "utf8");
      } catch (_) {
        return { healthy: false, reason: "no-receipt", detail: "receipt missing" };
      }
      let receipt;
      try {
        receipt = JSON.parse(raw);
      } catch (_) {
        return { healthy: false, reason: "bad-receipt", detail: "receipt unparseable" };
      }
      if (!receipt || receipt.tool !== "vestra-injector" || receipt.version !== 1) {
        return { healthy: false, reason: "bad-receipt", detail: "receipt tool/version mismatch" };
      }
      let backupIsFile = false;
      try {
        backupIsFile = fs.statSync(path.join(res, "app.asar.vestra-backup")).isFile();
      } catch (_) {
        backupIsFile = false;
      }
      if (!backupIsFile) return { healthy: false, reason: "no-backup", detail: "backup missing" };
      try {
        const current = app.getVersion();
        if (typeof receipt.installVersion === "string" && receipt.installVersion !== "" && current !== receipt.installVersion) {
          return { healthy: false, reason: "version-drift", detail: "discord version changed" };
        }
      } catch (_) {}
      let preloadIsFile = false;
      try {
        preloadIsFile = fs.statSync(PRELOAD_PATH).isFile();
      } catch (_) {
        preloadIsFile = false;
      }
      if (!preloadIsFile) return { healthy: false, reason: "no-preload", detail: "preload missing" };
      return { healthy: true, reason: "healthy" };
    } catch (_) {
      return { healthy: false, reason: "check-failed", detail: "unexpected" };
    }
  }

  ${buildAddonsSource()}
  ${buildUpdatesSource()}
  const handlers = {
    "addons:openFolder": async (kind) => {
      const result = await shell.openPath(await addonFolder(kind));
      if (result) throw new Error(result);
      return true;
    },
    "addons:readThemes": async () => readAddonFiles("themes"),
    "addons:writeTheme": async (name, css) => writeThemeFile(name, css),
    "addons:removeTheme": async (name) => removeThemeFile(name),
    "settings:read": async () => {
      return readSettings();
    },
    "settings:write": async (text) => {
      if (typeof text !== "string") throw new TypeError("settings:write needs a string");
      return writeSettings(text);
    },
    "shell:openPath": async (p) => {
      const target = vestraPath("shell:openPath", p);
      // Folders only: opening a file could hand it to Windows Script Host.
      if (!fs.statSync(target).isDirectory()) throw new TypeError("shell:openPath: not a folder");
      const res = await shell.openPath(target);
      if (res !== "") throw new Error(res);
      return true;
    },
    "shell:showItemInFolder": async (p) => {
      shell.showItemInFolder(vestraPath("shell:showItemInFolder", p));
      return true;
    },
    "app:getVersion": async () => app.getVersion(),
    "app:getPath": async (name) => {
      if (typeof name !== "string" || APP_PATHS.indexOf(name) === -1) {
        throw new TypeError("app:getPath: denied name");
      }
      return app.getPath(name);
    },
    // Public release checks are cached; installation stays in Manager.
    "updater:check": async (force) => checkGithubUpdate(force === true),
    "updater:install": async () => openUpdateManager(),
  };

  for (const channel of CAPABILITIES) {
    const handler = handlers[channel];
    if (typeof handler !== "function") continue;
    ipcMain.handle(PREFIX + channel, async (event, args) => {
      assertSender(event);
      const list = Array.isArray(args) ? args : [];
      return handler(...list.slice(0, 4));
    });
  }

  // Sandboxed preloads cannot require fs/path. Send only fixed bootstrap files
  // from this installed payload, never a renderer-supplied filesystem path.
  ipcMain.handle(PREFIX + "bootstrap", async (event, options) => {
    const rejection = senderRejection(event, trustedUrl);
    if (rejection !== null) {
      writeStatus("start", { ok: false, reason: rejection });
      throw new Error("[Vestra] untrusted IPC sender: " + rejection);
    }
    const root = path.dirname(PRELOAD_PATH);
    const requested = options || {};
    function bootstrapFile(name, fallback) {
      const file = name === undefined ? fallback : name;
      if (typeof file !== "string" || !/^[A-Za-z0-9_-]+\\.(?:c?js)$/.test(file)) throw new Error("Unsafe bootstrap filename");
      return fs.promises.readFile(path.join(root, file), "utf8");
    }
    const bundle = await bootstrapFile(requested.bundleFile, "vestra.js");
    const loader = await bootstrapFile(requested.loaderFile, "vestra-loader.js");
    const plugins = [];
    if (requested.storePlugins !== false) {
      const pluginsRoot = path.join(app.getPath("appData"), "Vestra", "plugins");
      let registry;
      try { registry = JSON.parse(await fs.promises.readFile(path.join(pluginsRoot, "installed.json"), "utf8")); } catch (_) {}
      if (registry && typeof registry === "object" && !Array.isArray(registry)) {
        for (const [name, entry] of Object.entries(registry)) {
          try {
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || !entry || entry.enabled !== true || typeof entry.version !== "string" || !/^[0-9]+(?:\\.[0-9]+){1,3}(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?(?:\\+[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(entry.version) || entry.version.includes("..")) continue;
            plugins.push({ name, source: await fs.promises.readFile(path.join(pluginsRoot, name, entry.version, "index.js"), "utf8") });
          } catch (err) { console.warn("[Vestra] store plugin skipped:", name); }
        }
      }
    }
    try {
      for (const file of await readAddonFiles("plugins")) plugins.push({ name: file.filename.slice(0, -10), source: file.source });
      await addonFolder("themes");
    } catch (error) { console.warn("[Vestra] local addons unavailable:", error.message); }
    writeStatus("start", { ok: true });
    return { bundle, loader, plugins };
  });

  // Internal (not a native capability): the preload reports a failed start.
  ipcMain.handle(PREFIX + "report", async (event, args) => {
    assertSender(event);
    const raw = Array.isArray(args) ? args[0] : undefined;
    const reason = typeof raw === "string" && /^[a-z-]{1,64}$/.test(raw) ? raw : "bootstrap-error";
    writeStatus("start", { ok: false, reason });
  });

  // Internal: the preload reports a successful start that reused its cached
  // payload (no new bootstrap call), so the status reflects this session.
  ipcMain.handle(PREFIX + "started", async (event) => {
    assertSender(event);
    writeStatus("start", { ok: true });
  });

  // Preload chaining: Electron runs a single "preload" per window. When
  // Discord sets its own, keep it and register ours through the session API
  // (the supported chaining path on recent Electron); when unset, use ours
  // directly. This hook runs before Discord's bootstrap requires Electron,
  // so the patched export is what Discord destructures.
  function chainViaSession(session) {
    try {
      if (session && typeof session.registerPreloadScript === "function") {
        const scripts = session.getPreloadScripts();
        if (!scripts.some(s => s.filePath === PRELOAD_PATH)) session.registerPreloadScript({ type: "frame", id: "vestra-runtime", filePath: PRELOAD_PATH });
        return;
      }
      if (!session || typeof session.getPreloads !== "function") return;
      const cur = session.getPreloads() || [];
      if (cur.indexOf(PRELOAD_PATH) === -1 && typeof session.setPreloads === "function") {
        session.setPreloads([...cur, PRELOAD_PATH]);
      }
    } catch (_) {}
  }
  try {
    const electron = require("electron");
    const OriginalBW = electron.BrowserWindow || BrowserWindow;
    function VestraBW(options) {
      const opts = Object.assign({}, options && typeof options === "object" ? options : {});
      opts.webPreferences = Object.assign({}, opts.webPreferences);
      if (opts.webPreferences.preload) {
        try {
          const ses = electron.session;
          const s = opts.webPreferences.session || (ses && (opts.webPreferences.partition ? ses.fromPartition(opts.webPreferences.partition) : ses.defaultSession));
          chainViaSession(s);
        } catch (_) {}
      } else {
        opts.webPreferences.preload = PRELOAD_PATH;
      }
      return new OriginalBW(opts);
    }
    VestraBW.prototype = OriginalBW.prototype;
    Object.setPrototypeOf(VestraBW, OriginalBW);
    Object.defineProperty(electron, "BrowserWindow", { value: VestraBW, writable: true, configurable: true });
  } catch (_) {}
  try {
    app.on("browser-window-created", (_event, window) => {
      try {
        chainViaSession(window.webContents.session);
      } catch (_) {}

    });
  } catch (_) {}
  // Once-per-process fast check after app readiness. Not per-BrowserWindow.
  // Non-blocking (setImmediate), read-only on the healthy path (zero writes),
  // failure-isolated. Healthy is silent; unhealthy emits one console.warn.
  try {
    var __vestraGlobal = typeof globalThis !== "undefined" ? globalThis : global;
    var __vestraSentinel = Symbol.for("__vestra.healthScheduled");
    if (!__vestraGlobal[__vestraSentinel]) {
      __vestraGlobal[__vestraSentinel] = true;
      var __vestraScheduleHealth = function() {
        try {
          setImmediate(function() {
            try { writeStatus("launch", {}); } catch (_) {}
            try {
              var r = fastHealthCheck();
              if (!r || r.healthy !== true) {
                try {
                  var reason = (r && r.reason) || "check-failed";
                  var extra = (r && r.detail) ? ": " + r.detail : "";
                  console.warn("[Vestra] health drift (" + reason + ")" + extra);
                } catch (_) {}
              }
            } catch (_) {}
          });
        } catch (_) {}
      };
      try {
        if (app.isReady && app.isReady()) {
          __vestraScheduleHealth();
        } else if (app.whenReady) {
          app.whenReady().then(__vestraScheduleHealth, function() {});
        } else if (app.once) {
          app.once("ready", __vestraScheduleHealth);
        } else {
          __vestraScheduleHealth();
        }
      } catch (_) {}
    }
  } catch (_) {}
  globalThis[hookSentinel] = true;
} catch (err) {
  try {
    console.error("[Vestra] main hook failed:", err);
  } catch (_) {}
} })();
`;
}
