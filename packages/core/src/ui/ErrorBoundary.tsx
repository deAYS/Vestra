// @vestra/core UI — error boundaries.
// Phase 5. A throwing plugin row must never take down the whole settings UI:
// every card gets its own boundary, and every page gets one too. Errors are
// routed through Logger, never swallowed.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Logger } from "../api/logger.js";
import { formatError, s } from "./theme.js";

interface BoundaryProps {
  /** Label shown in the fallback, e.g. the plugin name or page title. */
  label: string;
  children: ReactNode;
}

interface BoundaryState {
  hasError: boolean;
  error: unknown;
}

export class VestraErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    Logger.captureError(error, `SettingsUI:${this.props.label} ${info.componentStack ?? ""}`);
  }

  private readonly reset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={s.errorBox} data-vestra-error={this.props.label}>
        <strong>{this.props.label} crashed:</strong> {formatError(this.state.error)}
        <div style={{ marginTop: 8 }}>
          <button type="button" style={s.button} onClick={this.reset}>
            Retry
          </button>
        </div>
      </div>
    );
  }
}
