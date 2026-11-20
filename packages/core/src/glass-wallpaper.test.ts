import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createGlassRenderer, type GlassInputs } from "./glassWallpaper.js";

const IMAGE = "data:image/png;base64,aGVsbG8=";
const inputs = (values: Partial<GlassInputs> = {}): GlassInputs => ({
  image: IMAGE,
  blur: 26,
  saturation: 140,
  brightness: 90,
  ...values,
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

interface FakeContext {
  filter: string;
  draws: unknown[][];
}

/**
 * A fake window (size, resize events, manual timers), a fake canvas that
 * records its filter and draws, and a fake image loader.
 */
function harness(options: { taint?: boolean; failLoad?: boolean } = {}) {
  const doc = new Window().document as unknown as Document;
  const listeners = new Set<() => void>();
  let clock = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 0;
  const win = {
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
  const canvases: Array<{ width: number; height: number; context: FakeContext }> = [];
  let encodes = 0;
  const loads: string[] = [];
  const pendingLoads: Array<() => void> = [];
  let holdLoads = false;
  const renderer = createGlassRenderer({
    document: doc,
    window: win as unknown as globalThis.Window,
    createCanvas(width, height) {
      const context: FakeContext = {
        filter: "none",
        draws: [],
      };
      const entry = { width, height, context };
      canvases.push(entry);
      return {
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
      } as unknown as HTMLCanvasElement;
    },
    loadImage(src) {
      loads.push(src);
      const image = { naturalWidth: 640, naturalHeight: 400 } as HTMLImageElement;
      if (options.failLoad) return Promise.reject(new Error("decode failed"));
      if (!holdLoads) return Promise.resolve(image);
      return new Promise((resolve) => pendingLoads.push(() => resolve(image)));
    },
  });
  const root = doc.documentElement;
  return {
    renderer,
    win,
    canvases,
    loads,
    encodes: () => encodes,
    holdLoads(value: boolean) {
      holdLoads = value;
    },
    releaseLoads() {
      for (const release of pendingLoads.splice(0)) release();
    },
    variable: () => root.style.getPropertyValue("--vestra-glass-image"),
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
  h.renderer.update(inputs());
  await settle();
  assert.equal(h.loads.length, 1);
  assert.equal(h.encodes(), 1, "one render");
  const [output] = outputs(h);
  assert.equal(output?.context.filter, "blur(26px) saturate(140%) brightness(90%)");
  assert.deepEqual([output?.width, output?.height], [1280, 800], "device pixel ratio is capped at 1");
  assert.match(h.variable(), /^url\("data:image\/(webp|jpeg);base64,R1"\)$/);
  assert.equal(h.mode(), "image");
  // The image is drawn centred and cropped like `center/cover`, then blurred
  // from a padded copy so the edges do not fade to transparent.
  const padded = h.canvases.find((canvas) => canvas.context.filter === "none")!;
  assert.ok(padded.width > 1280 && padded.height > 800, "blur source is padded");
  const [image, x, y, width, height] = padded.context.draws[0] as number[];
  assert.ok(image);
  const pad = (padded.width - 1280) / 2;
  assert.deepEqual([x! - pad, y! - pad, width, height], [0, 0, 1280, 800]);
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
  assert.deepEqual([latest.width, latest.height], [1080, 700]);
  assert.notEqual(h.variable(), first, "the old image is replaced");
  assert.match(h.variable(), /R2"\)$/);
});

test("a tainted canvas falls back to the blurred layer without throwing", async () => {
  const h = harness({ taint: true });
  assert.doesNotThrow(() => h.renderer.update(inputs({ image: "https://example.com/wall.png" })));
  await settle();
  assert.equal(h.mode(), "layer");
  assert.equal(h.variable(), "");
});

test("an image that cannot be decoded also falls back to the layer", async () => {
  const h = harness({ failLoad: true });
  h.renderer.update(inputs());
  await settle();
  assert.equal(h.mode(), "layer");
  assert.equal(h.variable(), "");
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
