/**
 * Pre-blurred wallpaper for glass panes.
 *
 * A `backdrop-filter` blur on Discord's large panes is recomputed on every
 * frame that changes beneath them. The wallpaper behind those panes is static,
 * so it is blurred once here (with the customization's saturation and
 * brightness baked in) and handed to CSS as `--vestra-glass-image`; the panes
 * paint it as a fixed background beneath their tint. The sharp wallpaper on
 * `#app-mount` still shows in the gaps between panes.
 *
 * The wallpaper is either an image (`image`) or, for themes whose wallpaper is
 * CSS (gradients, colours), that CSS background value (`css`), laid out at
 * the window size in an SVG image so viewport units resolve as on the page.
 *
 * Modes, on `<html data-vestra-glass>`:
 * - `image`: the blurred image is in `--vestra-glass-image`;
 * - `layer`: the wallpaper cannot be read into a canvas (cross-origin without
 *   CORS, decode error), or a pane has a transformed ancestor (a fixed
 *   background would then scroll with it); CSS blurs the one fixed wallpaper
 *   layer instead;
 * - `tint`: no wallpaper (or no blur); panes use their tints only.
 */

export interface GlassInputs {
  image: string | null;
  /** CSS background value of a wallpaper without an image (used when `image` is null). */
  css?: string | null;
  blur: number;
  saturation: number;
  brightness: number;
}

export interface GlassRenderer {
  update(inputs: GlassInputs): void;
  stop(): void;
}

export type GlassMode = "image" | "layer" | "tint";

export const GLASS_IMAGE_VARIABLE = "--vestra-glass-image";
export const GLASS_MODE_ATTRIBUTE = "data-vestra-glass";
const RESIZE_DEBOUNCE_MS = 250;
/** Blurs at least this strong render at half resolution; the loss is invisible. */
const HALF_RESOLUTION_BLUR = 8;
const STARTUP_IDLE_TIMEOUT_MS = 1000;
/** The pane checked for transformed ancestors: chat, else any large pane. */
const PANE_SELECTORS = [
  '#app-mount [class*="chat_"]',
  '#app-mount :is([class*="sidebarList_"],[class*="privateChannels_"],[class*="membersWrap_"],[class*="guilds_"],[class*="panels_"],[class*="channelTextArea_"])',
];

