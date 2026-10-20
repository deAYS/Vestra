import { definePlugin, Styles, Toasts } from "@vestra/api";

/** A complete SDK example: built as a self-registering store artifact. */
export default definePlugin({
  name: "ExamplePlugin",
  description: "An SDK example that adds a soft ice accent to links.",
  authors: ["Vestra"],
  start() {
    Styles.inject("ExamplePlugin", ":root { --text-link: #a8ceff; }");
    Toasts.success("ExamplePlugin", "Running through @vestra/api");
  },
  stop() { Styles.remove("ExamplePlugin"); },
});
