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
import { BACKUP_SUFFIX, RECEIPT_FILE, packAsar, readAsarFile, unpackAsar } from "@vestra/injector";
import { layoutHome } from "./home.js";

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

for (const receiptState of ["corrupt", "missing"] as const) {
  test(`Uninstall restores native bytes with a ${receiptState} receipt and no registry`, async () => {
    const { fixture, service } = await harness();
    try {
      const native = await fs.readFile(fixture.asarPath);
      assert.equal((await service.install()).ok, true);
      const receipt = path.join(fixture.resourcesDir, RECEIPT_FILE);
      if (receiptState === "corrupt") await fs.writeFile(receipt, "{ interrupted receipt");
      else await fs.unlink(receipt);
      await fs.unlink(layoutHome(path.join(fixture.base, "home")).registryPath);
      assert.equal((await service.check()).statuses[0]?.health, "drifted");
      assert.equal((await service.status()).statuses[0]?.health, "drifted");
      const result = await service.uninstall({ channels: ["stable"] });
      assert.equal(result.ok, true);
      assert.equal(result.results[0]?.action, "uninstalled");
      assert.deepEqual(await fs.readFile(fixture.asarPath), native);
      assert.equal((await service.check()).statuses[0]?.health, "not-installed");
    } finally {
      await fixture.cleanup();
    }
  });
}

test("Uninstall reports failure when a remaining hook has no usable backup", async () => {
  const { fixture, service } = await harness();
  try {
    assert.equal((await service.install()).ok, true);
    await fs.unlink(fixture.asarPath + BACKUP_SUFFIX);
    await fs.unlink(path.join(fixture.resourcesDir, RECEIPT_FILE));
    const hooked = await fs.readFile(fixture.asarPath);
    const result = await service.uninstall();
    assert.equal(result.ok, false);
    assert.equal(result.results[0]?.action, "failed");
    assert.deepEqual(await fs.readFile(fixture.asarPath), hooked);
    assert.equal((await service.check()).statuses[0]?.health, "drifted");
  } finally {
    await fixture.cleanup();
  }
});

test("status and check report drift when only the backup is missing", async () => {
  const { fixture, service } = await harness();
  try {
    assert.equal((await service.install()).ok, true);
    await fs.unlink(fixture.asarPath + BACKUP_SUFFIX);
    assert.equal((await service.check()).statuses[0]?.health, "drifted");
    assert.equal((await service.status()).statuses[0]?.health, "drifted");
    assert.equal((await service.uninstall()).ok, false);
  } finally {
    await fixture.cleanup();
  }
});

for (const operation of ["install", "repair"] as const) {
  test(`${operation} can retry after a receipt write failure`, async () => {
    const { fixture, service } = await harness();
    try {
      const native = await fs.readFile(fixture.asarPath);
      const receipt = path.join(fixture.resourcesDir, RECEIPT_FILE);
      await fs.mkdir(receipt);
      assert.equal((await service.install()).ok, false);
      assert.deepEqual(await fs.readFile(fixture.asarPath), native);
      await fs.rmdir(receipt);
      assert.equal((await service[operation]()).ok, true);
      assert.equal((await service.check()).statuses[0]?.health, "healthy");
      assert.deepEqual(await fs.readFile(fixture.asarPath + BACKUP_SUFFIX), native);
      assert.equal((await service.uninstall()).ok, true);
      assert.deepEqual(await fs.readFile(fixture.asarPath), native);
    } finally {
      await fixture.cleanup();
    }
  });
}

test("Repair recovers an unreadable live ASAR from its pristine backup", async () => {
  const { fixture, service } = await harness();
  try {
    const native = await fs.readFile(fixture.asarPath);
    assert.equal((await service.install()).ok, true);
    await fs.writeFile(fixture.asarPath, "interrupted app.asar write");
    const result = await service.repair();
    assert.equal(result.ok, true);
    assert.equal((await service.check()).statuses[0]?.health, "healthy");
    assert.deepEqual(await fs.readFile(fixture.asarPath + BACKUP_SUFFIX), native);
    assert.equal((await service.uninstall()).ok, true);
    assert.deepEqual(await fs.readFile(fixture.asarPath), native);
  } finally {
    await fixture.cleanup();
  }
});

