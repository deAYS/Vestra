import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createGlassRenderer, type GlassInputs } from "./glassWallpaper.js";

const IMAGE = "data:image/png;base64,aGVsbG8=";
const VARIABLE = "--vestra-glass-image";
const inputs = (values: Partial<GlassInputs> = {}): GlassInputs => ({
  image: IMAGE,
  blur: 26,
  saturation: 140,
  brightness: 90,
  ...values,
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

interface FakeContext {
  filter: string;
  draws: unknown[][];
}

interface HarnessOptions {
  taint?: boolean;
  failLoad?: boolean;
  /** Provide requestIdleCallback; callbacks run only when `idle()` is called. */
  idle?: boolean;
  /** Provide canvas.toBlob and FileReader (the async encode path). */
  blob?: boolean;
  /** No constructable stylesheets: the variable goes on <html>'s inline style. */
  inlineOnly?: boolean;
}

/**
 * A fake window (size, resize events, manual timers, optional idle callbacks),
 * a fake canvas that records its filter and draws, a fake image loader, a
 * fake getComputedStyle (transforms on demand) and a captured log.
 */
function harness(options: HarnessOptions = {}) {
  const hd = new Window();
  const doc = hd.document as unknown as Document;
  doc.body.innerHTML =
    '<div id="app-mount"><div class="layer_x" id="layer"><main class="chat_x" id="chat"></main></div></div>';
  const listeners = new Set<() => void>();
  let clock = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 0;
  const idleCallbacks: Array<() => void> = [];
  const idleTimeouts: number[] = [];
  let readerResults = 0;
  class FakeReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: { type: string }) {
      this.result = `data:${blob.type};base64,B${++readerResults}`;
      queueMicrotask(() => this.onload?.());
    }
  }
  const win: Record<string, unknown> & { innerWidth: number; innerHeight: number; devicePixelRatio: number } = {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 2,
    addEventListener(type: string, listener: () => void) {
      if (type === "resize") listeners.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === "resize") listeners.delete(listener);
    },
    setTimeout(run: () => void, ms: number) {
      timers.set(++nextTimer, { at: clock + ms, run });
      return nextTimer;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  };
  if (!options.inlineOnly) win.CSSStyleSheet = (hd as unknown as { CSSStyleSheet: unknown }).CSSStyleSheet;
  if (options.idle)
    win.requestIdleCallback = (run: () => void, opts: { timeout: number }) => {
      idleCallbacks.push(run);
      idleTimeouts.push(opts.timeout);
      return idleCallbacks.length;
    };
  if (options.blob) win.FileReader = FakeReader;
  const canvases: Array<{ width: number; height: number; context: FakeContext }> = [];
  let encodes = 0;
  const loads: string[] = [];
  const pendingLoads: Array<() => void> = [];
  let holdLoads = false;
  let failLoad = !!options.failLoad;
  const transformed = new Set<Element>();
  const lines: string[] = [];
  const warnings: string[] = [];
  const renderer = createGlassRenderer({
    document: doc,
    window: win as unknown as globalThis.Window,
    createCanvas(width, height) {
      const context: FakeContext = { filter: "none", draws: [] };
      canvases.push({ width, height, context });
      const canvas: Record<string, unknown> = {
        width,
        height,
        getContext: () => ({
          set filter(value: string) {
            context.filter = value;
          },
          get filter() {
            return context.filter;
          },
          drawImage: (...args: unknown[]) => context.draws.push(args),
        }),
        toDataURL(type: string) {
          if (options.taint)
            throw new DOMException("The canvas has been tainted", "SecurityError");
          encodes++;
          return `data:${type};base64,R${encodes}`;
        },
      };
      if (options.blob)
        canvas.toBlob = (done: (blob: { type: string }) => void, type: string) => {
          if (options.taint)
            throw new DOMException("The canvas has been tainted", "SecurityError");
          encodes++;
          queueMicrotask(() => done({ type }));
        };
      return canvas as unknown as HTMLCanvasElement;
    },
    loadImage(src) {
      loads.push(src);
      const image = { naturalWidth: 640, naturalHeight: 400 } as HTMLImageElement;
      if (failLoad) return Promise.reject(new Error("decode failed"));
      if (!holdLoads) return Promise.resolve(image);
      return new Promise((resolve) => pendingLoads.push(() => resolve(image)));
    },
    getComputedStyle: (element) =>
      ({
        transform: transformed.has(element) ? "matrix(1, 0, 0, 1, 0, 0)" : "none",
        willChange: "auto",
      }) as CSSStyleDeclaration,
    log: {
      info: (line: string) => lines.push(line),
      warn: (line: string) => warnings.push(line),
    },
  });
  const root = doc.documentElement;
  const sheetValue = (): string => {
    for (const sheet of doc.adoptedStyleSheets ?? [])
      for (const rule of [...sheet.cssRules]) {
        const value = (rule as CSSStyleRule).style?.getPropertyValue(VARIABLE);
        if (value) return value;
      }
    return "";
  };
  return {
    renderer,
    win,
    doc,
    canvases,
    loads,
    lines,
    warnings,
    idleTimeouts,
    encodes: () => encodes,
    holdLoads(value: boolean) {
      holdLoads = value;
    },
    failLoad(value: boolean) {
      failLoad = value;
    },
    releaseLoads() {
      for (const release of pendingLoads.splice(0)) release();
    },
    async idle() {
      for (const run of idleCallbacks.splice(0)) run();
      await settle();
    },
    transform(on: boolean) {
      const layer = doc.getElementById("layer")!;
      if (on) transformed.add(layer);
      else transformed.delete(layer);
    },
    /** The variable wherever it lives (adopted sheet, else inline). */
    variable: () => sheetValue() || root.style.getPropertyValue(VARIABLE),
    sheetValue,
    inlineValue: () => root.style.getPropertyValue(VARIABLE),
    sheets: () => (doc.adoptedStyleSheets ?? []).length,
    mode: () => root.getAttribute("data-vestra-glass"),
    listeners: () => listeners.size,
    resize(width: number, height: number) {
      win.innerWidth = width;
      win.innerHeight = height;
      for (const listener of [...listeners]) listener();
    },
    async advance(ms: number) {
      clock += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > clock) continue;
        timers.delete(id);
        timer.run();
      }
      await settle();
    },
  };
}

