import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { SettingsStore } from "./api/settings.js";
import { StylesManager } from "./api/styles.js";
import { startQuickCss } from "./quickCss.js";
import { importTheme, startThemes, themeSyncKey } from "./themes.js";
import { DEFAULT_THEME_CUSTOMIZATION } from "./themeCustomization.js";

const THEME_CSS = "/** @name Fixture */\n:root{--text-link:#abcdef}";

/** MutationObserver records arrive on a later task in happy-dom. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Fixture {
  win: Window;
  head: HTMLHeadElement;
  settings: SettingsStore;
  themeId: string;
  /** appendChild/insertBefore calls made on <head> by Vestra (the test uses raw ones). */
  moves: () => number;
  textReads: () => number;
  textWrites: () => number;
  /** Discord-side insertion that bypasses the move counter. */
  discordAppend: (node: Node) => void;
  discordInsertFirst: (node: Node) => void;
  discordStyle: (css?: string) => HTMLStyleElement;
  vestraOrder: () => string[];
  spyStyles: () => void;
  stop: () => void;
}

async function fixture(): Promise<Fixture> {
  const win = new Window();
  const keys = ["window", "document"] as const;
  const old = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const values = [win, win.document];
  keys.forEach((key, i) =>
    Object.defineProperty(globalThis, key, {
      value: values[i],
      configurable: true,
      writable: true,
    }),
  );
  const doc = win.document as unknown as Document;
  const head = doc.head;
  const discordStyle = (css = "a{color:red}"): HTMLStyleElement => {
    const el = doc.createElement("style");
    el.textContent = css;
    return el;
  };
  head.appendChild(discordStyle("body{margin:0}"));
  const settings = new SettingsStore();
  const styles = new StylesManager({
    getDocument: () => doc as never,
  });
  const theme = importTheme(settings, THEME_CSS, "fixture.css");
  settings.activateTheme(theme.id);
  settings.setCustomCss({ enabled: true, css: "body{color:blue}" });
  const stopQuick = startQuickCss({ settings, styles });
  const stopThemes = startThemes(settings, styles);
  await settle();

  const rawAppend = head.appendChild.bind(head);
  const rawInsert = head.insertBefore.bind(head);
  // Count top-level calls only: happy-dom re-enters appendChild per fragment child.
  let moves = 0;
  let depth = 0;
  const counted = <T,>(run: () => T): T => {
    if (depth === 0) moves++;
    depth++;
    try {
      return run();
    } finally {
      depth--;
    }
  };
  head.appendChild = function <T extends Node>(node: T): T {
    return counted(() => rawAppend(node));
  };
  head.insertBefore = function <T extends Node>(node: T, child: Node | null): T {
    return counted(() => rawInsert(node, child));
  };

  let reads = 0;
  let writes = 0;
  const descriptor = Object.getOwnPropertyDescriptor(
    win.Element.prototype,
    "textContent",
  )!;
  const spied = new WeakSet<object>();
  const spyStyles = (): void => {
    for (const el of head.querySelectorAll("style")) {
      if (spied.has(el)) continue;
      spied.add(el);
      Object.defineProperty(el, "textContent", {
        configurable: true,
        get() {
          reads++;
          return descriptor.get!.call(this);
        },
        set(value: string) {
          writes++;
          descriptor.set!.call(this, value);
        },
      });
    }
  };
  spyStyles();

  return {
    win,
    head,
    settings,
    themeId: theme.id,
    moves: () => moves,
    textReads: () => reads,
    textWrites: () => writes,
    discordAppend: (node) => {
      rawAppend(node);
    },
    discordInsertFirst: (node) => {
      rawInsert(node, head.firstChild);
    },
    discordStyle,
    vestraOrder: () =>
      [...head.querySelectorAll("style,link")]
        .slice(-2)
        .map((el) => el.getAttribute("data-vestra-style") ?? "discord"),
    spyStyles,
    stop: () => {
      stopThemes();
      stopQuick();
      win.close();
      keys.forEach((key, i) => {
        const previous = old[i];
        if (previous) Object.defineProperty(globalThis, key, previous);
        else Reflect.deleteProperty(globalThis, key);
      });
    },
  };
}

