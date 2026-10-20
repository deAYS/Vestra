import type { ReactNode } from "react";

export function ManagerShell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="vs-shell">{children}</div>;
}
