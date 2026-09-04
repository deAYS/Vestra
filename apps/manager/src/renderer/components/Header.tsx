// Vestra Manager — header with brand + refresh.

interface Props {
  refreshing: boolean;
  onRefresh(): void;
}

export function Header({ refreshing, onRefresh }: Props): JSX.Element {
  return (
    <header className="vs-header">
      <div>
        <h1 className="vs-title">VESTRA</h1>
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
