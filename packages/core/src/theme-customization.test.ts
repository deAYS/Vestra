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
  glassInputs,
  memoizeThemeCss,
  themeCssCounters,
  themeCustomizationCss,
  themePreviewCss,
} from "./themeCustomization.js";
import { themePreviewDocument } from "./ui/ThemePeek.js";
import lastGlassCss from "../../../themes/history/liquid-glass-2.2.0.theme.css";

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

test("list previews of a large library never evict the active theme's cached CSS", () => {
  const active = {
    css: "/** @name Active */\n:root{--background-primary:#203040}",
    customization: { ...DEFAULT_THEME_CUSTOMIZATION, blur: 9 },
  };
  const library = Array.from({ length: 32 }, (_, index) => ({
    css: `/** @name Library ${index} */\n:root{--background-primary:#${String(index).padStart(6, "0")}}`,
    customization: { ...DEFAULT_THEME_CUSTOMIZATION, opacity: index },
  }));
  customizedThemeCss(active);
  for (const theme of library) themePreviewCss(theme);
  const before = themeCssCounters.generated;
  customizedThemeCss({ ...active, customization: { ...active.customization } });
  assert.equal(themeCssCounters.generated, before, "the runtime entry survives the previews");
  const scans = themeCssCounters.authoredScans;
  for (const theme of library) themePreviewCss({ ...theme, customization: { ...theme.customization } });
  assert.equal(themeCssCounters.authoredScans, scans, "every library theme stays cached for its preview");
});

test("customization comparison treats nested values by content", () => {
  let runs = 0;
  const generate = memoizeThemeCss(() => String(++runs));
  const css = ":root{}";
  const nested = { ...DEFAULT_THEME_CUSTOMIZATION, extra: { stops: [1, 2] } } as never;
  generate({ css, customization: nested });
  generate({ css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, extra: { stops: [1, 2] } } as never });
  assert.equal(runs, 1, "equal nested values reuse the result");
  generate({ css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, extra: { stops: [1, 3] } } as never });
  assert.equal(runs, 2, "changed nested values regenerate");
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

const LARGE_PANES = /chat_|sidebarList_|privateChannels_|membersWrap_|panels_|channelTextArea_|guilds_/;
const POPOUTS = /autocomplete_|menu_|userPopout_|messagesPopoutWrap_/;
/** Flat `selector{body}` pairs, including rules nested in @media blocks. */
const cssRules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim(),
    body: match[2]!,
  }));

test("customized glass paints large panes from the pre-blurred image with no live backdrop blur", () => {
  const glass = THEME_LIBRARY.find((theme) => theme.name === "Vestra Liquid Glass")!;
  const customization = {
    ...DEFAULT_THEME_CUSTOMIZATION,
    opacity: 68,
    blur: 12,
    saturation: 83,
    brightness: 90,
    backgroundImage: "data:image/png;base64,aGVsbG8=",
  };
  for (const css of [glass.css, "/** @name Plain */\n:root{--background-primary:#102030}"]) {
    const output = customizedThemeCss({ css, customization });
    const rules = cssRules(output);
    const panes = rules.filter((rule) => LARGE_PANES.test(rule.selector));
    assert.ok(panes.length > 0);
    for (const rule of panes)
      assert.ok(!/backdrop-filter:(?!var\(--vestra-glass-pane-filter,none\)!important)/.test(rule.body), `no backdrop blur on ${rule.selector}`);
    const popouts = rules.filter((rule) => POPOUTS.test(rule.selector) && !LARGE_PANES.test(rule.selector));
    assert.ok(popouts.some((rule) => rule.body.includes("backdrop-filter")), "popouts and menus keep their blur");
    // The generated rule follows (and overrides) the theme's own pane rules.
    const paneRule = [...rules].reverse().find((rule) => rule.selector.includes('[class*="channelTextArea_"]') && !rule.selector.endsWith(">*") && rule.body.includes("--vestra-glass-image"));
    assert.ok(paneRule, "panes reference the blurred image");
    assert.ok(
      paneRule.body.includes("linear-gradient(rgb(") && paneRule.body.includes(" / 0.68)") &&
        paneRule.body.includes("var(--vestra-glass-image,none) center/cover fixed"),
      "the tint sits over the fixed blurred image",
    );
    assert.ok(
      output.includes(':root[data-vestra-glass="layer"] #app-mount::before{') &&
        output.includes("filter:blur(12px) saturate(83%) brightness(90%)"),
      "unreadable images fall back to one blurred layer",
    );
    assert.ok(!output.includes("data:image/webp"), "the rendered image never enters the CSS");
  }
});

