import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "site/dist");
await fs.mkdir(path.join(out, "assets"), { recursive: true });
await fs.mkdir(path.join(out, "themes"), { recursive: true });
for (const file of ["index.html", "style.css", "app.js", "404.html"])
  await fs.copyFile(path.join(root, "site", file), path.join(out, file));
await fs.copyFile(
  path.join(root, "assets/vestra-logo/logo-icon.svg"),
  path.join(out, "assets/mark.svg"),
);
await fs.copyFile(
  path.join(root, "docs/images/overview-redesign.png"),
  path.join(out, "assets/settings.png"),
);
await fs.writeFile(path.join(out, ".nojekyll"), "");
await build({
  absWorkingDir: root,
  entryPoints: ["packages/injector/src/splash.ts"],
  bundle: true,
  loader: { ".css": "text" },
  platform: "browser",
  format: "iife",
  globalName: "VestraSplash",
  minify: true,
  outfile: path.join(out, "assets/startup.js"),
});
const result = await build({
  absWorkingDir: root,
  stdin: {
    contents: "export {THEME_LIBRARY} from './packages/core/src/themes.ts';",
    resolveDir: root,
  },
  bundle: true,
  loader: { ".css": "text" },
  platform: "node",
  format: "esm",
  write: false,
});
const { THEME_LIBRARY } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
for (const theme of THEME_LIBRARY) {
  const id = theme.name.replace("Vestra ", "").toLowerCase();
  await fs.writeFile(path.join(out, "themes", `${id}.theme.css`), theme.css);
}
console.log(
  `GitHub Pages site built in site/dist (${THEME_LIBRARY.length} theme downloads + shared startup animation).`,
);
