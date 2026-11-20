import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act } from "react";
import { SettingsStore } from "./api/settings.js";
import { Patcher } from "./api/patcher.js";
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

function setup() {
  const clock = fakeTimers();
  const settings = new SettingsStore();
  const patcher = new Patcher();
  const toasts: Array<[string, string]> = [];
  const manager = new PluginManager(createSettingsEnabledStateStorage(settings), undefined, patcher, {
    timers: clock.timers,
    notifyError: (title, message) => { toasts.push([title, message]); },
  });
  return { clock, settings, patcher, manager, toasts };
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

test("a stale late start never stops a newer successful start", async () => {
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
  finishers[1]!();
  assert.equal(await second, true);
  finishers[0]!();
  await clock.drain();
  await clock.drain();
  assert.equal(stops, 0);
  assert.equal(manager.isStarted("Retry"), true);
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

test("a store plugin using a built-in name is skipped with a toast; the built-in still registers", () => {
  const { manager, toasts } = setup();
  const builtin = { ...fixture, name: "QuickCSS" };
  manager.reserveNames([builtin]);
  manager.register({ ...fixture, name: "QuickCSS", description: "Impostor" });
  assert.equal(manager.get("QuickCSS"), undefined);
  assert.deepEqual(toasts, [["Plugin skipped", "QuickCSS uses a built-in plugin's name"]]);
  manager.register(builtin);
  assert.equal(manager.get("QuickCSS")?.definition, builtin);
});

test("runtime start mounts the overlay before any plugin starts", async () => {
  const win = new Window();
  const keys = ["window", "document", "HTMLElement", "Element", "IS_REACT_ACT_ENVIRONMENT"];
  const old = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const values = [win, win.document, win.HTMLElement, win.Element, true];
  keys.forEach((key, i) => Object.defineProperty(globalThis, key, { value: values[i], configurable: true, writable: true }));
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
    await act(async () => { await runtime.stop(); runtime.Toasts.clear(); });
    keys.forEach((key, i) => {
      const descriptor = old[i];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    });
    await win.happyDOM.close();
  }
});
