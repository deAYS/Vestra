export function ProgressPanel({ text }: { text: string }): JSX.Element {
  return (
    <div className="vs-progress" data-testid="progress-panel" role="status">
      <span className="vs-spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
