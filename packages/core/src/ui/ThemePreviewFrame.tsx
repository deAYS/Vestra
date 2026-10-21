import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { themePreviewDocument } from "./ThemePeek.js";

/** No scripts run in this frame; only its theme style is replaced between paints. */
export function ThemePreviewFrame({
  title,
  css,
}: {
  title: string;
  css: string;
}): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(css);
  const imageCount = useRef(0);
  latest.current = css;
  const source = useMemo(() => themePreviewDocument(""), []);
  const apply = useCallback(() => {
    const doc = frame.current?.contentDocument;
    const style = doc?.querySelector<HTMLStyleElement>(
      "[data-vestra-preview-theme]",
    );
    if (!style || !doc) return;
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
  }, [css, apply]);
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
