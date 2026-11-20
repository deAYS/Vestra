// Installer operation fixes: scoped repair/purge, hooked-record retention,
// registry hardening. Temp fixtures only — never touches real Discord installs.
import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { layoutHome } from "./home.js";
import { installAll, repairAll, uninstallAll } from "./operations.js";
import { loadRegistry, loadRegistryWithDiagnostics, saveRegistry } from "./registry.js";
import {
  createTestDiscordInstall,
  fixtureDiscovery,
  testOperationContext,
  writeTestBundle,
  type TestDiscordInstall,
} from "./test-fixtures.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await (cleanups.pop() as () => Promise<void>)();
});

async function setup(installs: TestDiscordInstall[]) {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-opfix-"));
  cleanups.push(() => fs.promises.rm(tmp, { recursive: true, force: true }));
  for (const fx of installs) cleanups.push(fx.cleanup);
  const homeDir = path.join(tmp, "home");
  const emptyDir = path.join(tmp, "empty");
  await fs.promises.mkdir(emptyDir, { recursive: true });
  const bundle = await writeTestBundle(path.join(tmp, "bundle"));
  const ctx = testOperationContext(homeDir, bundle, fixtureDiscovery(installs, emptyDir));
  return { tmp, homeDir, emptyDir, bundle, ctx, registryPath: layoutHome(homeDir).registryPath };
}

describe("repairAll without a channel filter", () => {
  test("repairs only channels with a registry record", async () => {
    const stable = await createTestDiscordInstall({ channel: "stable" });
    const canary = await createTestDiscordInstall({ channel: "canary" });
    const { ctx } = await setup([stable, canary]);
    await installAll(ctx, { channels: ["stable"] });
    const before = fs.readFileSync(canary.asarPath);
    const batch = await repairAll(ctx);
    assert.deepEqual(batch.results.map((r) => [r.channel, r.action]), [["stable", "repaired"]]);
    assert.ok(fs.readFileSync(canary.asarPath).equals(before));
  });

  test("explicit channels still repair an unrecorded channel", async () => {
    const canary = await createTestDiscordInstall({ channel: "canary" });
    const { ctx } = await setup([canary]);
    const batch = await repairAll(ctx, { channels: ["canary"] });
    assert.equal(batch.results[0]?.action, "repaired");
  });
});

describe("uninstallAll record retention and purge", () => {
  test("keeps a hooked record that discovery no longer finds", async () => {
    const fx = await createTestDiscordInstall({ channel: "canary" });
    const { ctx, emptyDir, homeDir, registryPath } = await setup([fx]);
    await installAll(ctx);
    const noRoot = testOperationContext(homeDir, ctx.bundlePath as string, fixtureDiscovery([], emptyDir));
    const batch = await uninstallAll(noRoot);
    assert.equal(batch.results[0]?.ok, false);
    assert.equal(batch.results[0]?.action, "failed");
    assert.equal(batch.results[0]?.detail, "Not found by discovery; pass --root to uninstall it.");
    assert.equal(Object.keys(await loadRegistry(registryPath)).length, 1);
  });

  test("forgets a record whose archive is gone", async () => {
    const fx = await createTestDiscordInstall({ channel: "canary" });
    const { ctx, emptyDir, homeDir } = await setup([fx]);
    await installAll(ctx);
    await fs.promises.rm(fx.appDir, { recursive: true, force: true });
    const noRoot = testOperationContext(homeDir, ctx.bundlePath as string, fixtureDiscovery([], emptyDir));
    const batch = await uninstallAll(noRoot);
    assert.equal(batch.results[0]?.action, "forgotten");
  });

  test("purge is skipped when a channel filter is given", async () => {
    const fx = await createTestDiscordInstall({ channel: "canary" });
    const { ctx, homeDir } = await setup([fx]);
    await installAll(ctx);
    const batch = await uninstallAll(ctx, { channels: ["canary"], purge: true });
    assert.ok(fs.existsSync(homeDir));
    const last = batch.results[batch.results.length - 1];
    assert.equal(last?.ok, false);
    assert.equal(last?.detail, "Purge skipped: a channel filter was given.");
  });

  test("purge is skipped when an uninstall failed", async () => {
    const fx = await createTestDiscordInstall({ channel: "canary" });
    const { ctx, emptyDir, homeDir } = await setup([fx]);
    await installAll(ctx);
    const noRoot = testOperationContext(homeDir, ctx.bundlePath as string, fixtureDiscovery([], emptyDir));
    const batch = await uninstallAll(noRoot, { purge: true });
    assert.ok(fs.existsSync(homeDir));
    const last = batch.results[batch.results.length - 1];
    assert.equal(last?.detail, "Purge skipped: uninstall did not complete for every installation.");
  });

  test("purge runs when everything succeeded and no filter", async () => {
    const fx = await createTestDiscordInstall({ channel: "canary" });
    const { ctx, homeDir } = await setup([fx]);
    await installAll(ctx);
    const batch = await uninstallAll(ctx, { purge: true });
    assert.ok(batch.results.every((r) => r.ok));
    assert.equal(fs.existsSync(homeDir), false);
  });
});

describe("registry hardening", () => {
  test("corrupt installs.json is renamed aside and a new save keeps the record", async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-reg-"));
    cleanups.push(() => fs.promises.rm(tmp, { recursive: true, force: true }));
    const registryPath = path.join(tmp, "installs.json");
    await fs.promises.writeFile(registryPath, "{ not json", "utf8");
    const diag = await loadRegistryWithDiagnostics(registryPath);
    assert.deepEqual(diag.registry, {});
    assert.match(diag.warning ?? "", /corrupt/i);
    const names = fs.readdirSync(tmp);
    assert.ok(names.some((n) => /^installs\.json\.corrupt-\d+$/.test(n)), names.join(","));
    assert.equal(fs.existsSync(registryPath), false);
    const entry = { asarPath: "x", channel: "stable", installVersion: "1", payloadVersion: "1", at: "t" };
    await saveRegistry(registryPath, { x: entry });
    assert.deepEqual(Object.keys(await loadRegistry(registryPath)), ["x"]);
    assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.endsWith(".tmp")), []);
  });

  test("missing file is not renamed and yields no warning", async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-reg-"));
    cleanups.push(() => fs.promises.rm(tmp, { recursive: true, force: true }));
    const diag = await loadRegistryWithDiagnostics(path.join(tmp, "installs.json"));
    assert.equal(diag.warning, undefined);
    assert.deepEqual(fs.readdirSync(tmp), []);
  });

  test("save into a deleted home creates the folder", async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-reg-"));
    cleanups.push(() => fs.promises.rm(tmp, { recursive: true, force: true }));
    const registryPath = path.join(tmp, "gone", "installs.json");
    await saveRegistry(registryPath, {});
    assert.ok(fs.existsSync(registryPath));
  });

  test("path with a typographic apostrophe and U-umlaut round-trips", async () => {
    const fx = await createTestDiscordInstall({ channel: "canary", rootName: "Discord’s Ü" });
    const { ctx, registryPath } = await setup([fx]);
    await installAll(ctx);
    const reg = await loadRegistry(registryPath);
    assert.ok(fx.asarPath.includes("’") && fx.asarPath.includes("Ü"));
    assert.equal(reg[fx.asarPath]?.asarPath, fx.asarPath);
  });
});
