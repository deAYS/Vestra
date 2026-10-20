/** Desktop settings stay outside Discord's origin storage and version folders. */
export function buildSettingsSource(): string {
  return String.raw`
  const settingsChannel = /canary/i.test(path.basename(process.execPath)) ? "canary" : /ptb/i.test(path.basename(process.execPath)) ? "ptb" : "stable";
  function settingsPath() { return path.join(app.getPath("appData"), "Vestra", "settings", settingsChannel + ".json"); }
  function validSettings(text) {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 20 * 1024 * 1024) throw new Error("Settings exceed the 20 MB limit.");
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError("Settings must be a JSON object.");
    return text;
  }
  async function readSettings() {
    let failure;
    const candidates = [settingsPath(), settingsPath() + ".bak", path.join(app.getPath("userData"), SETTINGS_FILE)];
    for (const candidate of candidates) {
      try {
        const stat = await fs.promises.stat(candidate);
        if (stat.size > 20 * 1024 * 1024) throw new Error("Settings exceed the 20 MB limit.");
        return validSettings(await fs.promises.readFile(candidate, "utf8"));
      } catch (error) { if (error.code !== "ENOENT") failure = error; }
    }
    if (failure) throw failure;
    return null;
  }
  let settingsWrite = Promise.resolve();
  function writeSettings(text) {
    validSettings(text);
    const write = settingsWrite.catch(() => {}).then(async () => {
      const filename = settingsPath();
      await fs.promises.mkdir(path.dirname(filename), { recursive: true });
      try {
        const previous = await fs.promises.readFile(filename, "utf8");
        validSettings(previous);
        await fs.promises.writeFile(filename + ".bak.tmp", previous, "utf8");
        await fs.promises.rename(filename + ".bak.tmp", filename + ".bak");
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) {
          // Never discard a valid file after a backup IO failure.
          throw error;
        }
      }
      await fs.promises.writeFile(filename + ".tmp", text, "utf8");
      await fs.promises.rename(filename + ".tmp", filename);
      return true;
    });
    settingsWrite = write;
    return write;
  }
`;
}