/** The final, filtered canvas of each render is the one whose filter was set. */
const outputs = (h: ReturnType<typeof harness>) =>
  h.canvases.filter((canvas) => canvas.context.filter !== "none");

test("an image renders once, blurred at window size, into the glass variable", async () => {
  const h = harness();
  h.renderer.update(inputs({ blur: 6 }));
  await settle();
  assert.equal(h.loads.length, 1);
  assert.equal(h.encodes(), 1, "one render");
  const [output] = outputs(h);
  assert.equal(output?.context.filter, "blur(6px) saturate(140%) brightness(90%)");
  assert.deepEqual([output?.width, output?.height], [1280, 800], "device pixel ratio is capped at 1");
  assert.match(h.variable(), /^url\("data:image\/(webp|jpeg);base64,R1"\)$/);
  assert.equal(h.mode(), "image");
  assert.deepEqual(h.lines, ["[Vestra] glass mode: image (rendered)"]);
  // The image is drawn centred and cropped like `center/cover`, then blurred
  // from a padded copy so the edges do not fade to transparent.
  const padded = h.canvases.find((canvas) => canvas.context.filter === "none")!;
  assert.ok(padded.width > 1280 && padded.height > 800, "blur source is padded");
  const [image, x, y, width, height] = padded.context.draws[0] as number[];
  assert.ok(image);
  const pad = (padded.width - 1280) / 2;
  assert.deepEqual([x! - pad, y! - pad, width, height], [0, 0, 1280, 800]);
});

test("strong blurs render at half resolution with the blur scaled to match", async () => {
  const h = harness();
  h.renderer.update(inputs({ blur: 8 }));
  await settle();
  let [output] = outputs(h);
  assert.deepEqual([output?.width, output?.height], [640, 400]);
  assert.equal(output?.context.filter, "blur(4px) saturate(140%) brightness(90%)");
  h.renderer.update(inputs({ blur: 7.5 }));
  await settle();
  output = outputs(h).at(-1);
  assert.deepEqual([output?.width, output?.height], [1280, 800], "weaker blurs keep full resolution");
  assert.equal(output?.context.filter, "blur(7.5px) saturate(140%) brightness(90%)");
});

