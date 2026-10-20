import { useState } from "react";
import { Native } from "../api/native.js";
import { s } from "./theme.js";

export function AddonFolder({
  kind,
  refresh,
  pending = false,
}: {
  kind: "plugins" | "themes";
  refresh?: (() => Promise<void>) | undefined;
  pending?: boolean;
}): JSX.Element {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const available =
    Native.isAvailable() &&
    Native.getCapabilities().includes("addons:openFolder");
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vs-addon-folder">
      <div>
        <strong>Local {kind}</strong>
        <p>
          {kind === "plugins"
            ? "Drop built .plugin.js files here, then fully restart Discord. Built-ins ship with Vestra."
            : "Drop .css files here, then refresh. Select one theme at a time."}
        </p>
        <code>%AppData%\Vestra\{kind}</code>
      </div>
      <div style={{ ...s.row, flexWrap: "wrap" }}>
        <button
          type="button"
          style={s.navButton}
          disabled={!available || busy || pending}
          onClick={() => void run(() => Native.openAddonFolder(kind))}
        >
          Open {kind === "plugins" ? "plugin" : "theme"} folder ↗
        </button>
        {refresh && (
          <button
            type="button"
            style={s.navButton}
            disabled={!available || busy || pending}
            onClick={() => void run(refresh)}
          >
            Refresh files
          </button>
        )}
      </div>
      {!available && (
        <p className="vs-addon-note">
          Folder access is available inside Discord desktop.
        </p>
      )}
      {error && (
        <p role="alert" style={s.errorBox}>
          {error}
        </p>
      )}
    </div>
  );
}
