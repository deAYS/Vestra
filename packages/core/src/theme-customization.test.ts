import { test } from "node:test";
import assert from "node:assert/strict";
import { SettingsStore, ThemeCustomizationSchema } from "./api/settings.js";
import {
  applyThemePreset,
  importTheme,
  refreshLocalThemes,
  removeTheme,
  THEME_LIBRARY,
} from "./themes.js";
import {
  customizedThemeCss,
  DEFAULT_THEME_CUSTOMIZATION,
  memoizeThemeCss,
  themeCustomizationCss,
} from "./themeCustomization.js";

test("appearance, embedded backgrounds and exclusive selection survive a fresh desktop store", async () => {
  let disk: string | undefined;
  const backend = {
    async readSettingsFile() {
      return disk;
    },
    async writeSettingsFile(text: string) {
      disk = text;
    },
  };
  const first = new SettingsStore();
  await first.connectStorage(backend);
  applyThemePreset(
    first,
    THEME_LIBRARY.find((theme) => theme.name === "Vestra Liquid Glass")!,
  );
  const glass = first.getThemes()[0]!;
  const customization = {
    ...DEFAULT_THEME_CUSTOMIZATION,
    opacity: 61,
    blur: 12,
    saturation: 83,
    textColor: "#e8e3ff",
    glowColor: "#aabbee",
    glowStrength: 35,
    popupOpacity: 95,
    settingsOpacity: 98,
    backgroundImage: "data:image/png;base64,aGVsbG8=",
  };
  first.setThemeCustomization(glass.id, customization);
  applyThemePreset(first, THEME_LIBRARY[0]!);
  const midnight = first.getThemes()[1]!;
  first.setThemeCustomization(midnight.id, {
    ...DEFAULT_THEME_CUSTOMIZATION,
    radius: 4,
  });
  first.activateTheme(glass.id);
  await first.flush();
  const next = new SettingsStore();
  await next.connectStorage(backend);
  assert.deepEqual(next.getThemes()[0]?.customization, customization);
  assert.equal(next.getThemes()[1]?.customization?.radius, 4);
  assert.equal(next.getThemes().filter((theme) => theme.enabled).length, 1);
  const snapshot = next.getThemes();
  snapshot[0]!.customization!.opacity = 99;
  assert.equal(
    next.getThemes()[0]?.customization?.opacity,
    61,
    "snapshots cannot mutate the stored appearance",
  );
  next.setThemeCustomization(glass.id, undefined);
  assert.equal(
    customizedThemeCss(next.getThemes()[0]!),
    glass.css,
    "restore removes all generated overrides",
  );
  await next.flush();
});

test("refreshing local CSS preserves that theme's appearance and image", async () => {
  const settings = new SettingsStore();
  const read = (source: string) => ({
    readThemeFiles: async () => [{ filename: "local.css", source }],
  });
  await refreshLocalThemes(settings, read("body{color:red}"));
  const theme = settings.getThemes()[0]!;
  settings.setThemeCustomization(theme.id, {
    ...DEFAULT_THEME_CUSTOMIZATION,
    backgroundColor: "#123456",
    saturation: 30,
  });
  await refreshLocalThemes(settings, read("body{color:green}"));
  assert.equal(settings.getThemes()[0]?.css, "body{color:green}");
  assert.equal(
    settings.getThemes()[0]?.customization?.backgroundColor,
    "#123456",
  );
});

test("appearance rejects invalid controls and unsafe image schemes", () => {
  for (const image of [
    "file:///C:/secret",
    "javascript:alert(1)",
    "http://example.com/x.png",
    "data:text/html;base64,abcd",
    "https://user:pass@example.com/x.png",
  ]) {
    assert.equal(
      ThemeCustomizationSchema.safeParse({ backgroundImage: image }).success,
      false,
    );
  }
  for (const settings of [
    { opacity: -1 },
    { opacity: 101 },
    { blur: 49 },
    { radius: 50 },
    { saturation: Number.NaN },
    { backgroundColor: "red;background:url(x)" },
    { textColor: "red;opacity:0" },
    { glowStrength: 101 },
    { popupOpacity: -1 },
    { settingsOpacity: 101 },
  ]) {
    assert.equal(ThemeCustomizationSchema.safeParse(settings).success, false);
  }
  assert.equal(
    ThemeCustomizationSchema.safeParse({
      opacity: 0, homeOpacity: 0, popupOpacity: 0, settingsOpacity: 0, brightness: 0,
    }).success,
    true,
  );
  assert.equal(
    ThemeCustomizationSchema.safeParse({
      backgroundImage: "https://example.com/image.webp",
    }).success,
    true,
  );
  assert.throws(
    () =>
      new SettingsStore().setThemeCustomization(
        "missing",
        DEFAULT_THEME_CUSTOMIZATION,
      ),
    /not found/,
  );
});

