import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { SettingsStore, ThemeCustomizationSchema } from "./api/settings.js";
import releasedGlassCss from "../../../themes/history/liquid-glass-2.0.1.theme.css";
import readabilityGlassCss from "../../../themes/history/liquid-glass-2.1.0.theme.css";
import releasedAfterglowCss from "../../../themes/history/afterglow-1.0.0.theme.css";
import {
  THEME_LIBRARY,
  applyThemePreset,
  upgradeBuiltinThemes,
  refreshLocalThemes,
} from "./themes.js";
import { combosEqual } from "./ui/keybind.js";
import { PluginDefinitionSchema } from "./api/plugins.js";
import {
  cleanLink,
  formatTimestamp,
  messageLink,
  messageText,
} from "./plugins/utilities.js";
import { launcherBounds, readLauncherPosition } from "./ui/launcherPosition.js";

const legacyRose = `/** @name Vestra Rose\n * @author Vestra\n */\n:root,.theme-dark{--background-primary:#241622;--background-secondary:#1c111b;--background-secondary-alt:#180e16;--background-tertiary:#160d14;--background-floating:#30202e;--channeltextarea-background:#332131;--brand-500:#c985a9;--brand-560:#b47296;--brand-600:#a46388;--text-link:#efb3d0}`;

for (const version of ["2.0.0", "2.0.1", "2.1.0"]) test(`Glass ${version} upgrade preserves selection and appearance without replacing edited CSS`, () => {
  const preset = THEME_LIBRARY.find(theme => theme.name === "Vestra Liquid Glass")!;
  const previous = version === "2.1.0" ? readabilityGlassCss : version === "2.0.1" ? releasedGlassCss : releasedGlassCss.replace("@version 2.0.1", "@version 2.0.0").replace("padding-top:12px!important;box-sizing:border-box;", "");
  const settings = new SettingsStore();
  settings.setThemes([
    { id: "glass", name: preset.name, author: "Vestra", css: previous, enabled: true, customization: ThemeCustomizationSchema.parse({ opacity: 42, blur: 20, saturation: 90, brightness: 100, radius: 22, backgroundColor: "", backgroundImage: "" }) },
    { id: "edited", name: preset.name, author: "Vestra", css: previous + "\nbody{color:red}", enabled: false },
  ]);
  upgradeBuiltinThemes(settings);
  assert.equal(settings.getThemes()[0]?.css, preset.css);
  assert.equal(settings.getThemes()[0]?.enabled, true);
  assert.equal(settings.getThemes()[0]?.customization?.opacity, 42);
  assert.equal(settings.getThemes()[1]?.css, previous + "\nbody{color:red}");
});

test("Afterglow refresh preserves identity and leaves user-edited copies alone", () => {
  const settings = new SettingsStore();
  settings.setThemes([
    { id:"warm",name:"Vestra Afterglow",author:"Vestra",css:releasedAfterglowCss,enabled:true },
    { id:"edited",name:"Vestra Afterglow",author:"Vestra",css:releasedAfterglowCss+"\nbody{color:red}",enabled:false },
  ]);
  upgradeBuiltinThemes(settings);
  assert.equal(settings.getThemes()[0]?.css,THEME_LIBRARY.find(theme=>theme.name==="Vestra Afterglow")!.css);
  assert.equal(settings.getThemes()[0]?.id,"warm");
  assert.equal(settings.getThemes()[0]?.enabled,true);
  assert.equal(settings.getThemes()[1]?.css,releasedAfterglowCss+"\nbody{color:red}");
});

test("saved old presets migrate without changing identity, toggles or custom CSS", () => {
  const settings = new SettingsStore();
  settings.setThemes([
    {
      id: "old",
      name: "Vestra Rose",
      author: "Vestra",
      css: legacyRose,
      enabled: true,
    },
    {
      id: "custom",
      name: "Vestra Rose",
      author: "Vestra",
      css: legacyRose + "\n/* my edits */",
      enabled: false,
    },
  ]);
  upgradeBuiltinThemes(settings);
  const [updated, custom] = settings.getThemes();
  assert.equal(updated?.id, "old");
  assert.equal(updated?.enabled, true);
  assert.equal(updated?.css, THEME_LIBRARY[2]!.css);
  assert.equal(custom?.css, legacyRose + "\n/* my edits */");
  settings.load();
  assert.equal(
    settings.getThemes()[0]?.css,
    THEME_LIBRARY[2]!.css,
    "migration persists across reloads",
  );
  applyThemePreset(settings, THEME_LIBRARY[2]!);
  assert.equal(
    settings.getThemes().length,
    2,
    "applying the same preset doesn't duplicate it",
  );
  assert.equal(settings.getThemes().filter((theme) => theme.enabled).length, 1);
});