test("Repair preserves both files when neither the live ASAR nor its backup is readable", async () => {
  const { fixture, service } = await harness();
  try {
    assert.equal((await service.install()).ok, true);
    await fs.writeFile(fixture.asarPath, "damaged live archive");
    await fs.writeFile(fixture.asarPath + BACKUP_SUFFIX, "damaged backup");
    assert.equal((await service.repair()).ok, false);
    assert.equal(await fs.readFile(fixture.asarPath, "utf8"), "damaged live archive");
    assert.equal(await fs.readFile(fixture.asarPath + BACKUP_SUFFIX, "utf8"), "damaged backup");
  } finally {
    await fixture.cleanup();
  }
});

test("Repair refuses an unreadable backup without replacing a readable hooked archive", async () => {
  const { fixture, service } = await harness();
  try {
    assert.equal((await service.install()).ok, true);
    const hooked = await fs.readFile(fixture.asarPath);
    await fs.writeFile(fixture.asarPath + BACKUP_SUFFIX, "damaged backup");
    assert.equal((await service.repair()).ok, false);
    assert.deepEqual(await fs.readFile(fixture.asarPath), hooked);
    assert.equal(await fs.readFile(fixture.asarPath + BACKUP_SUFFIX, "utf8"), "damaged backup");
  } finally {
    await fixture.cleanup();
  }
});

for (const operation of ["repair", "uninstall"] as const) {
  test(`${operation} refuses a truncated backup even when package.json and main remain readable`, async () => {
    const { fixture, service } = await harness();
    try {
      const source = path.join(fixture.base, "native-with-runtime");
      await fs.mkdir(source);
      await fs.writeFile(path.join(source, "package.json"), JSON.stringify({ main: "index.js" }));
      await fs.writeFile(path.join(source, "index.js"), "module.exports = require('./z-runtime.js');\n");
      await fs.writeFile(path.join(source, "z-runtime.js"), "module.exports = 'native runtime';\n");
      await packAsar(source, fixture.asarPath);
      const native = await fs.readFile(fixture.asarPath);
      assert.equal((await service.install()).ok, true);
      const hooked = await fs.readFile(fixture.asarPath);
      const backup = native.subarray(0, native.length - 1);
      await fs.writeFile(fixture.asarPath + BACKUP_SUFFIX, backup);
      assert.match(readAsarFile(fixture.asarPath + BACKUP_SUFFIX, "index.js"), /require/);
      assert.equal((await service[operation]()).ok, false);
      assert.deepEqual(await fs.readFile(fixture.asarPath), hooked);
      assert.deepEqual(await fs.readFile(fixture.asarPath + BACKUP_SUFFIX), backup);
    } finally {
      await fixture.cleanup();
    }
  });
}

test("Repair preserves a native update when its old receipt is corrupt", async () => {
  const { fixture, service } = await harness();
  try {
    const native = await fs.readFile(fixture.asarPath);
    assert.equal((await service.install()).ok, true);
    const source = path.join(fixture.base, "updated-native");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "package.json"), JSON.stringify({ main: "new-main.js" }));
    await fs.writeFile(path.join(source, "new-main.js"), "module.exports = 'new native';\n");
    await packAsar(source, fixture.asarPath);
    const updated = await fs.readFile(fixture.asarPath);
    assert.notDeepEqual(updated, native);
    await fs.writeFile(path.join(fixture.resourcesDir, RECEIPT_FILE), "{ interrupted");
    assert.equal((await service.repair()).ok, true);
    assert.deepEqual(await fs.readFile(fixture.asarPath + BACKUP_SUFFIX), updated);
    assert.equal((await service.uninstall()).ok, true);
    assert.deepEqual(await fs.readFile(fixture.asarPath), updated);
  } finally {
    await fixture.cleanup();
  }
});

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
