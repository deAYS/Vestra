// Vestra CLI entrypoint — wires process.argv to runCli and exits with its code.
// (The #! shebang is added by the esbuild --banner flag at build time.)
// Run from the repo root so the default bundle path resolves:
//   bun ./apps/installer/dist/vestra.mjs install --channel canary

import { runCli } from "./cli.js";

const code = await runCli(process.argv.slice(2));
process.exit(code);
