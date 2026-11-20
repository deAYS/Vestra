import { test } from "node:test";
import assert from "node:assert/strict";
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
