// Vestra Manager — friendly error with a "Show details" disclosure.
// Raw detail stays hidden until requested; no stack dumps in normal UI.

import { useState } from "react";
import { friendlyErrorMessage } from "../../shared/errorMessages.js";
import type { InstallerErrorCode } from "../../shared/types.js";

interface Props {
  code: InstallerErrorCode | string | undefined;
  detail: string | undefined;
  message: string;
  onRetry?(): void;
  onDismiss?(): void;
}

export function ErrorPanel({ code, detail, message, onRetry, onDismiss }: Props): JSX.Element {
  const [showDetails, setShowDetails] = useState(false);
  const friendly = friendlyErrorMessage(code as InstallerErrorCode | undefined);
  return (
    <div className="vs-error" data-testid="error-panel" role="alert">
      <div className="vs-error__title">{friendly.title}</div>
      {message !== "" && message !== friendly.title ? (
        <div className="vs-error__message">{message}</div>
      ) : null}
      <div className="vs-error__hint">{friendly.hint}</div>
      {detail !== undefined && detail !== "" ? (
        <div className="vs-error__details">
          <button type="button" onClick={() => setShowDetails((v) => !v)} data-testid="show-details">
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails ? <pre data-testid="error-detail">{detail}</pre> : null}
        </div>
      ) : null}
      <div className="vs-error__actions">
        {onRetry !== undefined ? (
          <button type="button" onClick={onRetry} data-testid="error-retry">
            Try Again
          </button>
        ) : null}
        {onDismiss !== undefined ? (
          <button type="button" onClick={onDismiss} data-testid="error-dismiss">
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}