/** An SVG image of the CSS wallpaper at the given size (no scripts, no network). */
function cssWallpaperSource(css: string, width: number, height: number): string {
  const style = `width:${width}px;height:${height}px;background:${css}`
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="${style}"></div></foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** What to draw for these inputs at this window size, if anything. */
function wallpaperSource(inputs: GlassInputs, win: Window): string | null {
  if (!(inputs.blur > 0)) return null;
  if (inputs.image) return inputs.image;
  if (inputs.css)
    return cssWallpaperSource(
      inputs.css,
      Math.max(1, Math.round(win.innerWidth)),
      Math.max(1, Math.round(win.innerHeight)),
    );
  return null;
}

function sameInputs(a: GlassInputs | undefined, b: GlassInputs): boolean {
  return (
    !!a &&
    a.image === b.image &&
    (a.css ?? null) === (b.css ?? null) &&
    a.blur === b.blur &&
    a.saturation === b.saturation &&
    a.brightness === b.brightness
  );
}

interface Size {
  width: number;
  height: number;
  scale: number;
}

type IdleWindow = Window & {
  requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * `--vestra-glass-image` lives in one constructed stylesheet (`:root{}`)
 * adopted by the document, so Discord rewriting `<html>`'s inline style cannot
 * drop it. Without constructable stylesheets it falls back to the inline style.
 */
function imageVariable(doc: Document, win: Window) {
  const Sheet = (win as unknown as { CSSStyleSheet?: typeof CSSStyleSheet })
    .CSSStyleSheet;
  let sheet: CSSStyleSheet | undefined;
  let rule: CSSStyleRule | undefined;
  const adoptable = (): boolean =>
    typeof Sheet === "function" &&
    "adoptedStyleSheets" in doc &&
    typeof Sheet.prototype.replaceSync === "function";
  const target = (): CSSStyleDeclaration => {
    if (rule) return rule.style;
    if (adoptable()) {
      try {
        const created = new Sheet!();
        created.replaceSync(":root{}");
        const first = created.cssRules[0] as CSSStyleRule | undefined;
        if (first) {
          doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, created];
          sheet = created;
          rule = first;
          return first.style;
        }
      } catch {
        // Fall back to the inline style below.
      }
    }
    return doc.documentElement.style;
  };
  return {
    set(value: string): void {
      target().setProperty(GLASS_IMAGE_VARIABLE, value);
    },
    clear(): void {
      rule?.style.removeProperty(GLASS_IMAGE_VARIABLE);
      doc.documentElement.style.removeProperty(GLASS_IMAGE_VARIABLE);
    },
    remove(): void {
      this.clear();
      if (sheet)
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(
          (entry) => entry !== sheet,
        );
      sheet = undefined;
      rule = undefined;
    },
  };
}

export function createGlassRenderer(deps: {
  document: Document;
  window: Window;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  loadImage?: (src: string) => Promise<HTMLImageElement>;
  getComputedStyle?: (element: Element) => Pick<CSSStyleDeclaration, "transform" | "willChange">;
  log?: Pick<Console, "info" | "warn">;
}): GlassRenderer {
  const { document: doc } = deps;
  const win = deps.window as IdleWindow;
  const root = doc.documentElement;
  const log = deps.log ?? console;
  const computed =
    deps.getComputedStyle ?? ((element: Element) => win.getComputedStyle(element));
  const createCanvas =
    deps.createCanvas ??
    ((width: number, height: number): HTMLCanvasElement => {
      const canvas = doc.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    });
  const loadImage =
    deps.loadImage ??
    ((src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const image = doc.createElement("img");
        // HTTPS images that send CORS headers stay readable; others fail to
        // load and use the layer fallback.
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("The wallpaper could not be loaded."));
        image.src = src;
      }));
  const variable = imageVariable(doc, win);

  let current: GlassInputs | undefined;
  /** Bumped by every update/stop; a render applies only if still current. */
  let generation = 0;
  let decoded: { src: string; image: Promise<HTMLImageElement> } | undefined;
  /** The last rendered image for the current inputs, with its canvas size. */
  let rendered: (Size & { url: string }) | undefined;
  /** The current inputs could not be read into a canvas; only new inputs retry. */
  let failed = false;
  let warned = false;
  let startupPending = true;
  let idle: number | undefined;
  let resizeTimer: number | undefined;
  let listening = false;
  let loggedMode: GlassMode | null = null;

  const setMode = (mode: GlassMode | null, reason = ""): void => {
    if (mode === null) root.removeAttribute(GLASS_MODE_ATTRIBUTE);
    else if (root.getAttribute(GLASS_MODE_ATTRIBUTE) !== mode)
      root.setAttribute(GLASS_MODE_ATTRIBUTE, mode);
    if (mode !== null && mode !== loggedMode)
      log.info(`[Vestra] glass mode: ${mode} (${reason})`);
    loggedMode = mode;
  };
  const clearImage = (): void => {
    variable.clear();
    rendered = undefined;
  };
  /**
   * A fixed background behaves like `scroll` under a transformed ancestor, so
   * the blurred copy would no longer line up with the sharp wallpaper.
   */
  const transformedAncestor = (): boolean => {
    const pane =
      PANE_SELECTORS.map((selector) => doc.querySelector(selector)).find(
        (element) => element,
      ) ?? null;
    for (let node = pane?.parentElement; node; node = node.parentElement) {
      const style = computed(node);
      if (
        (style.transform && style.transform !== "none") ||
        (style.willChange ?? "").includes("transform")
      )
        return true;
    }
    return false;
  };
  /** Show the rendered image, unless a transformed ancestor rules it out. */
  const present = (): void => {
    if (!rendered) return;
    if (transformedAncestor()) {
      variable.clear();
      setMode("layer", "transformed-ancestor");
      return;
    }
    variable.set(`url("${rendered.url}")`);
    setMode("image", "rendered");
  };
  const cancelResize = (): void => {
    if (resizeTimer !== undefined) win.clearTimeout(resizeTimer);
    resizeTimer = undefined;
  };
  const onResize = (): void => {
    cancelResize();
    resizeTimer = win.setTimeout(() => {
      resizeTimer = undefined;
      if (!current || failed || !wallpaperSource(current, win)) return;
      const size = viewport(current);
      if (
        size.width !== rendered?.width ||
        size.height !== rendered?.height ||
        size.scale !== rendered?.scale
      )
        schedule(current, ++generation);
      else present();
    }, RESIZE_DEBOUNCE_MS);
  };
  const listen = (on: boolean): void => {
    if (on === listening) return;
    listening = on;
    if (on) win.addEventListener("resize", onResize);
    else {
      win.removeEventListener("resize", onResize);
      cancelResize();
    }
  };
  /**
   * Window size in canvas pixels: device pixel ratio capped at 1, and half
   * resolution for strong blurs (the blur radius scales with it).
   */
  const viewport = (inputs: GlassInputs): Size => {
    const scale =
      Math.min(1, win.devicePixelRatio || 1) *
      (inputs.blur >= HALF_RESOLUTION_BLUR ? 0.5 : 1);
    return {
      width: Math.max(1, Math.round(win.innerWidth * scale)),
      height: Math.max(1, Math.round(win.innerHeight * scale)),
      scale,
    };
  };
  /** The decoded image is reused for resizes; a failed load is not kept. */
  const decode = (src: string): Promise<HTMLImageElement> => {
    if (decoded?.src !== src) {
      const entry = { src, image: loadImage(src) };
      decoded = entry;
      entry.image.catch(() => {
        if (decoded === entry) decoded = undefined;
      });
    }
    return decoded.image;
  };

  /** Data URL of the canvas: webp when supported, else jpeg; async when possible. */
  const encode = async (canvas: HTMLCanvasElement): Promise<string> => {
    const Reader = (win as unknown as { FileReader?: typeof FileReader }).FileReader;
    if (typeof canvas.toBlob === "function" && typeof Reader === "function") {
      const blob = (type: string): Promise<Blob | null> =>
        new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
      let result = await blob("image/webp");
      if (!result || result.type !== "image/webp") result = await blob("image/jpeg");
      if (!result) throw new Error("The canvas could not be encoded.");
      const encoded = result;
      return new Promise((resolve, reject) => {
        const reader = new Reader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The canvas could not be read."));
        reader.readAsDataURL(encoded);
      });
    }
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp")
      ? webp
      : canvas.toDataURL("image/jpeg", 0.85);
  };

  /**
   * Draw the image like CSS `center/cover` over the window, blur it from a
   * copy padded with its edge pixels (so the edges do not fade out), and
   * export a data URL (Discord's CSP allows data: images).
   */
  const draw = (
    image: HTMLImageElement,
    inputs: GlassInputs,
    size: Size,
  ): HTMLCanvasElement | null => {
    const { width, height } = size;
    const blur = inputs.blur * size.scale;
    const pad = Math.ceil(blur * 3);
    const source = createCanvas(width + pad * 2, height + pad * 2);
    const sourceContext = source.getContext("2d");
    const output = createCanvas(width, height);
    const outputContext = output.getContext("2d");
    if (!sourceContext || !outputContext) return null;
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    if (!imageWidth || !imageHeight) return null;
    const cover = Math.max(width / imageWidth, height / imageHeight);
    const drawWidth = imageWidth * cover;
    const drawHeight = imageHeight * cover;
    sourceContext.drawImage(
      image,
      pad + (width - drawWidth) / 2,
      pad + (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    if (pad > 0) {
      const fullHeight = height + pad * 2;
      sourceContext.drawImage(source, pad, pad, width, 1, pad, 0, width, pad);
      sourceContext.drawImage(source, pad, pad + height - 1, width, 1, pad, pad + height, width, pad);
      sourceContext.drawImage(source, pad, 0, 1, fullHeight, 0, 0, pad, fullHeight);
      sourceContext.drawImage(source, pad + width - 1, 0, 1, fullHeight, pad + width, 0, pad, fullHeight);
    }
    outputContext.filter = `blur(${blur}px) saturate(${inputs.saturation}%) brightness(${inputs.brightness}%)`;
    outputContext.drawImage(source, -pad, -pad);
    return output;
  };

  const render = async (inputs: GlassInputs, run: number): Promise<void> => {
    let url: string | null = null;
    const size = viewport(inputs);
    try {
      const source = wallpaperSource(inputs, win);
      if (!source) throw new Error("No wallpaper to draw.");
      const image = await decode(source);
      if (run !== generation) return;
      const canvas = draw(image, inputs, size);
      url = canvas ? await encode(canvas) : null;
    } catch {
      // Tainted canvas (SecurityError) or an image that failed to decode.
      url = null;
    }
    if (run !== generation) return;
    if (!url) {
      failed = true;
      if (!warned) {
        warned = true;
        log.warn("[Vestra] glass wallpaper could not be read into a canvas; using the blurred layer instead");
      }
      clearImage();
      setMode("layer", "unreadable");
      return;
    }
    rendered = { ...size, url };
    present();
  };

  /** The first render after startup waits for an idle moment (at most ~1 s). */
  const schedule = (inputs: GlassInputs, run: number): void => {
    if (startupPending && typeof win.requestIdleCallback === "function") {
      startupPending = false;
      idle = win.requestIdleCallback(
        () => {
          idle = undefined;
          if (run === generation) void render(inputs, run);
        },
        { timeout: STARTUP_IDLE_TIMEOUT_MS },
      );
      return;
    }
    startupPending = false;
    void render(inputs, run);
  };
  const cancelIdle = (): void => {
    if (idle !== undefined) win.cancelIdleCallback?.(idle);
    idle = undefined;
  };

  return {
    update(inputs) {
      if (sameInputs(current, inputs)) return;
      current = { ...inputs };
      failed = false;
      const run = ++generation;
      cancelIdle();
      if (!wallpaperSource(inputs, win)) {
        listen(false);
        decoded = undefined;
        clearImage();
        setMode("tint", "no-wallpaper");
        return;
      }
      listen(true);
      // The previous image stays until the new one is ready.
      schedule(current, run);
    },
    stop() {
      generation++;
      cancelIdle();
      current = undefined;
      decoded = undefined;
      failed = false;
      listen(false);
      variable.remove();
      rendered = undefined;
      setMode(null);
    },
  };
}