test("glass inputs come from the customization and are absent without surface overrides", () => {
  const css = ":root{}";
  assert.equal(glassInputs({ css, customization: undefined }), null);
  assert.equal(
    glassInputs({ css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, surfaceOverrides: false, backgroundImage: "data:image/png;base64,QQ==" } }),
    null,
  );
  assert.deepEqual(
    glassInputs({ css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, blur: 14, saturation: 75, brightness: 90, backgroundImage: "data:image/png;base64,QQ==" } }),
    { image: "data:image/png;base64,QQ==", css: null, blur: 14, saturation: 75, brightness: 90 },
  );
  assert.deepEqual(
    glassInputs({ css, customization: DEFAULT_THEME_CUSTOMIZATION }),
    { image: null, css: null, blur: 26, saturation: 125, brightness: 100 },
    "a flat colour needs no blurred copy",
  );
});

test("CSS wallpapers feed the renderer for Liquid Glass with and without a customization", () => {
  const glass = THEME_LIBRARY.find((theme) => theme.name === "Vestra Liquid Glass")!;
  const wallpaper = glass.css.match(/--vestra-wallpaper:([^;]+);/)![1]!;
  assert.deepEqual(
    glassInputs({ css: glass.css, customization: undefined }),
    { image: null, css: wallpaper, blur: 26, saturation: 125, brightness: 100 },
    "the shipped theme blurs its own gradient as its panes did",
  );
  assert.deepEqual(
    glassInputs({ css: glass.css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, surfaceOverrides: false, glowStrength: 30 } }),
    glassInputs({ css: glass.css, customization: undefined }),
    "text-only changes keep the theme's own glass",
  );
  assert.deepEqual(
    glassInputs({ css: glass.css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, blur: 12, saturation: 80, brightness: 95 } }),
    { image: null, css: wallpaper, blur: 12, saturation: 80, brightness: 95 },
  );
  const colored = glassInputs({ css: glass.css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, backgroundColor: "#123456" } });
  assert.equal(colored?.css, "radial-gradient(ellipse at 85% 10%,#ffffff16,transparent 65%),#123456");
  assert.equal(glassInputs({ css: ":root{--glass-blur:20px;--vestra-wallpaper:url(https://example.com/a.png)}", customization: undefined }), null, "remote images cannot be drawn from CSS");
  assert.equal(glassInputs({ css: ":root{--vestra-wallpaper:linear-gradient(red,blue)}", customization: undefined }), null, "themes opt in by declaring their glass blur");
  assert.ok(glass.css.includes("--vestra-glass-preview-filter:blur(26px) saturate(125%);"), "previews blur the shipped theme too");
  assert.ok(
    customizedThemeCss({ css: glass.css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, blur: 12 } }).includes("--vestra-glass-preview-filter:blur(12px);"),
    "previews blur whenever the app does",
  );
});

test("panes nested in panes tint over their parent instead of repainting the image", () => {
  const glass = THEME_LIBRARY.find((theme) => theme.name === "Vestra Liquid Glass")!;
  for (const css of [glass.css, customizedThemeCss({ css: glass.css, customization: DEFAULT_THEME_CUSTOMIZATION })])
    assert.ok(
      cssRules(css).some((rule) => rule.selector.includes('[class*="channelTextArea_"]') && rule.selector.endsWith(">*") && rule.body.includes("--vestra-glass-image:none")),
      "pane children reset the image variable",
    );
});

test("Liquid Glass 2.3.0 has no live backdrop blur on large panes", () => {
  const glass = THEME_LIBRARY.find((theme) => theme.name === "Vestra Liquid Glass")!;
  assert.match(glass.css, /@version 2\.3\.0/);
  const rules = cssRules(glass.css);
  for (const rule of rules.filter((rule) => LARGE_PANES.test(rule.selector)))
    assert.ok(!rule.body.includes("backdrop-filter"), `no backdrop blur on ${rule.selector}`);
  assert.ok(
    rules.some((rule) => /menu_/.test(rule.selector) && rule.body.includes("backdrop-filter")),
    "menus keep their blur",
  );
});

