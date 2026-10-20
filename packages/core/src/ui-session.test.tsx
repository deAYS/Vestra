import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SettingsStore } from "./api/settings.js";
import { VestraSettingsPanel } from "./ui/VestraSettings.js";
import { themePreviewDocument, themePeekPosition } from "./ui/ThemePeek.js";

test("theme previews stay beside upper buttons, flip above lower ones and fit small panels", () => {
  const bounds = { width: 1040, height: 730 };
  const upper = themePeekPosition({ left: 370, top: 150, bottom: 180, width: 70 }, bounds);
  assert.equal(upper.top, 190, "upper cards open directly below their preview button");
  const lower = themePeekPosition({ left: 850, top: 650, bottom: 680, width: 70 }, bounds);
  assert.ok(lower.top + lower.height <= 640, "lower cards open above their preview button");
  assert.ok(lower.left + lower.width <= bounds.width - 12);
  const narrow = themePeekPosition({ left: 250, top: 80, bottom: 110, width: 60 }, { width: 320, height: 280 });
  assert.ok(narrow.left >= 12 && narrow.top >= 12);
  assert.ok(narrow.left + narrow.width <= 308);
  assert.ok(narrow.top + narrow.height <= 268);
});

test("settings reopen on the last page and scroll position; hidden launcher can be restored there", async () => {
  const win = new Window();
  const keys = ["window", "document", "HTMLElement", "Element", "IS_REACT_ACT_ENVIRONMENT"];
  const old = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const values = [win, win.document, win.HTMLElement, win.Element, true];
  keys.forEach((key, i) => Object.defineProperty(globalThis, key, { value: values[i], configurable: true, writable: true }));
  const settings = new SettingsStore();
  settings.setPluginSetting("Vestra", "launcherHidden", true);
  const plugins = { list: () => [], enable: async () => true, disable: async () => true, getLastError: () => undefined };
  const node = document.createElement("div");
  document.body.append(node);
  let root = createRoot(node as unknown as Element);
  try {
    await act(async () => { root.render(<VestraSettingsPanel settings={settings} plugins={plugins} version="test" />); });
    await act(async () => { node.querySelector<HTMLButtonElement>('button[aria-label="Themes"]')!.click(); });
    const content = node.querySelector<HTMLElement>(".vs-settings-content")!;
    content.scrollTop = 237;
    await act(async () => { content.dispatchEvent(new win.Event("scroll") as unknown as Event); });
    await act(async () => { root.unmount(); });
    assert.equal(settings.getPluginSetting("Vestra", "lastSettingsPage"), "themes");
    root = createRoot(node as unknown as Element);
    await act(async () => { root.render(<VestraSettingsPanel settings={settings} plugins={plugins} version="test" />); });
    assert.equal(node.querySelector('[aria-current="page"]')?.getAttribute("aria-label"), "Themes");
    assert.equal(node.querySelector<HTMLElement>(".vs-settings-content")?.scrollTop, 237);
    const restore = [...node.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes("Show floating button"))!;
    assert.ok(restore);
    await act(async () => { restore.click(); });
    assert.equal(settings.getPluginSetting("Vestra", "launcherHidden"), false);
    const themesBefore = settings.getThemes();
    const preview = node.querySelector<HTMLButtonElement>('button[aria-label="Preview Vestra Midnight"]')!;
    await act(async () => { preview.click(); });
    assert.equal(node.querySelector("iframe")?.getAttribute("sandbox"), "");
    assert.deepEqual(settings.getThemes(), themesBefore);
    await act(async () => { preview.dispatchEvent(new win.FocusEvent("focusout", { bubbles: true }) as unknown as Event); });
    assert.equal(node.querySelector("iframe"), null);
  } finally {
    await act(async () => { root.unmount(); });
    keys.forEach((key, i) => { const descriptor = old[i]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    await win.happyDOM.close();
  }
});

test("theme previews block remote content and prevent CSS from escaping its style element", () => {
  const doc = themePreviewDocument('body{color:red}</style><script>bad()</script>@import url(https://example.invalid/theme.css);');
  assert.ok(doc.includes("default-src 'none'"));
  assert.ok(doc.includes("font-src 'none'"));
  assert.ok(!doc.includes("<script>"));
  assert.ok(doc.includes("\\3c /style>"));
});
