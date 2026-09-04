// Vestra Manager — renderer entrypoint.

import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Vestra Manager: missing #root element.");
}
createRoot(root).render(<App />);
