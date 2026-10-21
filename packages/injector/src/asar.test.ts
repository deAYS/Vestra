import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { packAsar, readAsarFile, readAsarMain } from "./asar.js";

test("archive readers accept portable and Windows paths for nested entries", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-asar-paths-"));
  try {
    const source = path.join(fixture, "source");
    await fs.mkdir(path.join(source, "bootstrap"), { recursive: true });
    await fs.writeFile(path.join(source, "package.json"), JSON.stringify({ main: "bootstrap/index.js" }));
    await fs.writeFile(path.join(source, "bootstrap/index.js"), "// original entry");
    const archive = path.join(fixture, "app.asar");
    await packAsar(source, archive);
    assert.equal(readAsarMain(archive), "bootstrap/index.js");
    assert.equal(readAsarFile(archive, readAsarMain(archive)), "// original entry");
    assert.equal(readAsarFile(archive, "bootstrap\\index.js"), "// original entry");
  } finally {
    const resolved = path.resolve(fixture);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("vestra-asar-paths-"))
      await fs.rm(resolved, { recursive: true, force: true });
  }
});
