import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { SettingsStore } from "./api/settings.js";
import { applyThemePreset, THEME_LIBRARY, refreshLocalThemes } from "./themes.js";

test("local CSS survives a new desktop session and an unavailable folder without disappearing", async () => {
  let disk: string | undefined;
  const backend = { async readSettingsFile() { return disk; }, async writeSettingsFile(text: string) { disk = text; } };
  const first = new SettingsStore();
  await first.connectStorage(backend);
  const source = "/** @name Saved glass */\n:root{--text-link:#abc}";
  await refreshLocalThemes(first, { readThemeFiles: async () => [{ filename: "glass.css", source }] });
  first.activateTheme(first.getThemes()[0]!.id);
  await first.flush();
  const second = new SettingsStore();
  await second.connectStorage(backend);
  assert.equal(second.getThemes()[0]?.css, source);
  await refreshLocalThemes(second, { readThemeFiles: async () => [] });
  assert.equal(second.getThemes()[0]?.enabled, true);
  assert.equal(second.getThemes()[0]?.sourceMissing, true);
  assert.equal(second.getThemes()[0]?.css, source);
  await refreshLocalThemes(second, { readThemeFiles: async () => [{ filename: "glass.css", source }] });
  assert.equal(second.getThemes()[0]?.sourceMissing, false);
  await second.flush();
});

test("a fresh Discord runtime restores theme, shortcuts and plugin settings from its own file", async () => {
  let disk: string | undefined;
  const writes: string[] = [];
  const backend = {
    async readSettingsFile() {
      return disk;
    },
    async writeSettingsFile(text: string) {
      await new Promise((resolve) =>
        setTimeout(resolve, text.includes("Aurora") ? 2 : 5),
      );
      disk = text;
      writes.push(text);
    },
  };
  const first = new SettingsStore();
  assert.equal(await first.connectStorage(backend), true);
  applyThemePreset(first, THEME_LIBRARY[3]!);
  first.setPluginSetting("FocusMode", "shortcut", "Ctrl+Alt+G");
  first.setEnabled("FocusMode", true);
  await first.flush();
  const next = new SettingsStore();
  assert.equal(await next.connectStorage(backend), true);
  assert.equal(
    next.getThemes().filter((theme) => theme.enabled)[0]?.name,
    "Vestra Aurora",
  );
  assert.equal(next.getPluginSetting("FocusMode", "shortcut"), "Ctrl+Alt+G");
  assert.equal(next.getEnabled("FocusMode"), true);
  assert.equal(
    JSON.parse(writes.at(-1)!).plugins.FocusMode.enabled,
    true,
    "older async writes cannot overwrite the latest preference",
  );
  next.setEnabled("FocusMode", false);
  await next.flush();
  next.load();
  assert.equal(next.getEnabled("FocusMode"), false);
});

test("a failed settings read never replaces the saved desktop file with defaults", async () => {
  const settings = new SettingsStore();
  let writes = 0;
  const connected = await settings.connectStorage({
    async readSettingsFile() {
      throw new Error("fixture permission denied");
    },
    async writeSettingsFile() {
      writes++;
    },
  });
  assert.equal(connected, false);
  settings.setEnabled("FocusMode", true);
  await settings.flush();
  assert.equal(writes, 0);
  assert.match(settings.getPersistenceStatus().error!, /permission denied/);
});

test("disk write failures remain visible until a later write succeeds", async () => {
  const settings = new SettingsStore();
  let fail = false;
  await settings.connectStorage({
    async readSettingsFile() {
      return undefined;
    },
    async writeSettingsFile() {
      if (fail) throw new Error("fixture disk full");
    },
  });
  fail = true;
  settings.setEnabled("FocusMode", true);
  await assert.rejects(() => settings.flush(), /disk full/);
  assert.equal(settings.getPersistenceStatus().backend, "file");
  assert.match(settings.getPersistenceStatus().error!, /disk full/);
  fail = false;
  settings.setEnabled("FocusMode", false);
  await settings.flush();
  assert.equal(settings.getPersistenceStatus().error, undefined);
});

