import { test } from "node:test";
import assert from "node:assert/strict";
import * as vm from "node:vm";
import * as path from "node:path";
import { Window } from "happy-dom";
import { isDiscordRendererUrl } from "@vestra/shared";
import { buildMainHookSource } from "./mainHook.js";
import { buildPreloadSource } from "./preload.js";
import { buildLoaderSource } from "./loader.js";
import { buildSplashSource } from "./splash.js";

const goodUrl = "https://canary.discord.com/channels/@me";
const denied = [
  "https://discord.com.evil.test/channels/@me",
  "https://evil.test/channels/@me",
  "http://discord.com/channels/@me",
  "file:///C:/Discord/splash.html",
  "about:blank",
  "https://discord.com/oauth2/authorize",
  "https://discord.com/popout",
  "https://discord.com:8443/app",
  "https://discord.com/developers/applications",
];

test("only exact Discord client origins and app routes are accepted", () => {
  for (const url of denied) assert.equal(isDiscordRendererUrl(url), false, url);
  for (const url of [
    goodUrl,
    "https://discord.com/app",
    "https://ptb.discord.com/login",
    "https://discord.com/register",
  ])
    assert.equal(isDiscordRendererUrl(url), true, url);
});

test("preload skips updater/external pages and subframes before loading Electron", () => {
  for (const [href, isMainFrame] of [
    ...denied.map((url) => [url, true] as const),
    [goodUrl, false] as const,
  ]) {
    let required = false;
    vm.runInNewContext(buildPreloadSource(), {
      URL,
      location: { href },
      process: { isMainFrame },
      window: {},
      require() {
        required = true;
      },
    });
    assert.equal(required, false, href);
  }
});

test("sandboxed preload uses only Electron; bundle, plugin registration and runtime start are ordered", async () => {
  const order: string[] = [];
  const world: Record<string, unknown> = {};
  const page = vm.createContext({ window: world, order, console });
  const native = {
    contextBridge: {
      exposeInMainWorld(name: string, value: unknown) {
        world[name] = value;
      },
    },
    ipcRenderer: {
      async invoke(channel: string) {
        assert.equal(channel, "vestra:native:bootstrap");
        return {
          bundle: `window.Vestra = { Vestra: { Settings: { load() { order.push('settings'); } }, Native: { connect() { order.push('native'); } }, async start() { order.push('start'); } } };`,
          plugins: [
            {
              name: "Example",
              source:
                "order.push(window.Vestra.Settings ? 'plugin' : 'missing API')",
            },
          ],
          loader: buildLoaderSource(),
        };
      },
    },
    webFrame: {
      executeJavaScript(source: string) {
        return Promise.resolve(vm.runInContext(source, page));
      },
    },
  };
  const preloadWindow = { addEventListener() {} };
  const context = vm.createContext({
    URL,
    console,
    location: { href: goodUrl },
    process: { isMainFrame: true },
    window: preloadWindow,
    document: { readyState: "complete" },
    require(name: string) {
      assert.equal(name, "electron");
      return native;
    },
  });
  vm.runInContext(buildPreloadSource({ splash: false }), context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ["settings", "plugin", "native", "start"]);
  vm.runInContext(buildPreloadSource({ splash: false }), context);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(order.filter((s) => s === "start").length, 1);
});

function mainFixture(execPath = "C:/Discord/DiscordCanary.exe") {
  const handlers = new Map<
    string,
    (event: unknown, args: unknown) => Promise<unknown>
  >();
  const registered: unknown[] = [];
  const modernSession = {
    getPreloadScripts: () => registered,
    registerPreloadScript: (s: unknown) => {
      registered.push(s);
    },
  };
  const legacy: string[] = [];
  const legacySession = {
    getPreloads: () => legacy,
    setPreloads: (s: string[]) => {
      legacy.splice(0, legacy.length, ...s);
    },
  };
  const electron = {
    app: { getPath: () => "/fake", on() {}, isReady: () => true },
    ipcMain: {
      handle(
        name: string,
        handler: (e: unknown, a: unknown) => Promise<unknown>,
      ) {
        handlers.set(name, handler);
      },
    },
    shell: {
      async openPath() {
        return "";
      },
    },
    BrowserWindow: function (options: unknown) {
      return { options };
    },
    session: {
      defaultSession: modernSession,
      fromPartition: () => legacySession,
    },
  };
  const fs = {
    promises: {
      async mkdir() {},
      async lstat() {
        return { isDirectory: () => true, isSymbolicLink: () => false };
      },
      async readdir() {
        return [];
      },
      async readFile(filename: string) {
        if (filename.endsWith("installed.json"))
          return JSON.stringify({
            Good: { enabled: true, version: "1.0.0" },
            Bad: { enabled: true, version: "../../outside" },
          });
        return "/* test source */";
      },
    },
  };
  vm.runInNewContext(
    buildMainHookSource({ preloadPath: "/payload/vestra-preload.cjs" }),
    {
      URL,
      console,
      process: { execPath, env: {} },
      setImmediate() {},
      require(name: string) {
        if (name === "path") return path;
        if (name === "fs") return fs;
        if (name === "electron") return electron;
        throw new Error(name);
      },
    },
  );
  const frame = { url: goodUrl };
  return {
    handlers,
    electron,
    registered,
    legacy,
    sender: { senderFrame: frame, sender: { mainFrame: frame } },
  };
}

