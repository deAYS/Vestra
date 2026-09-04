// Vestra Manager — status badge. Shallow "installed" never renders Healthy.

import type { CardState } from "../../shared/statusModel.js";

const LABELS: Record<CardState, string> = {
  "not-installed": "Vestra Not installed",
  "installed-checking": "Vestra Installed — Checking integrity...",
  healthy: "Vestra Healthy",
  "needs-repair": "Vestra Needs Repair",
  "check-failed": "Vestra Check failed",
};

export function StatusBadge({ state }: { state: CardState }): JSX.Element {
  return (
    <div className={`vs-badge vs-badge--${state}`} data-testid={`status-${state}`}>
      {state === "healthy" ? "✓ " : state === "needs-repair" ? "⚠ " : ""}
      {LABELS[state]}
    </div>
  );
}
