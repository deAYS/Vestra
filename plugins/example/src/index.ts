// Example plugin — real definePlugin usage lands in Phase 2/4.
export const ExamplePlugin = {
  name: "ExamplePlugin",
  description: "Tests the Vestra plugin system.",
  authors: ["Uzuhullah"],
  enabledByDefault: true,
} as const;
export default ExamplePlugin;
