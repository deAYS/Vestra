import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assertSafeVersion } from "@vestra/shared";
import { parsePluginEnvelope, writePluginPayload, sha256Hex, type PluginEnvelope } from "../../store/src/envelope.js";
import { parseEnvelope, type UpdateEnvelope } from "../../updater/src/envelope.js";
import { compareVersions } from "../../updater/src/feed.js";
import { currentInstalledVersion, currentStagedVersion, checkForUpdates } from "../../updater/src/update.js";
import { PAYLOAD_FILES, verifyPayload, stagePayload } from "./payload.js";
import { loadRegistry, saveRegistry } from "./registry.js";
import { createInstallerService } from "./service.js";
import { createTestDiscordInstall } from "./test-fixtures.js";
import { applyInject, planInject, readAsarMain } from "@vestra/injector";

function plugin(): PluginEnvelope {
  const source = "console.log('plugin')";
  return { tool: "vestra-plugin-envelope", version: 1, name: "Test", pluginVersion: "1.0.0", files: { "index.js": Buffer.from(source).toString("base64") }, manifest: { files: { "index.js": sha256Hex(source) } } };
}
function parsePlugin(value: PluginEnvelope) {
  const bytes = Buffer.from(JSON.stringify(value));
  return parsePluginEnvelope(bytes, sha256Hex(bytes), "Test");
}
function update(): UpdateEnvelope {
  return { tool: "vestra-update-envelope", version: 1, payloadVersion: "1.0.0", files: Object.fromEntries(PAYLOAD_FILES.map(name => [name, Buffer.from(name).toString("base64")])), manifest: { files: Object.fromEntries(PAYLOAD_FILES.map(name => [name, sha256Hex(name)])) } };
}

test("versions cannot escape artifact directories on Windows or POSIX", () => {
  for (const bad of ["../outside", "..\\outside", "C:\\outside", "/outside", "1.0/evil", "1.0:evil", "", "1.0.0..evil"]) assert.throws(() => assertSafeVersion(bad), TypeError, bad);
  for (const good of ["0.0.0", "1.2.3-beta.2", "1.2.3+build.10"]) assert.doesNotThrow(() => assertSafeVersion(good));
});

test("store verifies required entry, every extra file, base64 and version", () => {
  assert.equal(parsePlugin(plugin()).name, "Test");
  const missingHash = plugin(); missingHash.manifest.files = {};
  assert.throws(() => parsePlugin(missingHash), /manifest/i);
  const extra = plugin(); extra.files["extra.js"] = "YWJj";
  assert.throws(() => parsePlugin(extra), /manifest/i);
  const malformed = plugin(); malformed.files["index.js"] = "%%%";
  assert.throws(() => parsePlugin(malformed), /base64/i);
  const traversal = plugin(); traversal.pluginVersion = "..\\outside";
  assert.throws(() => parsePlugin(traversal), /version/i);
});

test("direct store writes validate before creating directories", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-envelope-"));
  try {
    const bad = plugin(); bad.pluginVersion = "../../outside";
    await assert.rejects(() => writePluginPayload(root, bad), /version/i);
    assert.deepEqual(await fs.promises.readdir(root), []);
    const dir = await writePluginPayload(root, plugin());
    assert.equal(await fs.promises.readFile(path.join(dir, "index.js"), "utf8"), "console.log('plugin')");
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});

test("updater refuses empty manifests, unchecked extras and missing required hashes", () => {
  for (const kind of ["valid", "empty", "missing", "extra"] as const) {
    const value = update();
    if (kind === "empty") value.manifest.files = {};
    if (kind === "missing") delete value.manifest.files["vestra.js"];
    if (kind === "extra") { value.files["extra.js"] = "YWJj"; value.manifest.files["extra.js"] = sha256Hex("abc"); }
    const bytes = Buffer.from(JSON.stringify(value));
    if (kind === "valid") assert.equal(parseEnvelope(bytes, sha256Hex(bytes)).payloadVersion, "1.0.0");
    else assert.throws(() => parseEnvelope(bytes, sha256Hex(bytes)), /manifest|payload/i);
  }
});