test("a custom theme sharing a preset name is not silently treated as that preset", () => {
  const settings = new SettingsStore();
  settings.setThemes([
    {
      id: "custom",
      name: "Vestra Rose",
      author: "Me",
      css: "body{color:red}",
      enabled: true,
    },
  ]);
  applyThemePreset(settings, THEME_LIBRARY[2]!);
  assert.equal(settings.getThemes()[0]?.css, "body{color:red}");
  assert.equal(settings.getThemes()[0]?.enabled, false);
  assert.equal(settings.getThemes()[1]?.enabled, true);
});

test("theme switches are exclusive across preset and library entry points", () => {
  const settings = new SettingsStore();
  for (const preset of THEME_LIBRARY) applyThemePreset(settings, preset);
  assert.equal(settings.getThemes().filter((theme) => theme.enabled).length, 1);
  const first = settings.getThemes()[0]!;
  settings.setThemes(
    settings
      .getThemes()
      .map((theme) =>
        theme.id === first.id ? { ...theme, enabled: true } : theme,
      ),
  );
  assert.deepEqual(
    settings
      .getThemes()
      .filter((theme) => theme.enabled)
      .map((theme) => theme.id),
    [first.id],
  );
  settings.activateTheme(null);
  assert.equal(
    settings.getThemes().some((theme) => theme.enabled),
    false,
  );
  assert.throws(() => settings.activateTheme("missing"), /not found/);
});

