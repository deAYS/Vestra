import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act } from "react";
import { SettingsStore } from "./api/settings.js";
import { Patcher } from "./api/patcher.js";
import type { ScopedLogger } from "./api/logger.js";
import { Toasts } from "./api/toasts.js";
import { buildLoaderSource } from "../../injector/src/loader.js";
import {
  PluginManager,
  createSettingsEnabledStateStorage,
  PLUGIN_START_TIMEOUT_MS,
} from "./pluginManager.js";

/** Deterministic timers for the start timeout: no real waits. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    now: () => now,
    timers: {
      setTimeout(fn: () => void, ms: number): unknown {
        const id = ++seq;
        pending.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout(id: unknown): void {
        pending.delete(id as number);
      },
    },
    pendingCount: () => pending.size,
    drain,
    async advance(ms: number): Promise<void> {
      const end = now + ms;
      await drain();
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of pending)
          if (entry[1].at <= end && (!next || entry[1].at < next[1].at))
            next = entry;
        if (!next) break;
        pending.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await drain();
      }
      now = end;
      await drain();
    },
  };
}

function recordingLogger() {
  const warnings: string[] = [];
  const noop = (): void => {};
  const logger: ScopedLogger = {
    scope: "Test",
    debug: noop,
    log: noop,
    info: noop,
    warn: (...args) => { warnings.push(args.map(String).join(" ")); },
    error: noop,
    captureError: noop,
  };
  return { logger, warnings };
}

function setup() {
  const clock = fakeTimers();
  const settings = new SettingsStore();
  const patcher = new Patcher();
  const { logger, warnings } = recordingLogger();
  const manager = new PluginManager(createSettingsEnabledStateStorage(settings), logger, patcher, {
    timers: clock.timers,
  });
  return { clock, settings, patcher, manager, warnings };
}

const fixture = { description: "Fixture", authors: ["Test"] };

test("the start timeout is 15 seconds", () => {
  assert.equal(PLUGIN_START_TIMEOUT_MS, 15000);
});

test("a never-resolving start does not delay the next plugin beyond 15 s and stays enabled", async () => {
  const { clock, settings, manager } = setup();
  let nextStartedAt: number | undefined;
  manager.register({ ...fixture, name: "Hung", enabledByDefault: true, start: () => new Promise<void>(() => {}) });
  manager.register({ ...fixture, name: "Next", enabledByDefault: true, start() { nextStartedAt = clock.now(); } });
  const booting = manager.startEnabled();
  await clock.advance(PLUGIN_START_TIMEOUT_MS - 1);
  assert.equal(nextStartedAt, undefined);
  await clock.advance(1);
  await booting;
  assert.equal(nextStartedAt, PLUGIN_START_TIMEOUT_MS);
  assert.equal(manager.isStarted("Next"), true);
  assert.equal(manager.isStarted("Hung"), false);
  assert.equal(manager.isEnabled("Hung"), true, "a slow plugin retries next launch");
  assert.equal(settings.getEnabled("Hung"), true);
  const error = manager.getLastError("Hung");
  assert.ok(error instanceof Error);
  assert.equal(error.message, "Plugin took too long to start");
});

test("a start that finishes after the timeout is stopped and stays not started", async () => {
  const { clock, manager, patcher } = setup();
  const target = { value: () => 1 };
  let finish!: () => void;
  let stops = 0;
  manager.register({
    ...fixture,
    name: "Late",
    start() {
      return new Promise<void>((resolve) => { finish = () => { patcher.after("Late", target, "value", () => 2); resolve(); }; });
    },
    stop() { stops++; },
  });
  const enabling = manager.enable("Late");
  await clock.advance(PLUGIN_START_TIMEOUT_MS);
  assert.equal(await enabling, false);
  assert.equal(stops, 0);
  finish();
  await clock.drain();
  await clock.drain();
  assert.equal(stops, 1);
  assert.equal(manager.isStarted("Late"), false);
  assert.equal(manager.isEnabled("Late"), true);
  assert.equal(target.value(), 1, "patches from the late start are removed");
});

test("a late rejection after the timeout is cleaned up without an unhandled rejection", async () => {
  const { clock, manager } = setup();
  let fail!: (err: Error) => void;
  let stops = 0;
  manager.register({ ...fixture, name: "LateFail", start: () => new Promise<void>((_resolve, reject) => { fail = reject; }), stop() { stops++; } });
  const enabling = manager.enable("LateFail");
  await clock.advance(PLUGIN_START_TIMEOUT_MS);
  assert.equal(await enabling, false);
  fail(new Error("late failure"));
  await clock.drain();
  await clock.drain();
  assert.equal(stops, 1);
  assert.equal(manager.isStarted("LateFail"), false);
});

test("re-enabling while a timed-out start is pending reuses it instead of starting again", async () => {
  const { clock, manager } = setup();
  const finishers: Array<() => void> = [];
  let stops = 0;
  manager.register({ ...fixture, name: "Retry", start: () => new Promise<void>((resolve) => { finishers.push(resolve); }), stop() { stops++; } });
  const first = manager.enable("Retry");
  await clock.advance(PLUGIN_START_TIMEOUT_MS);
  assert.equal(await first, false);
  await manager.disable("Retry");
  const second = manager.enable("Retry");
  await clock.drain();
  assert.equal(finishers.length, 1, "no second start() while the first is pending");
  finishers[0]!();
  assert.equal(await second, true);
  await clock.drain();
  await clock.drain();
  assert.equal(stops, 0);
  assert.equal(manager.isStarted("Retry"), true);
  assert.equal(manager.getLastError("Retry"), undefined);
});

test("a pending start that resolves after a re-enable also timed out counts as started", async () => {
  const { clock, manager } = setup();
  const finishers: Array<() => void> = [];
  let stops = 0;
  manager.register({ ...fixture, name: "Adopted", start: () => new Promise<void>((resolve) => { finishers.push(resolve); }), stop() { stops++; } });
  const first = manager.enable("Adopted");
  await clock.advance(PLUGIN_START_TIMEOUT_MS);
  assert.equal(await first, false);
  await manager.disable("Adopted");
  const second = manager.enable("Adopted");
  await clock.advance(PLUGIN_START_TIMEOUT_MS);
  assert.equal(await second, false);
  finishers[0]!();
  await clock.drain();
  await clock.drain();
  assert.equal(finishers.length, 1, "no second start()");
  assert.equal(stops, 0);
  assert.equal(manager.isStarted("Adopted"), true);
  assert.equal(manager.getLastError("Adopted"), undefined);
});

test("a pending start that resolves after the plugin was disabled is stopped once", async () => {
  const { clock, manager } = setup();
  let finish!: () => void;
  let starts = 0;
  let stops = 0;
  manager.register({ ...fixture, name: "Gone", start: () => { starts++; return new Promise<void>((resolve) => { finish = resolve; }); }, stop() { stops++; } });
  const enabling = manager.enable("Gone");
  await clock.advance(PLUGIN_START_TIMEOUT_MS);
  assert.equal(await enabling, false);
  await manager.disable("Gone");
  finish();
  await clock.drain();
  await clock.drain();
  assert.equal(starts, 1);
  assert.equal(stops, 1);
  assert.equal(manager.isStarted("Gone"), false);
  assert.equal(manager.isEnabled("Gone"), false);
});

test("a start that resolves in time clears its timeout timer", async () => {
  const { clock, manager } = setup();
  manager.register({ ...fixture, name: "Quick", async start() {} });
  assert.equal(await manager.enable("Quick"), true);
  assert.equal(clock.pendingCount(), 0);
});

test("a synchronous start failure still disables the plugin", async () => {
  const { manager, settings } = setup();
  manager.register({ ...fixture, name: "SyncFail", start() { throw new Error("sync"); } });
  assert.equal(await manager.enable("SyncFail"), false);
  assert.equal(settings.getEnabled("SyncFail"), false);
});

test("a store plugin using a built-in name is skipped with a warning; the built-in still registers", () => {
  const { manager, warnings } = setup();
  const builtin = { ...fixture, name: "QuickCSS" };
  manager.reserveNames([builtin]);
  Toasts.clear();
  manager.register({ ...fixture, name: "QuickCSS", description: "Impostor" });
  assert.equal(manager.get("QuickCSS"), undefined);
  assert.equal(Toasts.list().length, 0, "console warning only, no toast");
  assert.equal(warnings.filter((line) => line.includes("QuickCSS") && /built-in/.test(line)).length, 1);
  manager.register(builtin);
  assert.equal(manager.get("QuickCSS")?.definition, builtin);
});

function installDom() {
  const win = new Window();
  const keys = ["window", "document", "HTMLElement", "Element", "IS_REACT_ACT_ENVIRONMENT"];
  const old = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const values = [win, win.document, win.HTMLElement, win.Element, true];
  keys.forEach((key, i) => Object.defineProperty(globalThis, key, { value: values[i], configurable: true, writable: true }));
  return {
    win,
    async restore(): Promise<void> {
      keys.forEach((key, i) => {
        const descriptor = old[i];
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      });
      await win.happyDOM.close();
    },
  };
}

/** Route the shared runtime's global timers through a fake clock for one test. */
function installFakeGlobalTimers() {
  const clock = fakeTimers();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  (globalThis as Record<string, unknown>)["setTimeout"] = clock.timers.setTimeout;
  (globalThis as Record<string, unknown>)["clearTimeout"] = clock.timers.clearTimeout;
  return {
    clock,
    restore(): void {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

async function settles(promise: Promise<unknown>, drain: () => Promise<void>, rounds = 20): Promise<boolean> {
  let done = false;
  void promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < rounds && !done; i++) await drain();
  return done;
}

test("runtime start resolves right after the UI mounts and the loader closes the splash while a plugin start hangs", async () => {
  const dom = installDom();
  const fake = installFakeGlobalTimers();
  const { runtime } = await import("./index.js");
  const { OVERLAY_ROOT_ID } = await import("./ui/Overlay.js");
  const win = dom.win as unknown as Record<string, unknown>;
  let splashDone = 0;
  let hungStarted = false;
  try {
    runtime.Plugins.register({
      ...fixture,
      name: "HungBootProbe",
      enabledByDefault: true,
      start() { hungStarted = true; return new Promise<void>(() => {}); },
    });
    await act(async () => {
      win["Vestra"] = runtime;
      win["__VESTRA_SPLASH__"] = { set: (): void => {}, done: (): void => { splashDone++; } };
      new Function(buildLoaderSource())();
      const booted = win["__VESTRA_BOOT_PROMISE__"] as Promise<void>;
      assert.equal(await settles(booted, fake.clock.drain), true, "start() must not wait for plugins");
      assert.equal(runtime.started, true);
      assert.equal(splashDone, 1);
      assert.notEqual(dom.win.document.getElementById(OVERLAY_ROOT_ID), null);
      for (let i = 0; i < 20 && !hungStarted; i++) await fake.clock.drain();
      assert.equal(hungStarted, true, "plugins boot in the background");
    });
  } finally {
    await act(async () => {
      const stopping = runtime.stop();
      await fake.clock.advance(PLUGIN_START_TIMEOUT_MS);
      await stopping;
      await runtime.Plugins.disable("HungBootProbe");
      runtime.Toasts.clear();
    });
    delete win["__VESTRA_BOOT_PROMISE__"];
    fake.restore();
    await dom.restore();
  }
});

test("runtime stop during an in-flight plugin boot waits for it and leaves no plugin started", async () => {
  const dom = installDom();
  const fake = installFakeGlobalTimers();
  const { runtime } = await import("./index.js");
  let stops = 0;
  try {
    runtime.Plugins.register({
      ...fixture,
      name: "SlowBootProbe",
      enabledByDefault: true,
      start: () => new Promise<void>(() => {}),
      stop() { stops++; },
    });
    await act(async () => {
      const starting = runtime.start();
      assert.equal(await settles(starting, fake.clock.drain), true, "start() must not wait for plugins");
      const stopping = runtime.stop();
      assert.equal(await settles(stopping, fake.clock.drain), false, "stop() waits for the in-flight boot");
      await fake.clock.advance(PLUGIN_START_TIMEOUT_MS);
      assert.equal(await settles(stopping, fake.clock.drain), true);
      await stopping;
    });
    assert.equal(runtime.started, false);
    assert.deepEqual(runtime.Plugins.list().filter((p) => p.started).map((p) => p.definition.name), []);
    assert.equal(stops, 0, "a start that never finished is not stopped");
  } finally {
    await act(async () => {
      const stopping = runtime.stop();
      await fake.clock.advance(PLUGIN_START_TIMEOUT_MS);
      await stopping;
      await runtime.Plugins.disable("SlowBootProbe");
      runtime.Toasts.clear();
    });
    fake.restore();
    await dom.restore();
  }
});

test("runtime start mounts the overlay before any plugin starts", async () => {
  const dom = installDom();
  const win = dom.win;
  const { runtime } = await import("./index.js");
  const { OVERLAY_ROOT_ID } = await import("./ui/Overlay.js");
  let overlayAtStart: boolean | undefined;
  try {
    runtime.Plugins.register({
      ...fixture,
      name: "MountOrderProbe",
      enabledByDefault: true,
      start() { overlayAtStart = win.document.getElementById(OVERLAY_ROOT_ID) !== null; },
    });
    await act(async () => { await runtime.start(); });
    assert.equal(overlayAtStart, true);
  } finally {
    await act(async () => { await runtime.stop(); await runtime.Plugins.disable("MountOrderProbe"); runtime.Toasts.clear(); });
    await dom.restore();
  }
});