/** Deterministic timers for the write debounce: no real waits. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
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
    async advance(ms: number): Promise<void> {
      const end = now + ms;
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

function countingBackend() {
  const writes: string[] = [];
  const syncWrites: string[] = [];
  let fail: Error | undefined;
  return {
    writes,
    syncWrites,
    failWith(error: Error | undefined) {
      fail = error;
    },
    storage: {
      async readSettingsFile() {
        return writes.at(-1);
      },
      async writeSettingsFile(text: string) {
        if (fail) throw fail;
        writes.push(text);
      },
      writeSettingsFileSync(text: string) {
        syncWrites.push(text);
        return true;
      },
    },
  };
}

test("rapid changes are batched into a few debounced file writes that end with the last value", async () => {
  const clock = fakeTimers();
  const backend = countingBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  assert.equal(await settings.connectStorage(backend.storage), true);
  backend.writes.length = 0;

  settings.setPluginSetting("Fixture", "value", -1);
  await clock.advance(299);
  assert.equal(backend.writes.length, 0, "nothing is written before 300 ms of quiet");
  await clock.advance(1);
  assert.equal(backend.writes.length, 1, "the trailing write fires after 300 ms");
  backend.writes.length = 0;

  for (let i = 0; i < 50; i++) {
    settings.setPluginSetting("Fixture", "value", i);
    await clock.advance(60);
  }
  assert.ok(backend.writes.length >= 1, "continuous changes still write within the 2 s max wait");
  await clock.advance(2000);
  assert.ok(backend.writes.length <= 3, `expected at most 3 writes, saw ${backend.writes.length}`);
  assert.equal(JSON.parse(backend.writes.at(-1)!).plugins.Fixture.settings.value, 49);
  assert.equal(settings.getPluginSetting("Fixture", "value"), 49);
});

test("flush writes pending changes immediately once and is a no-op when clean", async () => {
  const clock = fakeTimers();
  const backend = countingBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage(backend.storage);
  backend.writes.length = 0;
  await settings.flush();
  assert.equal(backend.writes.length, 0, "a clean store does not write");
  settings.setEnabled("FocusMode", true);
  settings.setPluginSetting("FocusMode", "shortcut", "Ctrl+Alt+G");
  await settings.flush();
  assert.equal(backend.writes.length, 1);
  assert.equal(JSON.parse(backend.writes[0]!).plugins.FocusMode.settings.shortcut, "Ctrl+Alt+G");
  await settings.flush();
  await clock.advance(5000);
  assert.equal(backend.writes.length, 1, "the cancelled debounce does not write again");
});

test("flushSync hands the current snapshot to the synchronous writer when dirty", async () => {
  const clock = fakeTimers();
  const backend = countingBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage(backend.storage);
  backend.writes.length = 0;
  assert.equal(settings.flushSync(), true);
  assert.equal(backend.syncWrites.length, 0, "clean store: nothing to flush");
  settings.setEnabled("FocusMode", true);
  settings.setPluginSetting("FocusMode", "shortcut", "Ctrl+Alt+F");
  assert.equal(settings.flushSync(), true);
  assert.equal(backend.syncWrites.length, 1);
  assert.deepEqual(JSON.parse(backend.syncWrites[0]!), JSON.parse(JSON.stringify(settings.getSnapshot())));
  assert.equal(settings.flushSync(), true);
  await clock.advance(5000);
  assert.equal(backend.syncWrites.length, 1);
  assert.equal(backend.writes.length, 0, "the pending async write was superseded");
});

test("a failing synchronous flush is reported through the persistence banner state", async () => {
  const clock = fakeTimers();
  const backend = countingBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage({ ...backend.storage, writeSettingsFileSync: () => false });
  settings.setEnabled("FocusMode", true);
  assert.equal(settings.flushSync(), false);
  assert.ok(settings.getPersistenceStatus().error);
});

test("plugin settings reject values that are not JSON data and stay clean", async () => {
  const clock = fakeTimers();
  const backend = countingBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage(backend.storage);
  backend.writes.length = 0;
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic["self"] = cyclic;
  class Point {
    x = 1;
  }
  for (const bad of [10n, cyclic, () => 1, Symbol("x"), NaN, Infinity, new Point(), new Map(), { deep: [1, { big: 2n }] }]) {
    assert.throws(
      () => settings.setPluginSetting("Fixture", "bad", bad),
      (error: unknown) => error instanceof TypeError && error.message === "Setting values must be JSON data",
    );
    assert.throws(() => settings.setPluginSettings("Fixture", { bad }), TypeError);
  }
  assert.equal(settings.getPluginSetting("Fixture", "bad"), undefined);
  assert.equal(settings.flushSync(), true);
  assert.equal(backend.syncWrites.length, 0, "rejected values do not mark the store dirty");
  await settings.flush();
  assert.equal(backend.writes.length, 0);
  const shared = { x: 1 };
  for (const good of [null, undefined, "text", 0, false, [1, "two", null], new Date(0), Object.create(null), { a: shared, b: shared }])
    settings.setPluginSetting("Fixture", "good", good);
  await settings.flush();
  assert.equal(backend.writes.length, 1);
});

test("plugin settings accept plain objects, arrays and dates from another realm", async () => {
  const clock = fakeTimers();
  const backend = countingBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage(backend.storage);
  const foreign = runInNewContext("({ a: 1, list: [1, { b: 2 }], when: new Date(0), bare: Object.assign(Object.create(null), { c: 3 }) })") as Record<string, unknown>;
  assert.notEqual(Object.getPrototypeOf(foreign), Object.prototype, "the object really comes from another realm");
  assert.ok(!(foreign["when"] instanceof Date), "so does the date");
  settings.setPluginSetting("Fixture", "foreign", foreign);
  settings.setPluginSettings("Other", foreign);
  assert.deepEqual(JSON.parse(JSON.stringify(settings.getPluginSetting("Fixture", "foreign"))), {
    a: 1,
    list: [1, { b: 2 }],
    when: "1970-01-01T00:00:00.000Z",
    bare: { c: 3 },
  });
  for (const source of ["new Map()", "(class Point { x = 1 }, new (class Point { x = 1 })())", "({ fn() {} })", "({ big: 1n })", "Object.create({ constructor: Object, x: 1 })"])
    assert.throws(() => settings.setPluginSetting("Fixture", "bad", runInNewContext(source)), TypeError, source);
  class Object2 {}
  Object.defineProperty(Object2, "name", { value: "Object" });
  assert.throws(() => settings.setPluginSetting("Fixture", "bad", new Object2()), TypeError, "a class named Object is still a class instance");
});

test("debounced write and serialization failures set the banner state and notify listeners", async () => {
  const clock = fakeTimers();
  const backend = countingBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage(backend.storage);
  let notified = 0;
  settings.subscribe(() => notified++);
  backend.failWith(new Error("fixture disk full"));
  settings.setEnabled("FocusMode", true);
  notified = 0;
  await clock.advance(300);
  assert.match(settings.getPersistenceStatus().error!, /disk full/);
  assert.ok(notified > 0, "the banner re-renders");
  backend.failWith(undefined);
  settings.setEnabled("FocusMode", false);
  await clock.advance(300);
  assert.equal(settings.getPersistenceStatus().error, undefined);

  // A value accepted earlier and then mutated through the caller's reference.
  const nested: Record<string, unknown> = {};
  settings.setPluginSetting("Fixture", "nested", nested);
  nested["big"] = 1n;
  notified = 0;
  await clock.advance(300);
  assert.ok(settings.getPersistenceStatus().error, "serialization failure is visible");
  assert.ok(notified > 0);
});

test("reloading native settings with a pending write keeps the unsaved change", async () => {
  const clock = fakeTimers();
  const backend = countingBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage(backend.storage);
  settings.setPluginSetting("Fixture", "value", "unsaved");
  settings.load();
  assert.equal(settings.getPluginSetting("Fixture", "value"), "unsaved");
  await settings.flush();
  assert.equal(JSON.parse(backend.writes.at(-1)!).plugins.Fixture.settings.value, "unsaved");
});

/** Backend whose async writes can be held open and settled by the test. */
function heldBackend() {
  const writes: string[] = [];
  const syncWrites: string[] = [];
  const held: Array<{ text: string; resolve: () => void; reject: (e: Error) => void }> = [];
  let hold = false;
  let syncOk = true;
  return {
    writes,
    syncWrites,
    held,
    setHold(value: boolean) {
      hold = value;
    },
    setSyncOk(value: boolean) {
      syncOk = value;
    },
    storage: {
      async readSettingsFile() {
        return undefined;
      },
      writeSettingsFile(text: string) {
        if (!hold) {
          writes.push(text);
          return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
          held.push({
            text,
            resolve: () => {
              writes.push(text);
              resolve();
            },
            reject,
          });
        });
      },
      writeSettingsFileSync(text: string) {
        syncWrites.push(text);
        return syncOk;
      },
    },
  };
}