test("copied main hook has no effect in unrelated Electron applications", () => {
  assert.equal(mainFixture("C:/Wardogs/Wardogs.exe").handlers.size, 0);
});

test("every native IPC handler rejects external pages and subframes", async () => {
  const { handlers, sender } = mainFixture();
  assert.ok(handlers.size > 0);
  for (const handler of handlers.values()) {
    await assert.rejects(
      () =>
        handler(
          {
            senderFrame: { url: "https://evil.test/app" },
            sender: sender.sender,
          },
          [],
        ),
      /untrusted/,
    );
    await assert.rejects(
      () =>
        handler({ senderFrame: { url: goodUrl }, sender: sender.sender }, []),
      /untrusted/,
    );
  }
});

test("bootstrap filters unsafe plugin versions and filenames; unsupported update fails honestly", async () => {
  const { handlers, sender } = mainFixture();
  const payload = (await handlers.get("vestra:native:bootstrap")!(
    sender,
    {},
  )) as { plugins: Array<{ name: string }> };
  assert.deepEqual(
    Array.from(payload.plugins, (p) => p.name),
    ["Good"],
  );
  await assert.rejects(
    () =>
      handlers.get("vestra:native:bootstrap")!(sender, {
        bundleFile: "../secret.js",
      }),
    /Unsafe/,
  );
  await assert.rejects(
    () => handlers.get("vestra:native:updater:install")!(sender, []),
    /not implemented/,
  );
});

test("session registration supports modern and legacy Electron and preserves caller options", () => {
  const { electron, registered, legacy } = mainFixture();
  const options = { webPreferences: { preload: "/discord/preload.js" } };
  new (electron.BrowserWindow as unknown as new (o: unknown) => object)(
    options,
  );
  new (electron.BrowserWindow as unknown as new (o: unknown) => object)(
    options,
  );
  assert.equal(registered.length, 1);
  assert.deepEqual(options, {
    webPreferences: { preload: "/discord/preload.js" },
  });
  new (electron.BrowserWindow as unknown as new (o: unknown) => object)({
    webPreferences: { preload: "/discord.js", partition: "persist:discord" },
  });
  assert.deepEqual(legacy, ["/payload/vestra-preload.cjs"]);
});

test("splash progress never regresses and completion removes both DOM and CSS", () => {
  const window = new Window();
  const timers: Array<() => void> = [];
  const api = vm.runInNewContext(buildSplashSource(), {
    window,
    document: window.document,
    setTimeout(fn: () => void) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
  });
  api.set(68, "Runtime");
  api.set(20, "Late milestone");
  assert.equal(
    window.document.querySelector(".vs-boot-fill")?.getAttribute("style"),
    "width: 68%;",
  );
  api.done();
  assert.equal(
    window.document
      .getElementById("vestra-splash")
      ?.classList.contains("vs-done"),
    false,
    "fast bootstrap stays visible until its minimum duration",
  );
  timers[timers.length - 1]!();
  timers[timers.length - 1]!();
  assert.equal(window.document.getElementById("vestra-splash"), null);
  assert.equal(window.document.getElementById("vestra-splash-style"), null);
});

test("splash failsafe and Escape work even when runtime never starts", () => {
  for (const escape of [false, true]) {
    const window = new Window();
    const timers: Array<() => void> = [];
    vm.runInNewContext(buildSplashSource(), {
      window,
      document: window.document,
      setTimeout(fn: () => void) {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout() {},
    });
    if (escape)
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape" }),
      );
    else timers[0]!();
    timers[timers.length - 1]!();
    assert.equal(window.document.getElementById("vestra-splash"), null);
  }
});
