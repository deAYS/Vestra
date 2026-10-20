import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { SettingsStore } from "./api/settings.js";
import {
  THEME_LIBRARY,
  applyThemePreset,
  upgradeBuiltinThemes,
} from "./themes.js";
import {
  cleanLink,
  formatTimestamp,
  messageLink,
  messageText,
} from "./plugins/utilities.js";
import { launcherBounds, readLauncherPosition } from "./ui/launcherPosition.js";

const legacyRose = `/** @name Vestra Rose\n * @author Vestra\n */\n:root,.theme-dark{--background-primary:#241622;--background-secondary:#1c111b;--background-secondary-alt:#180e16;--background-tertiary:#160d14;--background-floating:#30202e;--channeltextarea-background:#332131;--brand-500:#c985a9;--brand-560:#b47296;--brand-600:#a46388;--text-link:#efb3d0}`;

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