test("the variable lives in an adopted stylesheet that stop removes", async () => {
  const h = harness();
  h.renderer.update(inputs());
  await settle();
  assert.match(h.sheetValue(), /^url\("data:image\//);
  assert.equal(h.inlineValue(), "", "<html>'s inline style is left alone");
  assert.equal(h.sheets(), 1);
  h.renderer.update(inputs({ saturation: 120 }));
  await settle();
  assert.equal(h.sheets(), 1, "updates reuse the one sheet");
  h.renderer.stop();
  assert.equal(h.sheets(), 0, "stop removes the sheet");
  assert.equal(h.variable(), "");
});

test("without constructable stylesheets the variable falls back to the inline style", async () => {
  const h = harness({ inlineOnly: true });
  h.renderer.update(inputs());
  await settle();
  assert.match(h.inlineValue(), /^url\("data:image\//);
  h.renderer.stop();
  assert.equal(h.inlineValue(), "");
});

test("identical inputs never re-render", async () => {
  const h = harness();
  h.renderer.update(inputs());
  await settle();
  h.renderer.update(inputs());
  h.renderer.update({ ...inputs() });
  await settle();
  assert.equal(h.encodes(), 1);
  assert.equal(h.loads.length, 1);
});

test("a burst of resizes re-renders once after it settles and replaces the old image", async () => {
  const h = harness();
  h.renderer.update(inputs());
  await settle();
  const first = h.variable();
  for (let i = 0; i < 5; i++) {
    h.resize(1000 + i * 20, 700);
    await h.advance(40);
  }
  assert.equal(h.encodes(), 1, "nothing renders while resizing");
  await h.advance(250);
  assert.equal(h.encodes(), 2, "one re-render after the burst");
  assert.equal(h.loads.length, 1, "the decoded image is reused");
  const latest = outputs(h).at(-1)!;
  assert.deepEqual([latest.width, latest.height], [540, 350]);
  assert.notEqual(h.variable(), first, "the old image is replaced");
  assert.match(h.variable(), /R2"\)$/);
});

test("a zoom or device pixel ratio change re-renders at the new scale", async () => {
  const h = harness();
  h.win.devicePixelRatio = 1;
  h.renderer.update(inputs());
  await settle();
  h.resize(1280, 800);
  await h.advance(250);
  assert.equal(h.encodes(), 1, "the same size and scale do not re-render");
  h.win.devicePixelRatio = 0.8;
  h.resize(1280, 800);
  await h.advance(250);
  assert.equal(h.encodes(), 2);
  const latest = outputs(h).at(-1)!;
  assert.deepEqual([latest.width, latest.height], [512, 320]);
});

test("a tainted canvas falls back to the blurred layer without throwing, and warns once", async () => {
  const h = harness({ taint: true });
  assert.doesNotThrow(() => h.renderer.update(inputs({ image: "https://example.com/wall.png" })));
  await settle();
  assert.equal(h.mode(), "layer");
  assert.equal(h.variable(), "");
  assert.deepEqual(h.lines, ["[Vestra] glass mode: layer (unreadable)"]);
  h.renderer.update(inputs({ image: "https://example.com/other.png" }));
  await settle();
  assert.equal(h.warnings.length, 1, "the first failure is logged once");
  assert.ok(!h.warnings[0]!.includes("example.com"), "no URL in the log");
  assert.equal(h.lines.length, 1, "no line without a mode change");
});

test("an image that cannot be decoded falls back to the layer and is not retried on resize", async () => {
  const h = harness({ failLoad: true });
  h.renderer.update(inputs());
  await settle();
  assert.equal(h.mode(), "layer");
  assert.equal(h.variable(), "");
  h.failLoad(false);
  h.resize(1000, 700);
  await h.advance(250);
  assert.equal(h.loads.length, 1, "resizes do not retry a failed source");
  h.renderer.update(inputs({ saturation: 100 }));
  await settle();
  assert.equal(h.loads.length, 2, "changed inputs retry");
  assert.equal(h.mode(), "image");
});

test("a transformed pane ancestor uses the layer instead of the image", async () => {
  const h = harness();
  h.transform(true);
  h.renderer.update(inputs());
  await settle();
  assert.equal(h.mode(), "layer");
  assert.equal(h.variable(), "");
  assert.deepEqual(h.lines, ["[Vestra] glass mode: layer (transformed-ancestor)"]);
  h.transform(false);
  h.resize(1280, 800);
  await h.advance(250);
  assert.equal(h.mode(), "image", "checked again after a resize");
  assert.equal(h.encodes(), 1, "the rendered image is reused");
  assert.match(h.variable(), /R1"\)$/);
  h.transform(true);
  h.resize(1280, 800);
  await h.advance(250);
  assert.equal(h.mode(), "layer");
  assert.deepEqual(h.lines, [
    "[Vestra] glass mode: layer (transformed-ancestor)",
    "[Vestra] glass mode: image (rendered)",
    "[Vestra] glass mode: layer (transformed-ancestor)",
  ]);
});

test("will-change: transform on an ancestor counts as transformed", async () => {
  const hd = new Window();
  const doc = hd.document as unknown as Document;
  doc.body.innerHTML = '<div id="app-mount"><div id="wrap"><aside class="sidebarList_x"></aside></div></div>';
  const lines: string[] = [];
  const renderer = createGlassRenderer({
    document: doc,
    window: { innerWidth: 100, innerHeight: 100, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {} } as unknown as globalThis.Window,
    createCanvas: (width, height) => ({ width, height, getContext: () => ({ filter: "none", drawImage() {} }), toDataURL: (type: string) => `data:${type};base64,AA` }) as unknown as HTMLCanvasElement,
    loadImage: async () => ({ naturalWidth: 10, naturalHeight: 10 }) as HTMLImageElement,
    getComputedStyle: (element) => ({ transform: "none", willChange: element.id === "wrap" ? "opacity, transform" : "auto" }) as CSSStyleDeclaration,
    log: { info: (line: string) => lines.push(line), warn() {} },
  });
  renderer.update(inputs());
  await settle();
  assert.deepEqual(lines, ["[Vestra] glass mode: layer (transformed-ancestor)"], "falls back to the first large pane");
});

test("without an image, or without blur, panes use tints only", async () => {
  const h = harness();
  h.renderer.update(inputs());
  await settle();
  h.renderer.update(inputs({ image: null }));
  await settle();
  assert.equal(h.mode(), "tint");
  assert.equal(h.variable(), "", "the old image is cleared");
  assert.equal(h.listeners(), 0, "tints do not follow window size");
  h.renderer.update(inputs({ blur: 0 }));
  await settle();
  assert.equal(h.mode(), "tint", "an unblurred image is the wallpaper itself");
  assert.equal(h.encodes(), 1);
  assert.deepEqual(h.lines, ["[Vestra] glass mode: image (rendered)", "[Vestra] glass mode: tint (no-wallpaper)"]);
});

test("stop clears the variable and mode and ends resize work", async () => {
  const h = harness();
  h.renderer.update(inputs());
  await settle();
  h.renderer.stop();
  assert.equal(h.variable(), "");
  assert.equal(h.mode(), null);
  assert.equal(h.listeners(), 0);
  h.resize(900, 600);
  await h.advance(500);
  assert.equal(h.encodes(), 1);
});

test("a newer update wins over a slower earlier render, and stop cancels a pending one", async () => {
  const h = harness();
  h.holdLoads(true);
  h.renderer.update(inputs({ image: "data:image/png;base64,QQ==" }));
  h.renderer.update(inputs({ image: "data:image/png;base64,Qg==" }));
  h.releaseLoads();
  await settle();
  assert.equal(h.encodes(), 1, "the stale render is discarded");
  assert.match(h.variable(), /R1"\)$/);
  h.renderer.update(inputs({ image: "data:image/png;base64,Qw==" }));
  assert.match(h.variable(), /R1"\)$/, "the previous image stays until the new one is ready");
  assert.equal(h.mode(), "image");
  h.renderer.stop();
  h.releaseLoads();
  await settle();
  assert.equal(h.variable(), "", "a render finishing after stop sets nothing");
  assert.equal(h.mode(), null);
});

test("the first render waits for an idle moment; later ones do not", async () => {
  const h = harness({ idle: true });
  h.renderer.update(inputs());
  await settle();
  assert.equal(h.loads.length, 0, "startup render is deferred");
  assert.deepEqual(h.idleTimeouts, [1000]);
  await h.idle();
  assert.equal(h.mode(), "image");
  h.renderer.update(inputs({ saturation: 100 }));
  await settle();
  assert.equal(h.encodes(), 2, "later renders start right away");
  assert.equal(h.idleTimeouts.length, 1);
});

test("canvas output is encoded asynchronously through toBlob when available", async () => {
  const h = harness({ blob: true });
  h.renderer.update(inputs());
  await settle();
  assert.equal(h.variable(), 'url("data:image/webp;base64,B1")');
  assert.equal(h.mode(), "image");
});

test("a CSS wallpaper is rasterized at window size and blurred like an image", async () => {
  const h = harness();
  const css = 'radial-gradient(ellipse 58vw 83vh at 70% 25%,transparent 56%,#fbe9da65 57%),linear-gradient(125deg,#211e2e 2%,#292f37 100%)';
  h.renderer.update(inputs({ image: null, css, blur: 26, saturation: 125, brightness: 100 }));
  await settle();
  assert.equal(h.loads.length, 1);
  const svg = decodeURIComponent(h.loads[0]!.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
  assert.ok(h.loads[0]!.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.ok(svg.includes('width="1280" height="800"'), "the wallpaper is laid out at the window size");
  assert.ok(svg.includes(`background:${css}`), "the theme's wallpaper is painted as-is");
  assert.equal(outputs(h)[0]?.context.filter, "blur(13px) saturate(125%) brightness(100%)");
  assert.equal(h.mode(), "image");
  h.resize(1000, 700);
  await h.advance(250);
  assert.equal(h.loads.length, 2, "viewport units follow the new window size");
  assert.ok(decodeURIComponent(h.loads[1]!).includes('width="1000" height="700"'));
});

test("CSS wallpaper text cannot break out of the SVG markup", async () => {
  const h = harness();
  h.renderer.update(inputs({ image: null, css: 'linear-gradient(red,blue)"/><script>alert(1)</script><x a="&' }));
  await settle();
  const svg = decodeURIComponent(h.loads[0]!.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
  assert.ok(!svg.includes("<script"), "markup is escaped");
  assert.ok(svg.includes("&quot;/&gt;&lt;script&gt;"));
});