test("appearance previews show the glass blur with a preview-only backdrop filter", () => {
  const css = "/** @name Plain */\n:root{--background-primary:#102030}";
  const image = "data:image/png;base64,aGVsbG8=";
  const withImage = customizedThemeCss({ css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, blur: 14, backgroundImage: image } });
  assert.ok(withImage.includes("--vestra-glass-preview-filter:blur(14px);"));
  const tintOnly = customizedThemeCss({ css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, blur: 14 } });
  assert.ok(tintOnly.includes("--vestra-glass-preview-filter:none;"), "no image: tints only, like the live app");
  assert.ok(themePreviewDocument(withImage).includes("backdrop-filter:var(--vestra-glass-preview-filter,none)"));
});

test("a customized theme's own live pane blur is switched off, as the generator owned it before", () => {
  // An edited copy of 2.2.0 is not migrated and still blurs its panes itself.
  const edited = `${lastGlassCss}/* my edits */`;
  const output = customizedThemeCss({ css: edited, customization: { ...DEFAULT_THEME_CUSTOMIZATION, backgroundImage: "data:image/png;base64,aGVsbG8=" } });
  const rules = cssRules(output);
  const generated = [...rules].reverse().find((rule) => rule.selector.includes('[class*="channelTextArea_"]') && !rule.selector.endsWith(">*") && rule.body.includes("--vestra-glass-image"));
  assert.ok(generated?.body.includes("backdrop-filter:var(--vestra-glass-pane-filter,none)!important"), "the generated pane rule wins over the theme's backdrop blur");
  assert.ok(themePreviewDocument(output).includes("#app-mount{--vestra-glass-pane-filter:var(--vestra-glass-preview-filter,none)}"), "only previews turn the pane blur back on");
});

test("pane classes inside popouts and dialogs do not paint the wallpaper image", () => {
  const glass = THEME_LIBRARY.find((theme) => theme.name === "Vestra Liquid Glass")!;
  for (const css of [glass.css, customizedThemeCss({ css: glass.css, customization: DEFAULT_THEME_CUSTOMIZATION })]) {
    const guard = cssRules(css).find((rule) => rule.body.includes("--vestra-glass-image:none") && rule.selector.includes('[role="dialog"]'));
    assert.ok(guard, "dialogs reset the image variable");
    for (const surface of ["userPopout_", "menu_", "autocomplete_", "settingsLayer_"])
      assert.ok(guard.selector.includes(surface), `${surface} resets the image variable`);
  }
});

test("the Home panel also drops a theme's live blur and keeps nested panes tinted", () => {
  const glass = THEME_LIBRARY.find((theme) => theme.name === "Vestra Liquid Glass")!;
  const rules = cssRules(customizedThemeCss({ css: glass.css, customization: DEFAULT_THEME_CUSTOMIZATION }));
  const home = '[class*="container_"]:has(>[class*="tabBody_"])';
  assert.ok(
    rules.some((rule) => rule.selector.includes(home) && rule.body.includes("backdrop-filter:var(--vestra-glass-pane-filter,none)!important")),
    "the generated pane-filter override covers Home",
  );
  assert.ok(
    rules.some((rule) => rule.selector.includes(home) && rule.selector.endsWith(">*") && rule.body.includes("--vestra-glass-image:none") && !rule.selector.includes("#app-mount :is([role")),
    "Home children reset the image variable in the generated CSS",
  );
});

test("preview frames give theme pane blur rules precedence over their own", () => {
  const preview = themePreviewDocument(":root{}");
  assert.ok(preview.includes(":where(#app-mount :is("), "the preview pane rule has zero specificity");
});

test("memo snapshots do not deep-copy the embedded image", () => {
  const original = globalThis.structuredClone;
  let cloned = 0;
  globalThis.structuredClone = ((value: unknown) => {
    cloned++;
    return original(value);
  }) as typeof structuredClone;
  try {
    let runs = 0;
    const generate = memoizeThemeCss(() => String(++runs));
    const customization = { ...DEFAULT_THEME_CUSTOMIZATION, backgroundImage: "data:image/png;base64," + "A".repeat(4096) };
    generate({ css: ":root{}", customization });
    generate({ css: ":root{}", customization: { ...customization } });
    assert.equal(runs, 1);
    assert.equal(cloned, 0, "primitive fields are copied by reference");
  } finally {
    globalThis.structuredClone = original;
  }
});

