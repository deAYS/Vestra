import { test } from "node:test";
import assert from "node:assert/strict";
import * as vm from "node:vm";
import * as path from "node:path";
import * as os from "node:os";
import * as realFs from "node:fs";
import { parseStartStatus, type StartStatusFile } from "@vestra/shared";
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
          bundle: `window.Vestra = { Vestra: { Settings: { async connectStorage() { order.push('file-settings'); }, load() { order.push('settings'); } }, Native: { connect() { order.push('native'); } }, async start() { order.push('start'); } } };`,
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
  const host = new Window({ url: goodUrl });
  host.document.body.innerHTML =
    '<main id="app-mount"><div class="sidebarList_fixture"></div></main>';
  const context = vm.createContext({
    URL,
    console,
    location: { href: goodUrl },
    process: { isMainFrame: true },
    window: preloadWindow,
    document: host.document,
    MutationObserver: host.MutationObserver,
    setTimeout,
    clearTimeout,
    require(name: string) {
      assert.equal(name, "electron");
      return native;
    },
  });
  vm.runInContext(buildPreloadSource({ splash: false }), context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, [
    "file-settings",
    "settings",
    "plugin",
    "native",
    "start",
  ]);
  vm.runInContext(buildPreloadSource({ splash: false }), context);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(order.filter((s) => s === "start").length, 1);
  await host.happyDOM.close();
});