test("overlapping storage connections keep the blocking writer", async () => {
  const clock = fakeTimers();
  const syncWrites: string[] = [];
  let releaseRead: (value: string | undefined) => void = () => {};
  let nativeReads = 0;
  const preload = {
    readSettingsFile: () =>
      new Promise<string | undefined>((resolve) => {
        releaseRead = resolve;
      }),
    async writeSettingsFile() {},
    writeSettingsFileSync(text: string) {
      syncWrites.push(text);
      return true;
    },
  };
  const native = {
    async readSettingsFile() {
      nativeReads++;
      return undefined;
    },
    async writeSettingsFile() {},
  };
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  const first = settings.connectStorage(preload);
  const second = settings.connectStorage(native);
  await new Promise((resolve) => setImmediate(resolve));
  releaseRead(undefined);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(nativeReads, 0, "the second caller joins the first connection");
  settings.setEnabled("FocusMode", true);
  assert.equal(settings.flushSync(), true);
  assert.equal(syncWrites.length, 1);

  // A storage without a sync writer that connects first does not block a later one offering it.
  const later = new SettingsStore(undefined, { timers: clock.timers });
  await later.connectStorage(native);
  await later.connectStorage(preload);
  later.setEnabled("FocusMode", true);
  assert.equal(later.flushSync(), true);
  assert.equal(syncWrites.length, 2);
});

