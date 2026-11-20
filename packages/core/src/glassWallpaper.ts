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
 * Modes, on `<html data-vestra-glass>`:
 * - `image`: the blurred image is in `--vestra-glass-image`;
 * - `layer`: the wallpaper cannot be read into a canvas (cross-origin without
 *   CORS, decode error); CSS blurs the one fixed wallpaper layer instead;
 * - `tint`: no wallpaper image (or no blur); panes use their tints only.
 */

export interface GlassInputs {
  image: string | null;
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

function sameInputs(a: GlassInputs | undefined, b: GlassInputs): boolean {
  return (
    !!a &&
    a.image === b.image &&
    a.blur === b.blur &&
    a.saturation === b.saturation &&
    a.brightness === b.brightness
  );
}

export function createGlassRenderer(deps: {
  document: Document;
  window: Window;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  loadImage?: (src: string) => Promise<HTMLImageElement>;
}): GlassRenderer {
  const { document: doc, window: win } = deps;
  const root = doc.documentElement;
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

  let current: GlassInputs | undefined;
  /** Bumped by every update/stop; a render applies only if still current. */
  let generation = 0;
  let decoded: { src: string; image: Promise<HTMLImageElement> } | undefined;
  let rendered: { width: number; height: number } | undefined;
  let resizeTimer: number | undefined;
  let listening = false;

  const setMode = (mode: GlassMode | null): void => {
    if (mode === null) root.removeAttribute(GLASS_MODE_ATTRIBUTE);
    else if (root.getAttribute(GLASS_MODE_ATTRIBUTE) !== mode)
      root.setAttribute(GLASS_MODE_ATTRIBUTE, mode);
  };
  const clearImage = (): void => {
    root.style.removeProperty(GLASS_IMAGE_VARIABLE);
    rendered = undefined;
  };
  const cancelResize = (): void => {
    if (resizeTimer !== undefined) win.clearTimeout(resizeTimer);
    resizeTimer = undefined;
  };
  const onResize = (): void => {
    cancelResize();
    resizeTimer = win.setTimeout(() => {
      resizeTimer = undefined;
      const size = viewport();
      if (
        current?.image &&
        (size.width !== rendered?.width || size.height !== rendered?.height)
      )
        void render(current, ++generation);
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
  /** Window size in canvas pixels: device pixel ratio capped at 1. */
  const viewport = (): { width: number; height: number; scale: number } => {
    const scale = Math.min(1, win.devicePixelRatio || 1);
    return {
      width: Math.max(1, Math.round(win.innerWidth * scale)),
      height: Math.max(1, Math.round(win.innerHeight * scale)),
      scale,
    };
  };
  const decode = (src: string): Promise<HTMLImageElement> => {
    if (decoded?.src !== src) decoded = { src, image: loadImage(src) };
    return decoded.image;
  };

  /**
   * Draw the image like CSS `center/cover` over the window, blur it from a
   * copy padded with its edge pixels (so the edges do not fade out), and
   * export a data URL (Discord's CSP allows data: images).
   */
  const draw = (
    image: HTMLImageElement,
    inputs: GlassInputs,
    size: { width: number; height: number; scale: number },
  ): string | null => {
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
    const webp = output.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp")
      ? webp
      : output.toDataURL("image/jpeg", 0.85);
  };

  const render = async (inputs: GlassInputs, run: number): Promise<void> => {
    let url: string | null = null;
    const size = viewport();
    try {
      const image = await decode(inputs.image!);
      if (run !== generation) return;
      url = draw(image, inputs, size);
    } catch {
      // Tainted canvas (SecurityError) or an image that failed to decode.
      url = null;
    }
    if (run !== generation) return;
    if (!url) {
      clearImage();
      setMode("layer");
      return;
    }
    root.style.setProperty(GLASS_IMAGE_VARIABLE, `url("${url}")`);
    rendered = { width: size.width, height: size.height };
    setMode("image");
  };

  return {
    update(inputs) {
      if (sameInputs(current, inputs)) return;
      current = { ...inputs };
      const run = ++generation;
      if (!inputs.image || !(inputs.blur > 0)) {
        listen(false);
        decoded = undefined;
        clearImage();
        setMode("tint");
        return;
      }
      listen(true);
      // The previous image stays until the new one is ready.
      void render(current, run);
    },
    stop() {
      generation++;
      current = undefined;
      decoded = undefined;
      listen(false);
      clearImage();
      setMode(null);
    },
  };
}