test("payload verification cannot succeed with a manifest listing zero or partial files", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-manifest-"));
  try {
    for (const files of [{}, { "vestra.js": sha256Hex("x") }]) {
      await fs.promises.writeFile(path.join(root, "manifest.json"), JSON.stringify({ tool: "vestra-installer", version: 1, payloadVersion: "1.0.0", files }));
      assert.equal((await verifyPayload(root)).ok, false);
    }
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});

test("release comparison follows prerelease identifier ordering and ignores build metadata", () => {
  assert.ok(compareVersions("1.0.0-beta.10", "1.0.0-beta.2") > 0);
  assert.ok(compareVersions("1.0.0", "1.0.0-beta.10") > 0);
  assert.ok(compareVersions("1.0.0-1", "1.0.0-alpha") < 0);
  assert.equal(compareVersions("1.0.0+one", "1.0.0+two"), 0);
  assert.ok(compareVersions("invalid", "1.0.0") < 0);
});

test("a downloaded newer release stays available until it is actually applied", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-update-"));
  try {
    const bundle = path.join(root, "bundle.js");
    await fs.promises.writeFile(bundle, "/* fixture */");
    await stagePayload({ bundlePath: bundle, payloadRoot: path.join(root, "payload"), payloadVersion: "2.0.0" });
    // Resolve the real registry location rather than coupling the assertion to its filename.
    const { layoutHome } = await import("./home.js");
    await saveRegistry(layoutHome(root).registryPath, { ["/fixture/app.asar"]: { asarPath: "/fixture/app.asar", channel: "canary", installVersion: "1.0.0", payloadVersion: "1.0.0", at: new Date().toISOString() } });
    assert.equal(await currentStagedVersion(root), "2.0.0");
    assert.equal(await currentInstalledVersion(root), "1.0.0");
    const feed = JSON.stringify({ releases: [{ version: "2.0.0", url: "https://example.test/release", sha256: "a".repeat(64) }] });
    const status = await checkForUpdates({ homeDir: root, testMode: false, feedUrl: "https://example.test/feed", fetchFn: async () => ({ ok: true, status: 200, async text() { return feed; }, async arrayBuffer() { return new ArrayBuffer(0); } }) });
    assert.equal(status.available, true);
    assert.equal((await loadRegistry(layoutHome(root).registryPath))["/fixture/app.asar"]?.payloadVersion, "1.0.0");
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});

test("injector refuses to overwrite a pre-existing pristine backup", async () => {
  const fixture = await createTestDiscordInstall({ channel: "canary", version: "1.0.0" });
  try {
    const install = { ...fixture, rootDir: fixture.root };
    const backup = install.asarPath + ".vestra-backup";
    await fs.promises.writeFile(backup, "pristine-backup");
    const payload = { bundleSource: "/* bundle */", preloadSource: "/* preload */", mainHookSource: "/* main */", loaderSource: "/* loader */" };
    const { plan } = planInject(install, payload, { testMode: true, knownFixtureRoots: [fixture.root] });
    await assert.rejects(() => applyInject(plan, payload, { testMode: true, knownFixtureRoots: [fixture.root] }), /Inject failed/);
    assert.equal(await fs.promises.readFile(backup, "utf8"), "pristine-backup");
    assert.equal(readAsarMain(install.asarPath), "index.js");
  } finally { await fixture.cleanup(); }
});

test("a progress listener throwing cannot abort discovery or report success for zero targets", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vestra-no-target-"));
  try {
    const service = createInstallerService({ homeDir: root, discovery: { platform: "win32", env: { LOCALAPPDATA: root } } });
    assert.deepEqual(await service.discover({ onProgress() { throw new Error("observer closed"); } }), []);
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});
