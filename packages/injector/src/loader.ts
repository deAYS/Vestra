// @vestra/injector — renderer loader builder.
// Phase 10. Generates the renderer bootstrap injected into Discord's pages.
// It injects the Vestra bundle as a script tag, connects the preload's
// `window.VestraNative` to `Vestra.Native` explicitly (no ambient trust), and
// starts the runtime. Pure string building (tested); runs in Discord's
// renderer with no Node access.

export interface LoaderOptions {
  /** Bundle file name inside the payload dir (default `vestra.js`). */
  bundleFile?: string;
  /** Max ms to wait for the bundle script. Default 15_000. */
  timeoutMs?: number;
  /** Script tag id. Default `vestra-bundle`. */
  scriptId?: string;
}

/** Build the renderer loader source. Throws (TypeError) on bad options. */
export function buildLoaderSource(options?: LoaderOptions): string {
  const bundleFile = options?.bundleFile ?? "vestra.js";
  if (bundleFile === "" || bundleFile.includes('"') || bundleFile.includes("..")) {
    throw new TypeError("buildLoaderSource() requires a safe bundleFile.");
  }
  const timeoutMs = options?.timeoutMs ?? 15000;
  if (!(timeoutMs > 0)) throw new TypeError("buildLoaderSource() requires timeoutMs > 0.");
  const scriptId = options?.scriptId ?? "vestra-bundle";
  if (scriptId === "" || scriptId.includes('"')) {
    throw new TypeError("buildLoaderSource() requires a safe scriptId.");
  }

  return `(function () {
  "use strict";
  const TAG = "[Vestra]";
  function log(...args) {
    try { console.log(TAG, ...args); } catch (_) {}
  }
  function fail(...args) {
    try { console.error(TAG, ...args); } catch (_) {}
  }
  // The bundle global is the module namespace; the runtime singleton with
  // Logger/Plugins/Settings/Styles/UI/Webpack/Patcher/Discord/Native lives
  // at .Vestra (or .default). Normalize once so downstream code — and
  // DevTools users — always talk to the runtime. (After start(), the runtime
  // also replaces the global with itself via exposeGlobal.)
  function runtimeOf(global) {
    if (!global) return undefined;
    const candidate = global.Vestra || global.default || global;
    return candidate && typeof candidate.start === "function" ? candidate : undefined;
  }
  if (runtimeOf(window.Vestra) && runtimeOf(window.Vestra).started) {
    log("already running.");
    return;
  }
  // Bundle URL: prefer the bridged value (context isolation hides the
  // preload's own window globals from page scripts), then the legacy
  // global, then sibling resolution as a last resort.
  let bundleUrl = "";
  try {
    const api = window.VestraNative;
    bundleUrl = (api && api.bundleUrl) || window.__VESTRA_BUNDLE_URL__ || "";
  } catch (_) {}
  if (!bundleUrl) {
    let base = "";
    try {
      const scripts = document.getElementsByTagName("script");
      const self = scripts[scripts.length - 1];
      const src = (self && self.src) || "";
      base = src.slice(0, src.lastIndexOf("/") + 1);
    } catch (_) {}
    bundleUrl = base + ${JSON.stringify(bundleFile)};
  }
  const startedAt = Date.now();
  const timeout = ${JSON.stringify(timeoutMs)};

  function connectNative(Vestra) {
    try {
      const api = window.VestraNative;
      if (!api) {
        log("no window.VestraNative (preload bridge missing).");
        return false;
      }
      if (typeof api.invoke !== "function") {
        log("window.VestraNative.invoke is not a function.");
        return false;
      }
      if (!Vestra || !Vestra.Native) {
        log("Vestra.Native missing from bundle.");
        return false;
      }
      Vestra.Native.connect({
        capabilities: Array.isArray(api.capabilities) ? api.capabilities.slice() : [],
        invoke: (channel, args) => api.invoke(channel, args),
      });
      return true;
    } catch (err) {
      fail("native connect failed:", err);
      return false;
    }
  }

  let splashWarned = false;
  function splashApi() {
    try {
      const api = window.__VESTRA_SPLASH__;
      if (api && typeof api.set === "function" && typeof api.done === "function") return api;
    } catch (_) {}
    return undefined;
  }
  function splash(pct, label) {
    try {
      const api = splashApi();
      if (!api) {
        if (!splashWarned) {
          splashWarned = true;
          log("no splash bridge; progress unseen.");
        }
        return;
      }
      api.set(pct, label);
    } catch (_) {}
  }
  function splashDone() {
    try {
      const api = splashApi();
      if (api) api.done();
    } catch (_) {}
  }
  // Ease to 100 once the page itself finishes loading, whatever boot did.
  try {
    if (document.readyState === "complete") {
      setTimeout(splashDone, 600);
    } else {
      window.addEventListener("load", () => setTimeout(splashDone, 600));
      setTimeout(splashDone, 20000);
    }
  } catch (_) {}

  function boot() {
    const Vestra = runtimeOf(window.Vestra);
    if (!Vestra) {
      if (Date.now() - startedAt > timeout) {
        fail("bundle did not expose Vestra.start in time.");
        splashDone();
        return;
      }
      splash(18, "Loading Vestra…");
      setTimeout(boot, 50);
      return;
    }
    splash(38, "Bundle ready");
    const native = connectNative(Vestra);
    log(native ? "native bridge connected." : "running without native bridge.");
    splash(native ? 62 : 55, native ? "Native bridge connected" : "Starting runtime…");
    Promise.resolve()
      .then(() => Vestra.start())
      .then(() => {
        splash(86, "Runtime started");
        log("started.");
      })
      .catch((err) => {
        fail("start failed:", err);
        splashDone();
      });
  }

  try {
    if (document.getElementById(${JSON.stringify(scriptId)})) {
      boot();
      return;
    }
    const script = document.createElement("script");
    script.id = ${JSON.stringify(scriptId)};
    script.src = bundleUrl;
    script.onload = boot;
    script.onerror = (e) => fail("bundle load failed:", bundleUrl, e);
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    fail("loader failed:", err);
  }
})();
`;
}
