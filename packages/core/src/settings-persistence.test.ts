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