test("old overlapping theme selections migrate and stay exclusive after reload", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  let raw = JSON.stringify({
    themes: THEME_LIBRARY.map((preset, index) => ({
      id: `old-${index}`,
      name: preset.name,
      author: "Vestra",
      css: preset.css,
      enabled: true,
    })),
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    },
  });
  try {
    const settings = new SettingsStore();
    settings.load();
    assert.deepEqual(
      settings
        .getThemes()
        .filter((theme) => theme.enabled)
        .map((theme) => theme.id),
      [`old-${THEME_LIBRARY.length - 1}`],
    );
    assert.equal(
      JSON.parse(raw).themes.filter(
        (theme: { enabled: boolean }) => theme.enabled,
      ).length,
      1,
    );
    settings.activateTheme("old-0");
    settings.load();
    assert.deepEqual(
      settings
        .getThemes()
        .filter((theme) => theme.enabled)
        .map((theme) => theme.id),
      ["old-0"],
    );
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("local theme refresh preserves selection and identity and keeps missing files recoverable", async () => {
  const settings = new SettingsStore();
  applyThemePreset(settings, THEME_LIBRARY[0]!);
  let files = [
    {
      filename: "forest.theme.css",
      source: "/** @name Forest */\nbody{color:green}",
    },
  ];
  const native = { readThemeFiles: async () => files };
  await refreshLocalThemes(settings, native);
  const local = settings.getThemes().find((theme) => theme.sourceFile)!;
  settings.activateTheme(local.id);
  settings.load();
  assert.equal(
    settings.getThemes().find((theme) => theme.id === local.id)?.css,
    "",
  );
  await refreshLocalThemes(settings, native);
  assert.equal(
    settings.getThemes().find((theme) => theme.id === local.id)?.enabled,
    true,
  );
  assert.equal(
    settings.getThemes().find((theme) => theme.id === local.id)?.css,
    files[0]!.source,
  );
  files = [
    {
      filename: "forest.theme.css",
      source: "/** @name New forest */\nbody{color:lime}",
    },
  ];
  await refreshLocalThemes(settings, native);
  assert.equal(
    settings.getThemes().find((theme) => theme.id === local.id)?.name,
    "New forest",
  );
  assert.equal(
    settings.getThemes().find((theme) => theme.id === local.id)?.enabled,
    true,
  );
  await assert.rejects(
    () =>
      refreshLocalThemes(settings, {
        readThemeFiles: async () => {
          throw Error("Disk unavailable");
        },
      }),
    /unavailable/,
  );
  assert.equal(
    settings.getThemes().find((theme) => theme.id === local.id)?.enabled,
    true,
  );
  files = [];
  await refreshLocalThemes(settings, native);
  assert.equal(settings.getThemes().length, 2);
  const missing = settings.getThemes().find(theme => theme.id === local.id)!;
  assert.equal(missing.enabled, true);
  assert.equal(missing.sourceMissing, true);
  assert.ok(missing.css.includes("lime"));
});

test("shortcut identity ignores modifier order while plugin schema rejects unusable defaults", () => {
  assert.equal(combosEqual("Alt+Ctrl+G", "ctrl+alt+g"), true);
  assert.equal(combosEqual("Ctrl+Alt+G", "Ctrl+Shift+G"), false);
  const definition = {
    name: "Options",
    description: "Options test",
    authors: ["Test"],
  };
  assert.equal(
    PluginDefinitionSchema.safeParse({
      ...definition,
      settingsSchema: {
        size: { type: "number", label: "Size", default: 20, min: 50, max: 100 },
      },
    }).success,
    false,
  );
  assert.equal(
    PluginDefinitionSchema.safeParse({
      ...definition,
      settingsSchema: {
        color: {
          type: "select",
          label: "Color",
          default: "missing",
          options: [{ label: "Blue", value: "blue" }],
        },
      },
    }).success,
    false,
  );
});

test("launcher geometry survives tiny windows, resizing and corrupt saved positions", () => {
  assert.deepEqual(
    readLauncherPosition({ x: Infinity, y: NaN }),
    readLauncherPosition(null),
  );
  assert.deepEqual(readLauncherPosition({ x: -5, y: 20 }), { x: 0, y: 1 });
  for (const [width, height] of [
    [40, 20],
    [320, 240],
    [1920, 1080],
  ]) {
    const bounds = launcherBounds(width!, height!, 83, 37);
    assert.ok(
      bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.travelX >= 0 &&
        bounds.travelY >= 0,
    );
    if (width! >= 83) assert.ok(bounds.left + bounds.travelX + 83 <= width!);
    if (height! >= 37) assert.ok(bounds.top + bounds.travelY + 37 <= height!);
  }
});

test("clean links preserve meaningful parameters, signatures and fragments", () => {
  assert.equal(
    cleanLink(
      "https://example.com/watch?v=abc&utm_source=discord&fbclid=xx&t=12#part",
    ),
    "https://example.com/watch?v=abc&t=12#part",
  );
  assert.equal(
    cleanLink("https://cdn.discordapp.com/a?ex=123&is=456&hm=signature"),
    "https://cdn.discordapp.com/a?ex=123&is=456&hm=signature",
  );
  assert.throws(() => cleanLink("javascript:alert(1)"), /web links/);
});

test("message links require the correct message channel and support DMs", () => {
  const window = new Window();
  window.document.body.innerHTML =
    '<li id="chat-messages-123-456"><div id="message-content-456"><b>Message</b></div></li>';
  const element = window.document.querySelector("b")! as unknown as Element;
  assert.equal(
    messageLink(element, "/channels/789/123"),
    "https://discord.com/channels/789/123/456",
  );
  assert.equal(
    messageLink(element, "/channels/@me/123"),
    "https://discord.com/channels/@me/123/456",
  );
  assert.equal(messageLink(element, "/channels/789/999"), undefined);
  assert.equal(messageLink(element, "/login"), undefined);
  assert.equal(formatTimestamp("invalid"), undefined);
  assert.ok(formatTimestamp("2026-10-20T03:15:32Z", "en-GB")?.includes("32"));
});

test("message copies keep emoji and code line breaks while excluding added buttons", () => {
  const window = new Window();
  window.document.body.innerHTML =
    '<div id="message-content-456">Hello <img alt=":wave:"/><br/>Next<pre><code>const x = 1;\nconst y = 2;</code><button data-vestra-code-copy>Copy</button></pre></div>';
  assert.equal(
    messageText(window.document.body.firstElementChild! as unknown as Element),
    "Hello :wave:\nNext\nconst x = 1;\nconst y = 2;",
  );
});
