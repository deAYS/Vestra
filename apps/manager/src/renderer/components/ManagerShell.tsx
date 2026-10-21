import type { ReactNode } from "react";
import { WindowChrome } from "./WindowChrome.js";

export function ManagerShell({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="vs-manager-app">
      <WindowChrome />
      <main className="vs-manager-body">
        <div className="vs-shell">{children}</div>
      </main>
    </div>
  );
}
