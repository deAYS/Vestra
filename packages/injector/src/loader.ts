export interface LoaderOptions {
  bundleFile?: string;
  timeoutMs?: number;
  scriptId?: string;
}

/** Bundle is supplied by the preload; no file:// or inline DOM script fallback. */
export function buildLoaderSource(options?: LoaderOptions): string {
  if (options?.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new TypeError("Invalid timeout.");
  if (options?.bundleFile !== undefined && !/^[A-Za-z0-9_-]+\.js$/.test(options.bundleFile)) throw new TypeError("Unsafe bundleFile.");
  if (options?.scriptId !== undefined && !/^[A-Za-z0-9_-]+$/.test(options.scriptId)) throw new TypeError("Unsafe scriptId.");
  return `(function () {
  if (window.__VESTRA_BOOT_PROMISE__) return window.__VESTRA_BOOT_PROMISE__;
  window.__VESTRA_BOOT_PROMISE__ = (async function () {
    const module = window.Vestra;
    const runtime = module && (module.Vestra || module.default || module);
    const splash = window.__VESTRA_SPLASH__;
    try {
      if (!runtime || typeof runtime.start !== "function") throw new Error("Runtime missing from bundle");
      window.Vestra = runtime;
      const native = window.VestraNative;
      if (native && typeof native.invoke === "function") {
        runtime.Native.connect({ capabilities: native.capabilities.slice(), invoke: (channel, args) => native.invoke(channel, args) });
      }
      if (splash) splash.set(68, "Restoring your workspace…");
      await runtime.start();
      if (splash) splash.set(100, "Ready. Your Discord. Your rules.");
      console.log("[Vestra] runtime ready");
    } catch (err) {
      delete window.__VESTRA_BOOT_PROMISE__;
      console.error("[Vestra] start failed:", err);
      throw err;
    } finally {
      if (splash) splash.done();
    }
  })();
  return window.__VESTRA_BOOT_PROMISE__;
})();
`;
}
