import {
  isDiscordRendererUrl,
  VESTRA_IPC_PREFIX,
  VESTRA_NATIVE_CHANNELS,
  type VestraNativeChannel,
} from "@vestra/shared";
import { buildSplashSource } from "./splash.js";
import { observeDiscordSession } from "./sessionGate.js";

export interface PreloadOptions {
  capabilities?: readonly VestraNativeChannel[];
  ipcPrefix?: string;
  loaderFile?: string | undefined;
  bundleFile?: string | undefined;
  bundleInline?: boolean | undefined;
  storePlugins?: boolean | undefined;
  splash?: boolean | undefined;
}

/** Sandboxed preload: only Electron is required; all file reads stay in main. */
export function buildPreloadSource(options?: PreloadOptions): string {
  const caps = options?.capabilities ?? [...VESTRA_NATIVE_CHANNELS];
  if (
    !caps.length ||
    caps.some(
      (cap) => !(VESTRA_NATIVE_CHANNELS as readonly string[]).includes(cap),
    )
  ) {
    throw new TypeError("Unknown or empty preload capabilities.");
  }
  const prefix = options?.ipcPrefix ?? VESTRA_IPC_PREFIX;
  if (!prefix) throw new TypeError("Empty IPC prefix.");
  for (const file of [options?.bundleFile, options?.loaderFile]) {
    if (file !== undefined && !/^[A-Za-z0-9_-]+\.(?:c?js)$/.test(file))
      throw new TypeError("Unsafe bootstrap file.");
  }
  return `"use strict";
(function () {
  const trusted = ${isDiscordRendererUrl.toString()};
  // Session preloads also visit updater windows, popouts and embedded pages.
  if (process.isMainFrame === false || !trusted(location.href)) return;
  if (window.__VESTRA_PRELOAD_ACTIVE__) return;
  window.__VESTRA_PRELOAD_ACTIVE__ = true;
  const { contextBridge, ipcRenderer, webFrame } = require("electron");
  const capabilities = ${JSON.stringify([...caps])};
  const prefix = ${JSON.stringify(prefix)};
  function expose(name, value) {
    if (process.contextIsolated === false) window[name] = value;
    else contextBridge.exposeInMainWorld(name, value);
  }
  expose("VestraNative", {
    capabilities,
    invoke(channel, args) {
      if (!trusted(location.href) || capabilities.indexOf(channel) === -1) return Promise.reject(new Error("Native channel denied"));
      return ipcRenderer.invoke(prefix + channel, Array.isArray(args) ? args : []);
    }
  });
  let splash;
  let sessionReady = false;
  let generation = 0;
  let queue = Promise.resolve();
  let payloadCache;
  let initialized = false;
  const loadedPlugins = new Set();
  ${
    options?.splash === false
      ? ""
      : `
  function mountSplash() {
    if (splash || !document.documentElement) return;
    splash = ${buildSplashSource()};
    splash.set(5, "Connecting to Discord…");
  }
  `
  }
  expose("__VESTRA_SPLASH__", {
    set(pct, label) { if (splash) splash.set(pct, label); },
    done() { if (splash) splash.done(); }
  });
  async function boot(ticket) {
    try {
      ${options?.splash === false ? "" : "mountSplash();"}
      if (splash) splash.set(12, "Loading Vestra runtime…");
      const payload = payloadCache || await ipcRenderer.invoke(prefix + "bootstrap", {
        bundleFile: ${JSON.stringify(options?.bundleFile ?? "vestra.js")},
        loaderFile: ${JSON.stringify(options?.loaderFile ?? "vestra-loader.js")},
        storePlugins: ${options?.storePlugins !== false}
      });
      if (!payload || typeof payload.bundle !== "string" || typeof payload.loader !== "string") throw new Error("Invalid bootstrap response");
      payloadCache = payload;
      if (!sessionReady || generation !== ticket) return;
      await webFrame.executeJavaScript("if(window[Symbol.for('vestra.sessionRuntime')])window.Vestra=window[Symbol.for('vestra.sessionRuntime')];void 0;");
      // Execute explicitly in the page world. DOM script tags are blocked by CSP.
      if (!initialized) {
        await webFrame.executeJavaScript(payload.bundle + "\\n;window.Vestra = window.Vestra.Vestra || window.Vestra.default || window.Vestra; (async () => { await window.Vestra.Settings.connectStorage({readSettingsFile:()=>window.VestraNative.invoke('settings:read',[]).then(value=>value??undefined),writeSettingsFile:text=>window.VestraNative.invoke('settings:write',[text])}); window.Vestra.Settings.load(); })();\\n//# sourceURL=vestra.js");
        initialized = true;
      }
      for (const plugin of payload.plugins || []) {
        if (!sessionReady || generation !== ticket) return;
        if (loadedPlugins.has(plugin.name)) continue;
        try { await webFrame.executeJavaScript(plugin.source + "\\n//# sourceURL=vestra-plugin-" + encodeURIComponent(plugin.name) + ".js"); loadedPlugins.add(plugin.name); }
        catch (err) {
          console.error("[Vestra] plugin failed:", plugin.name, err);
          try { await webFrame.executeJavaScript("window.Vestra.Toasts.error('Plugin failed to load'," + JSON.stringify(plugin.name) + ")"); } catch (_) {}
        }
      }
      if (!sessionReady || generation !== ticket) return;
      if (splash) splash.set(55, "Starting plugins and themes…");
      await webFrame.executeJavaScript(payload.loader + "\\n//# sourceURL=vestra-loader.js");
    } catch (err) {
      console.error("[Vestra] bootstrap failed:", err);
    } finally {
      if (splash) { if (sessionReady && generation === ticket) splash.done(); else { splash.cancel(); splash = undefined; } }
    }
  }
  function watchSession() {
    const observeSession = ${observeDiscordSession.toString()};
    observeSession(ready => {
      sessionReady = ready;
      const ticket = ++generation;
      if (!ready && splash) { splash.cancel(); splash = undefined; }
      queue = queue.then(async () => {
        if (ready) { if (sessionReady && generation === ticket) await boot(ticket); }
        else {
          await webFrame.executeJavaScript("(async()=>{const v=window.Vestra;if(v&&typeof v.stop==='function'){window[Symbol.for('vestra.sessionRuntime')]=v;v.UI.closeSettings();v.Toasts.clear();await v.stop();}delete window.__VESTRA_BOOT_PROMISE__;})()");
        }
      }).catch(error => console.error("[Vestra] session lifecycle failed:",error));
    });
  }
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", watchSession, { once: true });
  else watchSession();
})();
`;
}