test("customized CSS is generated once per distinct theme input", () => {
  const settings = new SettingsStore();
  const theme = importTheme(settings, "/** @name Memo */\n:root{--background-primary:#102030}", "memo.css");
  settings.setThemeCustomization(theme.id, { ...DEFAULT_THEME_CUSTOMIZATION, blur: 10 });
  let runs = 0;
  const generate = memoizeThemeCss((input) => {
    runs++;
    return customizedThemeCss(input);
  });
  const first = generate(settings.getThemes()[0]!);
  const second = generate(settings.getThemes()[0]!);
  assert.equal(runs, 1, "a second snapshot with the same inputs reuses the result");
  assert.equal(second, first);
  settings.setThemeCustomization(theme.id, { ...DEFAULT_THEME_CUSTOMIZATION, blur: 11 });
  const changed = generate(settings.getThemes()[0]!);
  assert.equal(runs, 2);
  assert.ok(changed.includes("--glass-blur:11px"));
  assert.ok(!changed.includes("--glass-blur:10px"));
  settings.setThemes(settings.getThemes().map((entry) => ({ ...entry, css: entry.css.replace("#102030", "#302010") })));
  assert.ok(generate(settings.getThemes()[0]!).includes("#302010"));
  assert.equal(runs, 3);
  // The shared generator matches the uncached output for each input.
  for (const customization of [undefined, DEFAULT_THEME_CUSTOMIZATION, { ...DEFAULT_THEME_CUSTOMIZATION, surfaceOverrides: false, glowStrength: 40 }]) {
    const input = { css: settings.getThemes()[0]!.css, customization };
    assert.equal(customizedThemeCss(input), input.css + themeCustomizationCss(input));
    assert.equal(customizedThemeCss({ ...input }), input.css + themeCustomizationCss(input));
  }
});

test("a full library still refreshes its existing files and only refuses new ones", async () => {
  const settings = new SettingsStore();
  const files = Array.from({ length: 32 }, (_, index) => ({
    filename: `local-${String(index).padStart(2, "0")}.css`,
    source: `body{--fixture:${index}}`,
  }));
  await refreshLocalThemes(settings, { readThemeFiles: async () => files });
  assert.equal(settings.getThemes().length, 32);
  const edited = files.map((file) => ({ ...file, source: file.source.replace("}", ";color:red}") }));
  await refreshLocalThemes(settings, { readThemeFiles: async () => edited });
  assert.ok(settings.getThemes().every((theme) => theme.css.includes("color:red")));
  const updated = edited.map((file, index) => index === 0 ? { ...file, source: "body{--fixture:updated}" } : file);
  await assert.rejects(
    () =>
      refreshLocalThemes(settings, {
        readThemeFiles: async () => [...updated, { filename: "local-new.css", source: "body{--fixture:new}" }],
      }),
    /Your library is full \(32 themes\)\. Remove a theme before importing more files\./,
  );
  assert.equal(settings.getThemes().length, 32);
  assert.equal(settings.getThemes()[0]?.css, "body{--fixture:updated}", "existing files refresh even when a new one is refused");
  assert.ok(!settings.getThemes().some((theme) => theme.sourceFile === "local-new.css"));
});

test("removing a theme whose file is already gone still removes it from the library", async () => {
  const settings = new SettingsStore();
  await refreshLocalThemes(settings, { readThemeFiles: async () => [{ filename: "gone.css", source: "body{}" }, { filename: "kept.css", source: "a{}" }] });
  const [gone, kept] = settings.getThemes();
  const removed: string[] = [];
  await removeTheme(settings, gone!, {
    async removeThemeFile(filename: string) {
      removed.push(filename);
      throw new Error(`Error invoking remote method 'vestra:native:addons:removeTheme': Error: ENOENT: no such file or directory, lstat '${filename}'`);
    },
  });
  assert.deepEqual(removed, ["gone.css"]);
  assert.deepEqual(settings.getThemes().map((theme) => theme.id), [kept!.id]);
  await assert.rejects(
    () => removeTheme(settings, kept!, { async removeThemeFile() { throw new Error("fixture permission denied"); } }),
    /permission denied/,
  );
  assert.equal(settings.getThemes().length, 1, "other failures keep the theme");
});