test("a failed blocking flush is not retried by the second close listener for the same state", async () => {
  const clock = fakeTimers();
  let calls = 0;
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage({
    async readSettingsFile() {
      return undefined;
    },
    async writeSettingsFile() {},
    writeSettingsFileSync() {
      calls++;
      return false;
    },
  });
  settings.setEnabled("FocusMode", true);
  assert.equal(settings.flushSync(), false, "beforeunload");
  assert.equal(settings.flushSync(), false, "pagehide");
  assert.equal(calls, 1, "the page is blocked at most once per state");
  settings.setEnabled("FocusMode", false);
  assert.equal(settings.flushSync(), false);
  assert.equal(calls, 2, "a new change is tried again");
  await settings.flush();
  assert.equal(settings.getPersistenceStatus().error, undefined, "the async path still saves it");
});

test("a write still in flight does not count as saved for the blocking flush", async () => {
  const clock = fakeTimers();
  const backend = heldBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage(backend.storage);
  backend.setHold(true);
  settings.setPluginSetting("Fixture", "value", "in flight");
  await clock.advance(300);
  assert.equal(backend.held.length, 1, "the debounced write is in flight");
  assert.equal(settings.flushSync(), true);
  assert.equal(backend.syncWrites.length, 1);
  assert.deepEqual(JSON.parse(backend.syncWrites[0]!), JSON.parse(JSON.stringify(settings.getSnapshot())));
  backend.held[0]!.resolve();
  await settings.flush();
  await clock.advance(5000);
  assert.equal(backend.held.length, 1, "no duplicate write after the sync flush");
});

