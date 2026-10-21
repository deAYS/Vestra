import { test } from "node:test";
import assert from "node:assert/strict";
import { SettingsStore } from "./api/settings.js";
import { DEFAULT_THEME_CUSTOMIZATION } from "./themeCustomization.js";
import { exportThemePackage, importThemePackage } from "./themeTransfer.js";

test("theme packages preserve exact CSS, appearance and embedded images without overwriting active themes", async () => {
  const settings = new SettingsStore();
  const theme = {
    id: "private-id",
    enabled: true,
    sourceFile: "private-path.css",
    name: "Glass",
    author: "Creator",
    css: "  :root{--x:red}\n",
    customization: {
      ...DEFAULT_THEME_CUSTOMIZATION,
      glowStrength: 40,
      surfaceOverrides: false,
      backgroundImage: "data:image/png;base64,aGVsbG8=",
    },
  };
  settings.setThemes([theme]);
  const data = exportThemePackage(theme);
  assert.ok(!data.includes("private-id") && !data.includes("private-path"));
  const imported = importThemePackage(settings, data);
  assert.equal(imported.enabled, false);
  assert.notEqual(imported.id, theme.id);
  assert.equal(imported.css, theme.css);
  assert.deepEqual(imported.customization, theme.customization);
  assert.equal(settings.getThemes()[0]!.enabled, true);
  assert.notEqual(importThemePackage(settings, data).id, imported.id);
});
test("invalid, unsafe and oversized theme packages leave the library untouched", () => {
  const settings = new SettingsStore();
  for (const text of [
    "bad",
    JSON.stringify({ format: "vestra-theme", version: 2, theme: {} }),
    "x".repeat(3_000_001),
    JSON.stringify({
      format: "vestra-theme",
      version: 1,
      theme: {
        name: "Unsafe",
        author: "",
        css: "a{}",
        customization: {
          ...DEFAULT_THEME_CUSTOMIZATION,
          backgroundImage: "javascript:alert(1)",
        },
      },
    }),
  ])
    assert.throws(() => importThemePackage(settings, text));
  assert.equal(settings.getThemes().length, 0);
});
