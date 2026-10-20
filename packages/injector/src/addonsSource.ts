/** Fixed user-addon directories; renderer requests never choose an absolute path. */
export function buildAddonsSource(): string {
  return String.raw`
  function validAddonName(name, extension) {
    return typeof name === "string" && name.length <= 140 && name[0] !== "." &&
      !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !name.includes("..") &&
      name.toLowerCase().endsWith(extension) && !/[. ]$/.test(name);
  }
  async function addonFolder(kind) {
    if (kind !== "plugins" && kind !== "themes") throw new TypeError("Unknown addon folder");
    const root = path.join(app.getPath("appData"), "Vestra", kind);
    await fs.promises.mkdir(root, { recursive: true });
    const info = await fs.promises.lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Addon folders must be real directories");
    return root;
  }
  async function readAddonFiles(kind) {
    const root = await addonFolder(kind);
    const extension = kind === "themes" ? ".css" : ".plugin.js";
    const limit = kind === "themes" ? 512000 : 4000000;
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const result = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 256)) {
      if (!entry.isFile() || !validAddonName(entry.name, extension)) continue;
      try {
        const file = path.join(root, entry.name);
        const info = await fs.promises.lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > limit) continue;
        const source = await fs.promises.readFile(file, "utf8");
        if (Buffer.byteLength(source, "utf8") <= limit) result.push({ filename: entry.name, source });
        if (result.length >= 32) break;
      } catch (_) { console.warn("[Vestra] addon file skipped:", entry.name); }
    }
    return result;
  }
  async function writeThemeFile(filename, css) {
    if (!validAddonName(filename, ".css") || typeof css !== "string" || !css.trim() || Buffer.byteLength(css, "utf8") > 512000) throw new TypeError("Invalid CSS theme file");
    const root = await addonFolder("themes");
    const stem = filename.slice(0, -4);
    for (let index = 0; index < 100; index++) {
      const candidate = index ? stem + "-" + index + ".css" : filename;
      try { await fs.promises.writeFile(path.join(root, candidate), css, { encoding: "utf8", flag: "wx" }); return candidate; }
      catch (error) { if (!error || error.code !== "EEXIST") throw error; }
    }
    throw new Error("Too many theme files with this name");
  }
  async function removeThemeFile(filename) {
    if (!validAddonName(filename, ".css")) throw new TypeError("Invalid theme filename");
    const file = path.join(await addonFolder("themes"), filename);
    const info = await fs.promises.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Not a regular theme file");
    await shell.trashItem(file);
    return true;
  }
`;
}
