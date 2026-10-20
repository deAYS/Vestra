import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createInstallerService } from "./service.js";
import {
  createTestDiscordInstall,
  fixtureDiscovery,
  writeTestBundle,
} from "./test-fixtures.js";
import { packAsar, readAsarFile, unpackAsar } from "@vestra/injector";

async function harness() {
  const fixture = await createTestDiscordInstall({ channel: "stable" });
  const home = path.join(fixture.base, "home");
  const bundlePath = await writeTestBundle(fixture.base);
  const service = createInstallerService({
    homeDir: home,
    bundlePath,
    testMode: true,
    discovery: fixtureDiscovery(fixture, path.join(fixture.base, "empty")),
  });
  return { fixture, service };
}

test("Repair replaces healthy archives and checks every bootstrap file", async () => {
  const { fixture, service } = await harness();
  try {
    assert.equal((await service.install()).ok, true);
    assert.equal((await service.repair()).results[0]?.action, "repaired");
    assert.equal((await service.check()).statuses[0]?.health, "healthy");
    const unpacked = path.join(fixture.base, "corrupt");
    await unpackAsar(fixture.asarPath, unpacked);
    await fs.writeFile(
      path.join(unpacked, "vestra", "vestra-preload.cjs"),
      "/* damaged preload */",
    );
    await packAsar(unpacked, fixture.asarPath);
    assert.equal((await service.check()).statuses[0]?.health, "drifted");
    assert.equal((await service.repair()).ok, true);
    assert.equal((await service.check()).statuses[0]?.health, "healthy");
  } finally {
    await fixture.cleanup();
  }
});

test("an in-place Discord update is preserved on Repair and Uninstall", async () => {
  const { fixture, service } = await harness();
  try {
    const source = path.join(fixture.base, "new-native");
    await fs.mkdir(source);
    await fs.writeFile(
      path.join(source, "package.json"),
      JSON.stringify({ main: "new-main.js" }),
    );
    await fs.writeFile(
      path.join(source, "new-main.js"),
      "module.exports = 'new Discord build';\n",
    );
    assert.equal((await service.install()).ok, true);
    await packAsar(source, fixture.asarPath);
    assert.equal((await service.check()).statuses[0]?.health, "drifted");
    assert.equal((await service.repair()).ok, true);
    assert.match(
      readAsarFile(fixture.asarPath, "new-main.js"),
      /new Discord build/,
    );
    assert.equal((await service.check()).statuses[0]?.health, "healthy");
    await service.uninstall();
    assert.equal(
      readAsarFile(fixture.asarPath, "new-main.js"),
      "module.exports = 'new Discord build';\n",
    );
    await service.install();
    await fs.writeFile(
      path.join(source, "new-main.js"),
      "module.exports = 'newer native update';\n",
    );
    await packAsar(source, fixture.asarPath);
    await service.uninstall();
    assert.equal(
      readAsarFile(fixture.asarPath, "new-main.js"),
      "module.exports = 'newer native update';\n",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("Repair discovers a new app version instead of repatching its historical directory", async () => {
  const { fixture, service } = await harness();
  try {
    assert.equal((await service.install()).ok, true);
    const oldArchive = await fs.readFile(fixture.asarPath);
    const source = path.join(fixture.base, "next-native");
    await fs.mkdir(source);
    await fs.writeFile(
      path.join(source, "package.json"),
      JSON.stringify({ main: "index.js" }),
    );
    await fs.writeFile(
      path.join(source, "index.js"),
      "module.exports = 'version 2';\n",
    );
    const next = path.join(fixture.root, "app-2.0.0", "resources", "app.asar");
    await fs.mkdir(path.dirname(next), { recursive: true });
    await packAsar(source, next);
    const repair = await service.repair({ channels: ["stable"] });
    assert.equal(repair.results[0]?.asarPath, next);
    assert.equal(repair.ok, true);
    assert.deepEqual(await fs.readFile(fixture.asarPath), oldArchive);
    assert.equal((await service.check()).statuses[0]?.health, "healthy");
  } finally {
    await fixture.cleanup();
  }
});
