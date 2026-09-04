// Vestra Manager — root component.

import { ManagerShell } from "./components/ManagerShell.js";
import { useManager } from "./hooks/useManager.js";
import { HomePage } from "./pages/HomePage.js";

export function App(): JSX.Element {
  const manager = useManager();
  return (
    <ManagerShell>
      <HomePage manager={manager} />
    </ManagerShell>
  );
}
