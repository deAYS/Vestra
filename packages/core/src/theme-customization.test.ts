import { test } from "node:test";
import assert from "node:assert/strict";
import { SettingsStore, ThemeCustomizationSchema } from "./api/settings.js";
import {
  applyThemePreset,
  refreshLocalThemes,
  THEME_LIBRARY,
} from "./themes.js";
import {
  customizedThemeCss,
  DEFAULT_THEME_CUSTOMIZATION,
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