test("login is quiet; logout stops runtime and relogin starts it without duplicate plugins", async () => {
  const host = new Window({ url: "https://discord.com/login" });
  host.document.body.innerHTML =
    '<main id="app-mount"><div class="authBox_fixture"></div></main>';
  const order: string[] = [];
  const world: Record<string, unknown> = {};
  const page = vm.createContext({ window: world, order, console });
  let reads = 0;
  let notifyMutation = (): void => {};
  const native = {
    contextBridge: {
      exposeInMainWorld(name: string, value: unknown) {
        world[name] = value;
      },
    },
    ipcRenderer: {
      async invoke(channel: string) {
        if (channel.endsWith("bootstrap")) reads++;
        return {
          bundle: `window.Vestra={Vestra:{Settings:{async connectStorage(){},load(){}},Native:{connect(){}},UI:{closeSettings(){order.push('close')}},Toasts:{clear(){order.push('clear')}},async start(){order.push('start')},async stop(){order.push('stop');delete window.Vestra}}};`,
          plugins: [{ name: "Example", source: "order.push('plugin')" }],
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
  const context = vm.createContext({
    URL,
    console,
    location: host.location,
    process: { isMainFrame: true },
    window: host,
    document: host.document,
    MutationObserver: class {
      constructor(notify: () => void) {
        notifyMutation = notify;
      }
      observe(): void {}
      disconnect(): void {}
    },
    setTimeout,
    clearTimeout,
    require(name: string) {
      assert.equal(name, "electron");
      return native;
    },
  });
  try {
    vm.runInContext(buildPreloadSource({ splash: false }), context);
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(reads, 0);
    assert.equal(world["Vestra"], undefined);
    host.document.getElementById("app-mount")!.innerHTML =
      '<div class="guilds_fixture"></div>';
    notifyMutation();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(order, ["plugin", "start"]);
    host.document.getElementById("app-mount")!.innerHTML =
      '<div class="authBox_fixture"></div>';
    notifyMutation();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(order, ["plugin", "start", "close", "clear", "stop"]);
    assert.equal(world["Vestra"], undefined);
    host.document.getElementById("app-mount")!.innerHTML =
      '<div class="privateChannels_fixture"></div>';
    notifyMutation();
    for (let attempt = 0; attempt < 20 && order.length < 6; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(order, [
      "plugin",
      "start",
      "close",
      "clear",
      "stop",
      "start",
    ]);
    assert.equal(reads, 1);
  } finally {
    await host.happyDOM.close();
  }
});

interface FixtureOptions {
  /** Directory returned for app.getPath("appData"); status writes only happen when set. */
  appData?: string;
  receipt?: unknown;
  discordVersion?: string;
  failRename?: boolean;
}

function mainFixture(
  execPath = "C:/Discord/DiscordCanary.exe",
  opts: FixtureOptions = {},
) {
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
  const shellCalls: Array<[string, string]> = [];
  const electron = {
    app: {
      getPath: (name: string) =>
        name === "appData" && opts.appData !== undefined
          ? opts.appData
          : "/fake",
      getAppPath: () => "/res/app.asar",
      getVersion: () => opts.discordVersion ?? "1.0.9999",
      on() {},
      isReady: () => true,
    },
    ipcMain: {
      handle(
        name: string,
        handler: (e: unknown, a: unknown) => Promise<unknown>,
      ) {
        handlers.set(name, handler);
      },
    },
    shell: {
      async openPath(p: string) {
        shellCalls.push(["openPath", p]);
        return "";
      },
      showItemInFolder(p: string) {
        shellCalls.push(["showItemInFolder", p]);
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
  const guardedRead = (file: string): string => {
    if (opts.appData === undefined || !file.startsWith(opts.appData))
      throw new Error("ENOENT");
    return file;
  };
  const guarded =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      if (opts.appData === undefined) throw new Error("no appData in fixture");
      return fn(...a);
    };
  const fs = {
    readFileSync(file: string, enc: string) {
      if (file.endsWith("vestra-receipt.json") && opts.receipt !== undefined)
        return JSON.stringify(opts.receipt);
      return realFs.readFileSync(guardedRead(file), enc as "utf8");
    },
    statSync(file: string) {
      if (opts.appData !== undefined && file.startsWith(opts.appData)) return realFs.statSync(file);
      throw new Error("ENOENT");
    },
    mkdirSync: guarded(realFs.mkdirSync),
    writeFileSync: guarded(realFs.writeFileSync),
    renameSync: guarded((from: string, to: string) => {
      if (opts.failRename) throw new Error("EPERM");
      realFs.renameSync(from, to);
    }),
    unlinkSync: guarded(realFs.unlinkSync),
    realpathSync: (p: string) => realFs.realpathSync(p),
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
      console: { ...console, warn() {} },
      process: { execPath, env: {}, pid: 4242 },
      setImmediate(fn: () => void) {
        fn();
      },
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
    shellCalls,
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
        handler(
            { senderFrame: { url: goodUrl, parent: {} }, sender: sender.sender },
            [],
          ),
      /untrusted/,
    );
  }
});

test("bootstrap filters unsafe plugin versions and filenames", async () => {
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

test("bootstrap accepts a main frame whose object identity differs and rejects subframes", async () => {
  const { handlers, sender } = mainFixture();
  const bootstrap = handlers.get("vestra:native:bootstrap")!;
  const wrapper = {
    senderFrame: { url: goodUrl, parent: null },
    sender: { mainFrame: { url: goodUrl, parent: null } },
  };
  assert.ok(await bootstrap(wrapper, {}));
  await assert.rejects(
    () =>
      bootstrap(
        { senderFrame: { url: goodUrl, parent: {} }, sender: sender.sender },
        {},
      ),
    /untrusted IPC sender: subframe/,
  );
});

function tempAppData(): string {
  return realFs.mkdtempSync(path.join(os.tmpdir(), "vestra-status-"));
}

function readStatus(appData: string, channel: string): StartStatusFile {
  return parseStartStatus(
    realFs.readFileSync(
      path.join(appData, "Vestra", "status", `${channel}.json`),
      "utf8",
    ),
  );
}

test("hook writes a launch record on load, keyed by the receipt channel", () => {
  const appData = tempAppData();
  try {
    mainFixture("C:/Discord/Discord.exe", {
      appData,
      receipt: { channel: "canary" },
      discordVersion: "1.2.3",
    });
    const status = readStatus(appData, "canary");
    assert.equal(status.launch?.discordVersion, "1.2.3");
    assert.equal(typeof status.launch?.vestraVersion, "string");
    assert.ok(status.launch!.at > 0);
    assert.equal(status.start, undefined);
    assert.deepEqual(
      realFs.readdirSync(path.join(appData, "Vestra", "status")),
      ["canary.json"],
      "no temp file left behind",
    );
  } finally {
    realFs.rmSync(appData, { recursive: true, force: true });
  }
});

test("status channel falls back to the executable name without a receipt", () => {
  for (const [exe, channel] of [
    ["C:/Discord/DiscordCanary.exe", "canary"],
    ["C:/Discord/DiscordPTB.exe", "ptb"],
    ["C:/Discord/Discord.exe", "stable"],
  ] as const) {
    const appData = tempAppData();
    try {
      mainFixture(exe, { appData });
      assert.ok(readStatus(appData, channel).launch, exe);
    } finally {
      realFs.rmSync(appData, { recursive: true, force: true });
    }
  }
});

test("successful bootstrap records ok and keeps the launch record", async () => {
  const appData = tempAppData();
  try {
    const { handlers, sender } = mainFixture("C:/Discord/Discord.exe", {
      appData,
      receipt: { channel: "stable" },
      discordVersion: "9.9.9",
    });
    await handlers.get("vestra:native:bootstrap")!(sender, {});
    const status = readStatus(appData, "stable");
    assert.equal(status.start?.ok, true);
    assert.equal(status.start?.reason, undefined);
    assert.equal(status.start?.discordVersion, "9.9.9");
    assert.ok(status.launch);
  } finally {
    realFs.rmSync(appData, { recursive: true, force: true });
  }
});

test("rejected bootstrap records the rejection reason and still throws", async () => {
  const appData = tempAppData();
  try {
    const { handlers, sender } = mainFixture("C:/Discord/Discord.exe", {
      appData,
      receipt: { channel: "stable" },
    });
    await assert.rejects(
      () =>
        handlers.get("vestra:native:bootstrap")!(
          { senderFrame: { url: goodUrl, parent: {} }, sender: sender.sender },
          {},
        ),
      /untrusted IPC sender: subframe/,
    );
    const status = readStatus(appData, "stable");
    assert.equal(status.start?.ok, false);
    assert.equal(status.start?.reason, "subframe");
  } finally {
    realFs.rmSync(appData, { recursive: true, force: true });
  }
});

test("report channel is internal, sender-checked, capped and records a failed start", async () => {
  const appData = tempAppData();
  try {
    const { handlers, sender } = mainFixture("C:/Discord/Discord.exe", {
      appData,
      receipt: { channel: "ptb" },
    });
    const report = handlers.get("vestra:native:report")!;
    await assert.rejects(
      () =>
        report(
          {
            senderFrame: { url: "https://evil.test/app" },
            sender: sender.sender,
          },
          ["x"],
        ),
      /untrusted/,
    );
    assert.equal(readStatus(appData, "ptb").start, undefined);
    await report(sender, ["untrusted-url"]);
    assert.equal(readStatus(appData, "ptb").start?.reason, "untrusted-url");
    for (const bad of ["a".repeat(65), "Has Caps", "C:\\secret\\path", "", "x_y"]) {
      await report(sender, [bad]);
      assert.equal(readStatus(appData, "ptb").start?.reason, "bootstrap-error");
    }
    await report(sender, ["a".repeat(64)]);
    assert.equal(readStatus(appData, "ptb").start?.reason, "a".repeat(64));
    await report(sender, [42]);
    assert.equal(readStatus(appData, "ptb").start?.reason, "bootstrap-error");
    assert.equal(readStatus(appData, "ptb").start?.ok, false);
  } finally {
    realFs.rmSync(appData, { recursive: true, force: true });
  }
});

test("an unwritable status directory never breaks bootstrap", async () => {
  const dir = tempAppData();
  const blocker = path.join(dir, "blocker");
  realFs.writeFileSync(blocker, "not a directory");
  try {
    const { handlers, sender } = mainFixture("C:/Discord/Discord.exe", {
      appData: blocker,
      receipt: { channel: "stable" },
    });
    assert.ok(await handlers.get("vestra:native:bootstrap")!(sender, {}));
    assert.equal(realFs.readFileSync(blocker, "utf8"), "not a directory");
  } finally {
    realFs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed status rename removes its temp file", () => {
  const appData = tempAppData();
  try {
    mainFixture("C:/Discord/Discord.exe", {
      appData,
      receipt: { channel: "stable" },
      failRename: true,
    });
    const dir = path.join(appData, "Vestra", "status");
    assert.deepEqual(realFs.readdirSync(dir), []);
  } finally {
    realFs.rmSync(appData, { recursive: true, force: true });
  }
});

test("started channel is internal, sender-checked and records a successful start", async () => {
  const appData = tempAppData();
  try {
    const { handlers, sender } = mainFixture("C:/Discord/Discord.exe", {
      appData,
      receipt: { channel: "stable" },
    });
    const started = handlers.get("vestra:native:started")!;
    await assert.rejects(
      () =>
        started(
          { senderFrame: { url: "https://evil.test/app" }, sender: sender.sender },
          [],
        ),
      /untrusted/,
    );
    await handlers.get("vestra:native:report")!(sender, ["boom"]);
    assert.equal(readStatus(appData, "stable").start?.ok, false);
    await started(sender, []);
    const start = readStatus(appData, "stable").start;
    assert.equal(start?.ok, true);
    assert.equal(start?.reason, undefined);
  } finally {
    realFs.rmSync(appData, { recursive: true, force: true });
  }
});

function shellFixture() {
  // Resolved, so expectations compare with what realpath hands the shell.
  const appData = realFs.realpathSync(tempAppData());
  const home = path.join(appData, "Vestra");
  const inside = path.join(home, "plugins", "a.txt");
  realFs.mkdirSync(path.dirname(inside), { recursive: true });
  realFs.writeFileSync(inside, "x");
  const outsideDir = path.join(appData, "outside");
  realFs.mkdirSync(outsideDir);
  realFs.writeFileSync(path.join(outsideDir, "evil.exe"), "x");
  const junction = path.join(home, "link");
  realFs.symlinkSync(outsideDir, junction, "junction");
  // A link that stays inside the Vestra folder is allowed, resolved.
  const alias = path.join(home, "alias");
  realFs.symlinkSync(path.dirname(inside), alias, "junction");
  const fx = mainFixture("C:/Discord/Discord.exe", {
    appData,
    receipt: { channel: "stable" },
  });
  const bad = [
    "C:\\Windows\\notepad.exe",
    "\\\\host\\share\\x.exe",
    "//host/share/x.exe",
    "\\\\?\\C:\\Windows\\notepad.exe",
    "\\\\.\\C:\\Windows\\notepad.exe",
    home + String.raw`\..\outside\evil.exe`,
    path.join(junction, "evil.exe"),
    path.join(home, "missing.txt"),
    "plugins\\a.txt",
    path.join(outsideDir, "evil.exe"),
    inside + String.fromCharCode(0),
    42,
    "",
  ];
  return { appData, home, inside, alias, bad, ...fx };
}

test("shell channels open only existing paths inside the Vestra folder", async () => {
  const { appData, home, inside, bad, handlers, sender, shellCalls } =
    shellFixture();
  try {
    const showItem = handlers.get("vestra:native:shell:showItemInFolder")!;
    assert.equal(await showItem(sender, [inside]), true);
    assert.equal(await showItem(sender, [home]), true);
    assert.deepEqual(shellCalls, [["showItemInFolder", inside], ["showItemInFolder", home]]);
    shellCalls.length = 0;
    const open = handlers.get("vestra:native:shell:openPath")!;
    assert.equal(await open(sender, [home]), true);
    assert.equal(await open(sender, [path.dirname(inside)]), true);
    assert.deepEqual(shellCalls, [["openPath", home], ["openPath", path.dirname(inside)]]);
    shellCalls.length = 0;
    for (const handler of [showItem, open])
      for (const p of bad)
        await assert.rejects(() => handler(sender, [p]), /outside Vestra folders/, String(p));
    assert.deepEqual(shellCalls, []);
  } finally {
    realFs.rmSync(appData, { recursive: true, force: true });
  }
});

test("shell channels hand the shell the resolved path, not the link", async () => {
  const { appData, inside, alias, handlers, sender, shellCalls } = shellFixture();
  try {
    const showItem = handlers.get("vestra:native:shell:showItemInFolder")!;
    const open = handlers.get("vestra:native:shell:openPath")!;
    assert.equal(await showItem(sender, [path.join(alias, "a.txt")]), true);
    assert.equal(await open(sender, [alias]), true);
    assert.deepEqual(shellCalls, [
      ["showItemInFolder", inside],
      ["openPath", path.dirname(inside)],
    ]);
  } finally {
    realFs.rmSync(appData, { recursive: true, force: true });
  }
});

test("shell:openPath refuses files even inside the Vestra folder", async () => {
  const { appData, inside, handlers, sender, shellCalls } = shellFixture();
  try {
    const open = handlers.get("vestra:native:shell:openPath")!;
    await assert.rejects(() => open(sender, [inside]), /not a folder/);
    assert.deepEqual(shellCalls, []);
  } finally {
    realFs.rmSync(appData, { recursive: true, force: true });
  }
});

async function runPreloadWith(
  invoke: (channel: string, args: unknown) => Promise<unknown>,
  retryDelaysMs: number[] = [0, 0, 0],
) {
  const order: string[] = [];
  const world: Record<string, unknown> = {};
  const page = vm.createContext({ window: world, order, console });
  const native = {
    contextBridge: {
      exposeInMainWorld(name: string, value: unknown) {
        world[name] = value;
      },
    },
    ipcRenderer: { invoke },
    webFrame: {
      executeJavaScript(source: string) {
        return Promise.resolve(vm.runInContext(source, page));
      },
    },
  };
  const host = new Window({ url: goodUrl });
  host.document.body.innerHTML =
    '<main id="app-mount"><div class="sidebarList_fixture"></div></main>';
  const context = vm.createContext({
    URL,
    console: { ...console, error() {} },
    location: { href: goodUrl },
    process: { isMainFrame: true },
    window: { addEventListener() {} },
    document: host.document,
    MutationObserver: host.MutationObserver,
    setTimeout,
    clearTimeout,
    require: () => native,
  });
  vm.runInContext(
    buildPreloadSource({ splash: false, retryDelaysMs }),
    context,
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  await host.happyDOM.close();
  return order;
}

const goodPayload = {
  bundle: `window.Vestra = { Vestra: { Settings: { async connectStorage() {}, load() {} }, Native: { connect() {} }, async start() { order.push('start'); } } };`,
  plugins: [],
  loader: buildLoaderSource(),
};

test("preload retries a failing bootstrap and never reports when a retry succeeds", async () => {
  const calls: string[] = [];
  let failures = 2;
  const order = await runPreloadWith(async (channel) => {
    calls.push(channel);
    if (channel.endsWith("report")) return undefined;
    if (failures-- > 0) throw new Error("transient");
    return goodPayload;
  });
  assert.deepEqual(order, ["start"]);
  assert.equal(calls.filter((c) => c.endsWith("bootstrap")).length, 3);
  assert.equal(
    calls.some((c) => c.endsWith("report")),
    false,
  );
});

test("preload reports the short reason once after four failed bootstraps", async () => {
  const calls: Array<[string, unknown]> = [];
  const order = await runPreloadWith(async (channel, args) => {
    calls.push([channel, JSON.parse(JSON.stringify(args))]);
    if (channel.endsWith("report"))
      throw new Error("report failures are ignored");
    throw new Error(
      "Error invoking remote method 'vestra:native:bootstrap': Error: [Vestra] untrusted IPC sender: untrusted-url",
    );
  });
  assert.deepEqual(order, []);
  assert.equal(calls.filter(([c]) => c.endsWith("bootstrap")).length, 4);
  assert.deepEqual(
    calls.filter(([c]) => c.endsWith("report")),
    [["vestra:native:report", ["untrusted-url"]]],
  );
});

test("preload reports bootstrap-error for failures without a sender reason", async () => {
  const reports: unknown[] = [];
  await runPreloadWith(async (channel, args) => {
    if (channel.endsWith("report")) {
      reports.push(JSON.parse(JSON.stringify(args)));
      return undefined;
    }
    throw new Error("ENOENT: some private location");
  });
  assert.deepEqual(reports, [["bootstrap-error"]]);
});

test("relogin reusing the cached payload reports a fresh successful start", async () => {
  const host = new Window({ url: "https://discord.com/login" });
  host.document.body.innerHTML =
    '<main id="app-mount"><div class="authBox_fixture"></div></main>';
  const world: Record<string, unknown> = {};
  const page = vm.createContext({ window: world, console });
  const calls: string[] = [];
  let notifyMutation = (): void => {};
  const bundle = `if (!window.__tried) { window.__tried = true; throw new Error("renderer failure"); } window.Vestra={Vestra:{Settings:{async connectStorage(){},load(){}},Native:{connect(){}},UI:{closeSettings(){},},Toasts:{clear(){}},async start(){},async stop(){}}};`;
  const native = {
    contextBridge: {
      exposeInMainWorld(name: string, value: unknown) {
        world[name] = value;
      },
    },
    ipcRenderer: {
      async invoke(channel: string) {
        calls.push(channel.slice("vestra:native:".length));
        if (channel.endsWith("bootstrap"))
          return { bundle, plugins: [], loader: buildLoaderSource() };
        return undefined;
      },
    },
    webFrame: {
      executeJavaScript(source: string) {
        return Promise.resolve(vm.runInContext(source, page));
      },
    },
  };
  const context = vm.createContext({
    URL,
    console: { ...console, error() {} },
    location: host.location,
    process: { isMainFrame: true },
    window: host,
    document: host.document,
    MutationObserver: class {
      constructor(notify: () => void) {
        notifyMutation = notify;
      }
      observe(): void {}
      disconnect(): void {}
    },
    setTimeout,
    clearTimeout,
    require: () => native,
  });
  const settle = async (n: number): Promise<void> => {
    for (let i = 0; i < 40 && calls.length < n; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => setTimeout(resolve, 40));
  };
  const setApp = (html: string): void => {
    host.document.getElementById("app-mount")!.innerHTML = html;
    notifyMutation();
  };
  try {
    vm.runInContext(buildPreloadSource({ splash: false }), context);
    setApp('<div class="guilds_fixture"></div>');
    await settle(2);
    assert.deepEqual(calls, ["bootstrap", "report"]);
    setApp('<div class="authBox_fixture"></div>');
    await new Promise((resolve) => setTimeout(resolve, 80));
    setApp('<div class="guilds_fixture"></div>');
    await settle(3);
    assert.deepEqual(calls, ["bootstrap", "report", "started"]);
  } finally {
    await host.happyDOM.close();
  }
});

test("preload rejects invalid retry delays", () => {
  assert.throws(() => buildPreloadSource({ retryDelaysMs: [-1] }), TypeError);
});

test("splash fail shows the label for four seconds, then closes", () => {
  const window = new Window();
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const api = vm.runInNewContext(buildSplashSource(), {
    window,
    document: window.document,
    setTimeout(fn: () => void, ms: number) {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout() {},
  });
  api.fail("Vestra could not start");
  assert.equal(
    window.document.querySelector(".vs-boot-status span")?.textContent,
    "Vestra could not start",
  );
  const last = timers[timers.length - 1]!;
  assert.equal(last.ms, 4000);
  last.fn();
  timers[timers.length - 1]!.fn();
  assert.equal(window.document.getElementById("vestra-splash"), null);
});
