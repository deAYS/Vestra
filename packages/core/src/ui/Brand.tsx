import { VESTRA_MARK_PATH } from "@vestra/shared";

export function BrandMark({ size = 32, className }: { size?: number; className?: string }): JSX.Element {
  return <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d={VESTRA_MARK_PATH} fillRule="evenodd" /></svg>;
}

export function Icon({ name, size = 18 }: { name: "home" | "plugins" | "themes" | "code" | "info" | "arrow" | "close" | "check" | "search" | "upload" | "settings"; size?: number }): JSX.Element {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-8h6v8"/></>,
    plugins: <><path d="M14 4h6v6h-3a3 3 0 1 0 0 6h3v5h-6v-3a3 3 0 1 0-6 0v3H3v-6h3a3 3 0 1 0 0-6H3V4h5V2a3 3 0 0 1 6 0Z"/></>,
    themes: <><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 16 16 8M8 8h.01M16 16h.01"/></>,
    code: <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
