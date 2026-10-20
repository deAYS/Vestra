import { VESTRA_MARK_PATH } from "@vestra/shared";

interface Props {
  refreshing: boolean;
  onRefresh(): void;
}

export function Header({ refreshing, onRefresh }: Props): JSX.Element {
  return (
    <header className="vs-header">
      <div>
        <h1 className="vs-title" style={{display:"flex",alignItems:"center",gap:10,letterSpacing:"-.04em"}}><svg width="38" height="38" viewBox="0 0 64 64" aria-hidden="true"><path d={VESTRA_MARK_PATH} fill="#C5BAF8" fillRule="evenodd"/></svg>vestra</h1>
        <p className="vs-subtitle">Your Discord. Your rules.</p>
      </div>
      <button
        type="button"
        className="vs-btn vs-btn--secondary"
        onClick={onRefresh}
        disabled={refreshing}
        data-testid="refresh-button"
      >
        {refreshing ? "Refreshing..." : "Refresh"}
      </button>
    </header>
  );
}