test("Liquid Glass 2.3.0 falls back to one fixed blurred layer when the image cannot be used", () => {
  const glass = THEME_LIBRARY.find((theme) => theme.name === "Vestra Liquid Glass")!;
  const rules = cssRules(glass.css);
  const layer = rules.find((rule) => rule.selector.startsWith(':root[data-vestra-glass="layer"] #app-mount::before'));
  assert.ok(layer, "the theme has a layer-mode rule");
  for (const part of ["position:fixed", "z-index:-1", "filter:blur(26px) saturate(125%)", "background:var(--vestra-custom-wallpaper,var(--vestra-wallpaper))"])
    assert.ok(layer.body.includes(part), `layer rule has ${part}`);
  assert.ok(
    rules.some((rule) => rule.selector === ':root[data-vestra-glass="layer"] #app-mount' && rule.body.includes("isolation:isolate")),
    "the layer stays behind the app's content",
  );
  // Customized: the generator's own layer rule follows and sets its own blur.
  const customized = customizedThemeCss({ css: glass.css, customization: { ...DEFAULT_THEME_CUSTOMIZATION, blur: 12, saturation: 80, brightness: 95 } });
  assert.ok(customized.lastIndexOf("filter:blur(12px) saturate(80%) brightness(95%)") > customized.indexOf("filter:blur(26px) saturate(125%)"));
});

test("a customized theme's own image wallpaper is drawn as an image or blurred as a layer, never tinted", () => {
  const custom = { ...DEFAULT_THEME_CUSTOMIZATION, blur: 18 };
  const inputsFor = (css: string) => glassInputs({ css, customization: custom });
  const data = "data:image/png;base64,QQ==";
  assert.deepEqual(
    inputsFor(`#app-mount{background:url("${data}") center/cover no-repeat,#101010!important;}`),
    { image: data, css: null, blur: 18, saturation: 125, brightness: 100 },
    "an #app-mount data: image (with ';' inside the URL) is drawn",
  );
  assert.equal(inputsFor(`:root{--vestra-wallpaper:url(${data}) center/cover}`)?.image, data, "--vestra-wallpaper data: image");
  assert.equal(
    inputsFor(":root{--vestra-wallpaper:url('https://example.com/a.png') center / cover fixed!important}")?.image,
    "https://example.com/a.png",
    "an https image is tried; the renderer falls back to the layer without CORS",
  );
  for (const [css, label] of [
    [":root{--vestra-wallpaper:var(--my-wallpaper)}", "an unresolvable var() chain"],
    [`:root{--vestra-wallpaper:linear-gradient(#0008,#0008),url(${data}) center/cover}`, "a gradient over an image"],
    [":root{--vestra-wallpaper:url(http://example.com/a.png) center/cover}", "an http image"],
    [":root{--vestra-wallpaper:url(wall.png) center/cover}", "a relative image"],
    [`:root{--vestra-wallpaper:url(${data}) top left repeat}`, "a tiled image the renderer cannot reproduce"],
  ] as const) {
    const inputs = inputsFor(css);
    assert.equal(inputs?.forceLayer, true, label);
    assert.equal(inputs?.image, null, label);
    assert.equal(inputs?.css, null, label);
  }
  assert.equal(inputsFor("#app-mount{background:#202020!important;}")?.forceLayer, undefined, "a flat colour still uses tints");
  assert.ok(
    customizedThemeCss({ css: `:root{--vestra-wallpaper:url(${data}) center/cover}`, customization: custom }).includes(
      "--vestra-glass-preview-filter:blur(18px);",
    ),
    "previews blur an image wallpaper like the app",
  );
  assert.ok(
    customizedThemeCss({ css: ":root{--vestra-wallpaper:var(--my-wallpaper)}", customization: custom }).includes(
      "--vestra-glass-preview-filter:blur(18px);",
    ),
    "previews blur an undrawable wallpaper like the app's layer",
  );
});