test("settings changes unrelated to themes never touch a style node", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.vestraOrder(), [`theme-${f.themeId}`, "quickcss"]);
    f.settings.setEnabled("FixturePlugin", true);
    f.settings.setPluginSetting("FixturePlugin", "value", 1);
    f.settings.setEnabled("FixturePlugin", false);
    await settle();
    assert.equal(f.textReads(), 0, "no textContent reads");
    assert.equal(f.textWrites(), 0, "no textContent writes");
    assert.equal(f.moves(), 0, "no style node moves");
  } finally {
    f.stop();
  }
});

test("Discord stylesheet batches cause one reorder only when Vestra styles are no longer last", async () => {
  const f = await fixture();
  try {
    // One batch of 10 appended stylesheets: one reorder, and our own move does not loop.
    for (let i = 0; i < 10; i++) f.discordAppend(f.discordStyle());
    await settle();
    assert.equal(f.moves(), 1);
    assert.deepEqual(f.vestraOrder(), [`theme-${f.themeId}`, "quickcss"]);
    await settle();
    assert.equal(f.moves(), 1, "the reorder's own mutation does not reorder again");

    // Ten separate batches: exactly one reorder each.
    for (let i = 0; i < 10; i++) {
      f.discordAppend(f.discordStyle());
      await settle();
      assert.equal(f.moves(), 2 + i);
    }

    // Stylesheets inserted before ours, or non-stylesheet nodes after ours: no reorder.
    const before = f.moves();
    for (let i = 0; i < 10; i++) {
      f.discordInsertFirst(f.discordStyle());
      f.discordAppend(f.win.document.createElement("meta") as unknown as Node);
      await settle();
    }
    assert.equal(f.moves(), before, "already last: nothing moves");
    assert.deepEqual(f.vestraOrder(), [`theme-${f.themeId}`, "quickcss"]);
    f.spyStyles();
    assert.equal(f.textWrites(), 0, "reordering never rewrites style text");
  } finally {
    f.stop();
  }
});

test("a style node Discord removes is restored and same-length CSS edits still apply", async () => {
  const f = await fixture();
  try {
    const selector = `style[data-vestra-style="theme-${f.themeId}"]`;
    f.head.querySelector(selector)!.remove();
    await settle();
    const restored = f.head.querySelector(selector);
    assert.ok(restored, "the theme style is re-attached");
    assert.equal(restored.textContent, THEME_CSS);
    assert.deepEqual(f.vestraOrder(), [`theme-${f.themeId}`, "quickcss"]);

    const edited = THEME_CSS.replace("#abcdef", "#fedcba");
    assert.equal(edited.length, THEME_CSS.length);
    f.settings.setThemes(
      f.settings
        .getThemes()
        .map((theme) => ({ ...theme, css: edited })),
    );
    await settle();
    assert.equal(f.head.querySelector(selector)?.textContent, edited);
  } finally {
    f.stop();
  }
});

test("the theme sync key follows theme inputs and ignores unrelated settings", () => {
  const settings = new SettingsStore();
  const theme = importTheme(settings, THEME_CSS, "fixture.css");
  const key = () =>
    themeSyncKey({
      themes: settings.getThemes(),
      customCss: settings.getCustomCss(),
    });
  const inactive = key();
  settings.activateTheme(theme.id);
  const active = key();
  assert.notEqual(active, inactive);
  settings.setEnabled("FixturePlugin", true);
  settings.setPluginSetting("FixturePlugin", "value", 2);
  assert.equal(key(), active, "plugin settings do not change the key");
  settings.setThemeCustomization(theme.id, DEFAULT_THEME_CUSTOMIZATION);
  const customized = key();
  assert.notEqual(customized, active);
  settings.setThemeCustomization(theme.id, {
    ...DEFAULT_THEME_CUSTOMIZATION,
    blur: 3,
  });
  assert.notEqual(key(), customized);
  const blurred = key();
  settings.setCustomCss({ enabled: true, css: "a{}" });
  assert.notEqual(key(), blurred, "QuickCSS state is part of the key");
});
