import { test } from "node:test";
import assert from "node:assert/strict";
import { SettingsStore } from "./api/settings.js";
import { StylesManager } from "./api/styles.js";
import { Patcher } from "./api/patcher.js";
import { PluginManager, createSettingsEnabledStateStorage } from "./pluginManager.js";
import { importTheme, startThemes, MIDNIGHT_THEME } from "./themes.js";
import { getWebpackRequire } from "./webpack/raw.js";

function setup() {
  const settings = new SettingsStore();
  const patcher = new Patcher();
  const manager = new PluginManager(createSettingsEnabledStateStorage(settings), undefined, patcher);
  return { settings, manager, patcher };
}

test("registration preserves persisted settings until the store loads", async () => {
  const { settings, manager } = setup();
  settings.setPluginSetting("Saved", "value", 42);
  settings.setEnabled("Saved", true);
  settings.load();
  manager.register({ name: "Saved", description: "Fixture", authors: ["Test"] });
  manager.register({ name: "New", description: "Fixture", authors: ["Test"] });
  assert.equal(settings.getEnabled("New"), undefined);
  await manager.startEnabled();
  assert.equal(manager.isStarted("Saved"), true);
  assert.equal(settings.getPluginSetting("Saved", "value"), 42);
});

test("concurrent enable/disable serialize; pending startup cannot resurrect a disabled plugin", async () => {
  const { manager } = setup();
  let starts = 0;
  let stops = 0;
  manager.register({ name: "Race", description: "Fixture", authors: ["Test"], async start() { starts++; await new Promise(resolve => setTimeout(resolve, 5)); }, stop() { stops++; } });
  await Promise.all([manager.enable("Race"), manager.enable("Race"), manager.disable("Race")]);
  assert.equal(starts, 1);
  assert.equal(stops, 1);
  assert.equal(manager.isEnabled("Race"), false);
  assert.equal(manager.isStarted("Race"), false);
});

test("failed startup stops partial work, removes patches and disables the plugin", async () => {
  const { manager, settings, patcher } = setup();
  const target = { value: () => 1 };
  let stopped = false;
  manager.register({ name: "Broken", description: "Fixture", authors: ["Test"], start() { patcher.after("Broken", target, "value", () => 2); throw new Error("failed start"); }, stop() { stopped = true; } });
  assert.equal(await manager.enable("Broken"), false);
  assert.equal(stopped, true);
  assert.equal(target.value(), 1);
  assert.equal(patcher.getPatchCount("Broken"), 0);
  assert.equal(settings.getEnabled("Broken"), false);
});

test("shutdown waits for startup and keeps enabled flags for restart", async () => {
  const { manager, settings } = setup();
  let stops = 0;
  manager.register({ name: "Pending", description: "Fixture", authors: ["Test"], async start() { await new Promise(resolve => setTimeout(resolve, 5)); }, stop() { stops++; } });
  await Promise.all([manager.enable("Pending"), manager.shutdown()]);
  assert.equal(manager.isStarted("Pending"), false);
  assert.equal(stops, 1);
  assert.equal(settings.getEnabled("Pending"), true);
  await manager.startEnabled();
  assert.equal(manager.isStarted("Pending"), true);
  await manager.shutdown();
});

test("plugin custom state and method this survive definition validation", async () => {
  const { manager } = setup();
  const definition = { name: "Stateful", description: "Fixture", authors: ["Test"], value: 0, start() { this.value++; }, stop() { this.value--; } };
  manager.register(definition);
  await manager.enable("Stateful");
  assert.equal(definition.value, 1);
  await manager.disable("Stateful");
  assert.equal(definition.value, 0);
});

test("theme import, persist, live toggles, removal and shutdown", () => {
  const settings = new SettingsStore();
  const styles = new StylesManager({ getDocument: () => undefined });
  const stop = startThemes(settings, styles);
  const theme = importTheme(settings, MIDNIGHT_THEME, "midnight.css");
  assert.equal(theme.name, "Vestra Midnight");
  assert.equal(theme.enabled, false);
  assert.equal(styles.list().length, 0);
  settings.setThemes([{ ...theme, enabled: true }]);
  assert.equal(styles.get(`theme-${theme.id}`), MIDNIGHT_THEME);
  settings.load();
  assert.equal(settings.getThemes()[0]?.enabled, true);
  settings.setThemes([]);
  assert.equal(styles.list().length, 0);
  settings.setThemes([{ ...theme, enabled: true }]);
  stop();
  assert.equal(styles.list().length, 0);
  assert.throws(() => importTheme(settings, "", "empty.css"), /empty/);
  assert.throws(() => importTheme(settings, "x".repeat(512_001), "large.css"), /512/);
});

test("instead patches propagate original exceptions once without repeating side effects", () => {
  const patcher = new Patcher();
  let calls = 0;
  const failure = new Error("original failed");
  const target = { call() { calls++; throw failure; } };
  patcher.instead("Test", target, "call", (_args, original) => original());
  assert.throws(() => target.call(), err => err === failure);
  assert.equal(calls, 1);
});

test("an instead hook throwing after a successful call never calls the original twice", () => {
  const patcher = new Patcher();
  let calls = 0;
  const target = { call() { calls++; return 7; } };
  patcher.instead("Test", target, "call", (_args, original) => { original(); throw new Error("hook failed"); });
  assert.equal(target.call(), 7);
  assert.equal(calls, 1);
});

test("Webpack require is captured through a real chunk callback without loading modules", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = g["__VESTRA_WEBPACK_REQUIRE__"];
  const require = Object.assign(() => {}, { c: { test: { exports: { marker: true } } } });
  const chunks: unknown[] = [];
  chunks.push = function (...items: unknown[]): number {
    const chunk = items[0] as [unknown, unknown, (r: unknown) => void];
    chunk[2](require);
    return Array.prototype.push.apply(this, items);
  };
  g["webpackChunkVestraFixture"] = chunks;
  delete g["__VESTRA_WEBPACK_REQUIRE__"];
  Object.defineProperty(g, "vestraThrowingGetter", { configurable: true, enumerable: true, get() { throw new Error("blocked"); } });
  try {
    assert.equal(getWebpackRequire(), require);
    assert.equal(chunks.length, 0);
  } finally {
    delete g["webpackChunkVestraFixture"];
    delete g["vestraThrowingGetter"];
    if (saved === undefined) delete g["__VESTRA_WEBPACK_REQUIRE__"];
    else g["__VESTRA_WEBPACK_REQUIRE__"] = saved;
  }
});