test("late results of older writes never override the banner or a clean flush", async () => {
  const clock = fakeTimers();
  const backend = heldBackend();
  const settings = new SettingsStore(undefined, { timers: clock.timers });
  await settings.connectStorage(backend.storage);

  // An older async write fails after a newer blocking flush succeeded.
  backend.setHold(true);
  settings.setPluginSetting("Fixture", "value", 1);
  await clock.advance(300);
  settings.setPluginSetting("Fixture", "value", 2);
  assert.equal(settings.flushSync(), true);
  backend.held[0]!.reject(new Error("fixture stale failure"));
  await clock.advance(0);
  assert.equal(settings.getPersistenceStatus().error, undefined);
  await settings.flush();

  // An old failure does not make a later clean flush reject.
  settings.setPluginSetting("Fixture", "value", 3);
  await clock.advance(300);
  backend.held[1]!.reject(new Error("fixture disk full"));
  await clock.advance(0);
  assert.match(settings.getPersistenceStatus().error!, /disk full/);
  settings.setPluginSetting("Fixture", "value", 4);
  assert.equal(settings.flushSync(), true);
  assert.equal(settings.getPersistenceStatus().error, undefined);
  await settings.flush();
  await assert.doesNotReject(() => settings.flush());

  // A newer failure keeps the banner even when an older write then succeeds.
  backend.setHold(true);
  settings.setPluginSetting("Fixture", "value", 5);
  await clock.advance(300);
  const older = backend.held.at(-1)!;
  settings.setPluginSetting("Fixture", "value", 6);
  backend.setSyncOk(false);
  assert.equal(settings.flushSync(), false);
  older.resolve();
  await clock.advance(0);
  assert.ok(settings.getPersistenceStatus().error, "the newest result wins");
});

test("an out-of-range appearance value resets only that field and keeps the theme and its CSS", async () => {
  const css = "/** @name Saved */\n:root{--text-link:#abc}";
  const saved = {
    plugins: {},
    customCss: { enabled: false, css: "" },
    themes: [
      {
        id: "saved-theme",
        name: "Saved",
        author: "Fixture",
        css,
        enabled: true,
        customization: { opacity: 61, blur: 480, radius: "round", glowColor: "#aabbee", unknownField: 1 },
      },
      { id: "plain-theme", name: "Plain", author: "Fixture", css: "a{}", enabled: false, customization: "broken" },
      { id: "bad id!", name: "Dropped", css: "a{}", enabled: false },
    ],
  };
  let disk: string | undefined = JSON.stringify(saved);
  const warnings: unknown[][] = [];
  const logger = {
    scope: "Settings",
    debug() {},
    log() {},
    info() {},
    warn(...args: readonly unknown[]) {
      warnings.push([...args]);
    },
    error() {},
    captureError() {},
  };
  const settings = new SettingsStore(logger);
  await settings.connectStorage({
    async readSettingsFile() {
      return disk;
    },
    async writeSettingsFile(text: string) {
      disk = text;
    },
  });
  const themes = settings.getThemes();
  assert.deepEqual(themes.map((theme) => theme.id), ["saved-theme", "plain-theme"]);
  const repaired = themes[0]!;
  assert.equal(repaired.css, css);
  assert.equal(repaired.enabled, true);
  assert.equal(repaired.customization?.blur, 26, "blur falls back to its default");
  assert.equal(repaired.customization?.radius, 22, "radius falls back to its default");
  assert.equal(repaired.customization?.opacity, 61, "valid fields are kept");
  assert.equal(repaired.customization?.glowColor, "#aabbee");
  assert.equal(themes[1]?.customization, undefined, "an unreadable appearance is dropped");
  assert.equal(themes[1]?.css, "a{}");
  const themeWarnings = warnings.filter((args) => String(args[0]).includes("appearance"));
  assert.equal(themeWarnings.filter((args) => String(args[0]).includes("Saved")).length, 1, "one warning per theme");
  assert.match(String(themeWarnings[0]![0]), /blur/);
  assert.ok(!String(themeWarnings[0]![0]).includes("480"), "values are not logged");
  // The repair is saved, so the next launch loads cleanly without warnings.
  assert.equal(JSON.parse(disk!).themes[0].customization.blur, 26);
  warnings.length = 0;
  const next = new SettingsStore(logger);
  await next.connectStorage({ async readSettingsFile() { return disk; }, async writeSettingsFile(text: string) { disk = text; } });
  assert.equal(next.getThemes()[0]?.customization?.blur, 26);
  assert.equal(warnings.filter((args) => String(args[0]).includes("appearance")).length, 0);
});
