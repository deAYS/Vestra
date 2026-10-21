import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  appearancePreviewDocument,
  type PreviewScene,
} from "./previewScenes.js";

/** No scripts run in this frame; only its theme style is replaced between paints. */
export function ThemePreviewFrame({
  title,
  css,
  scene = "chat",
}: {
  title: string;
  css: string;
  scene?: PreviewScene;
}): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(css);
  const latestScene = useRef(scene);
  const imageCount = useRef(0);
  latest.current = css;
  latestScene.current = scene;
  const source = useMemo(appearancePreviewDocument, []);
  const apply = useCallback(() => {
    const doc = frame.current?.contentDocument;
    const style = doc?.querySelector<HTMLStyleElement>(
      "[data-vestra-preview-theme]",
    );
    if (!style || !doc) return;
    doc.documentElement.dataset.previewScene = latestScene.current;
    const images: string[] = [];
    const next = latest.current.replace(
      /url\("(data:image\/[^\"]+)"\)/g,
      (value) => {
        let index = images.indexOf(value);
        if (index < 0) {
          index = images.length;
          images.push(value);
        }
        return `var(--vestra-preview-image-${index})`;
      },
    );
    images.forEach((value, index) => {
      const name = `--vestra-preview-image-${index}`;
      if (doc.documentElement.style.getPropertyValue(name) !== value)
        doc.documentElement.style.setProperty(name, value);
    });
    for (let index = images.length; index < imageCount.current; index++)
      doc.documentElement.style.removeProperty(
        `--vestra-preview-image-${index}`,
      );
    imageCount.current = images.length;
    if (style.textContent !== next) style.textContent = next;
  }, []);
  useLayoutEffect(() => {
    const owner = frame.current?.ownerDocument.defaultView;
    if (!owner) return;
    const pending = owner.requestAnimationFrame(apply);
    return () => owner.cancelAnimationFrame(pending);
  }, [css, scene, apply]);
  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={source}
      onLoad={apply}
      tabIndex={-1}
    />
  );
}
