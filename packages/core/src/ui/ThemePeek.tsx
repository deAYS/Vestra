import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const activePreviews = new WeakMap<Document, () => void>();

export function themePeekPosition(anchor: { left: number; top: number; bottom: number; width: number }, bounds: { width: number; height: number }): { left: number; top: number; width: number; height: number } {
  const margin = 12, gap = 10;
  const width = Math.min(540, Math.max(0, bounds.width - margin * 2));
  const height = Math.min(326, Math.max(0, bounds.height - margin * 2));
  const below = bounds.height - margin - anchor.bottom;
  const above = anchor.top - margin;
  const top = below >= height + gap || below >= above ? anchor.bottom + gap : anchor.top - height - gap;
  return {
    left: Math.max(margin, Math.min(anchor.left + anchor.width / 2 - width / 2, bounds.width - width - margin)),
    top: Math.max(margin, Math.min(top, bounds.height - height - margin)),
    width, height,
  };
}

/** Imported CSS stays inside a scriptless frame with network access blocked. */
export function themePreviewDocument(css: string): string {
  const safeCss = css.replaceAll("<", "\\3c ");
  return `<!doctype html><html class="theme-dark"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'"><style>
*{box-sizing:border-box}body{margin:0;overflow:hidden;font:13px system-ui;color:var(--text-normal,#e3dfea)}#app-mount{height:100vh;display:flex;background:var(--background-tertiary,#090b11)}.guilds_preview{width:42px;padding:14px 8px;display:grid;align-content:start;gap:12px}.guilds_preview i{height:25px;border-radius:9px;background:var(--brand-500,#ad9ae0)}.guilds_preview i+ i{background:#ffffff15}.sidebarList_preview{width:125px;padding:18px 10px;background:var(--background-secondary,#10141f)}h4{margin:0 0 25px;font-size:11px}.channel{font-size:10px;padding:9px 6px;color:var(--channels-default,#aaa)}.modeSelected_preview .link_preview{display:block;padding:8px 6px;border-radius:6px;background:var(--background-modifier-selected,#ffffff12);color:var(--text-link,#c5baf8);font-size:10px}.chat_preview{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--background-primary,#141a26)}.subtitleContainer_preview section{height:42px;padding:13px;border-bottom:1px solid var(--border-subtle,#ffffff12);font-size:11px}.chatContent_preview{flex:1;min-height:0;overflow:hidden;padding:18px 14px;background:var(--background-primary,#141a26)}article{display:flex;gap:8px;margin-bottom:18px}b.avatar{width:24px;height:24px;display:grid;place-items:center;border-radius:8px;background:var(--brand-500,#9f8bc9);color:var(--background-tertiary,#100c19);font-size:10px;flex:none}strong{font-size:10px;color:var(--text-link,#c5baf8)}p{font-size:10px;line-height:1.7;margin:4px 0}small{color:var(--text-muted,#999);font-size:8px;margin-left:5px}.composer{flex-shrink:0;padding:0 12px 12px}.channelTextArea_preview{border-radius:8px;padding:11px;background:var(--channeltextarea-background,#222b3d);color:var(--text-muted,#aaa);font-size:9px}.membersWrap_preview{width:90px;background:var(--background-secondary,#10141f)}.members_preview{height:100%;padding:18px 10px}.members_preview p{margin:16px 0;font-size:9px}.members_preview h4{font-size:8px;color:var(--text-muted,#999)}a{color:var(--text-link,#c5baf8)}@media(max-width:340px){.sidebarList_preview{display:none}}@media(max-width:420px){.membersWrap_preview{display:none}.sidebarList_preview{width:100px}}
</style><style data-vestra-preview-theme>${safeCss}</style></head><body><div id="app-mount"><nav class="guilds_preview"><i></i><i></i><i></i><i></i></nav><aside class="sidebarList_preview"><h4>Vestra studio</h4><div class="modeSelected_preview"><span class="link_preview"># after-hours</span></div><div class="channel"># inspiration</div><div class="channel"># releases</div></aside><main class="chat_preview"><div class="subtitleContainer_preview"><section># after-hours</section></div><div class="chatContent_preview"><article><b class="avatar">m</b><div><strong>mira</strong><small>23:41</small><p>A familiar place.<br>A different atmosphere.</p></div></article><article><b class="avatar">u</b><div><strong>uzu</strong><small>23:42</small><p>Your Discord. Your rules.<br><a>Made a little more you.</a></p></div></article></div><div class="composer"><div class="channelTextArea_preview">＋ &nbsp; Message #after-hours</div></div></main><aside class="membersWrap_preview"><div class="members_preview"><h4>IN ORBIT — 3</h4><p>● mira</p><p>● uzu</p><p>● nova</p></div></aside></div></body></html>`;
}

export function ThemePeek({ name, css }: { name: string; css: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof themePeekPosition>>();
  const id = useId();
  const document = useMemo(() => open ? themePreviewDocument(css) : "", [open, css]);
  const root = button.current?.closest<HTMLElement>(".vs-settings-root");
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const element = button.current;
    const ownerDocument = element.ownerDocument;
    activePreviews.get(ownerDocument)?.();
    const close = (): void => setOpen(false);
    activePreviews.set(ownerDocument, close);
    const container = element.closest<HTMLElement>(".vs-settings-root");
    const update = (): void => {
      const anchor = element.getBoundingClientRect();
      const area = container?.getBoundingClientRect();
      const width = container?.clientWidth || window.innerWidth;
      const height = container?.clientHeight || window.innerHeight;
      const scaleX = area?.width && container?.clientWidth ? area.width / container.clientWidth : 1;
      const scaleY = area?.height && container?.clientHeight ? area.height / container.clientHeight : 1;
      setPosition(themePeekPosition({
        left: (anchor.left - (area?.left ?? 0)) / scaleX,
        top: (anchor.top - (area?.top ?? 0)) / scaleY,
        bottom: (anchor.bottom - (area?.top ?? 0)) / scaleY,
        width: anchor.width / scaleX,
      }, { width, height }));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined;
    if (container) observer?.observe(container);
    return () => {
      if (activePreviews.get(ownerDocument) === close) activePreviews.delete(ownerDocument);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [open]);
  return <span className="vs-theme-peek" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button ref={button} type="button" aria-label={`Preview ${name}`} aria-expanded={open} aria-controls={open ? id : undefined}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}>Preview ↗</button>
    {open && position && createPortal(<div id={id} className="vs-theme-peek-panel" role="tooltip" style={{ ...position, position: root ? "absolute" : "fixed" }}>
      <div><strong>{name}</strong><span>Sample preview · selection unchanged</span></div>
      <iframe title={`${name} preview`} sandbox="" referrerPolicy="no-referrer" srcDoc={document} tabIndex={-1} />
    </div>, root ?? button.current!.ownerDocument.body)}
  </span>;
}
