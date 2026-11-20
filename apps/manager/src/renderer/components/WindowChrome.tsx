import { useEffect, useState } from "react";
import { VESTRA_MARK_PATH } from "@vestra/shared";
import { managerApi } from "../types.js";
import type { ManagerWindowState } from "../../shared/channels.js";

export function WindowChrome(): JSX.Element {
  const [state, setState] = useState<ManagerWindowState>({
    maximized: false,
  });
  const { maximized } = state;
  useEffect(
    () => managerApi().onWindowState(setState),
    [],
  );
  return (
    <header className="vs-titlebar">
      <div className="vs-titlebar__brand">
        <svg width="20" height="20" viewBox="0 0 64 64" aria-hidden="true">
          <path d={VESTRA_MARK_PATH} fill="currentColor" fillRule="evenodd" />
        </svg>
        <span>
          vestra <small>Manager</small>
        </span>
      </div>
      <div className="vs-titlebar__actions">
        <div className="vs-window-controls" aria-label="Window controls">
          <button
            type="button"
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => managerApi().windowAction("minimize")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8.5h10" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={maximized ? "Restore window" : "Maximize window"}
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => managerApi().windowAction("toggle-maximize")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {maximized ? (
                <path d="M5 5V3h8v8h-2M3 5h8v8H3z" />
              ) : (
                <path d="M3.5 3.5h9v9h-9z" />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="vs-window-close"
            aria-label="Close window"
            title="Close"
            onClick={() => managerApi().windowAction("close")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
