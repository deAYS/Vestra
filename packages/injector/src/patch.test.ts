import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";
import { packAsar, readAsarFile, unpackAsar } from "./asar.js";
import type { DiscordInstall } from "./paths.js";
import {
  applyInject,
  isInjected,
  planInject,
  type PayloadSources,
} from "./patch.js";

const HOOK_FLAG = "__vestraPatchTestHook";

const payload: PayloadSources = {
  bundleSource: "// bundle",
  preloadSource: "// preload",
  mainHookSource: `globalThis.${HOOK_FLAG} = true;`,
  loaderSource: "// loader",
};

async function fixture(main: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-patch-"));
  const source = path.join(root, "source");
  const entry = path.join(source, ...main.split("/"));
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(path.join(source, "package.json"), JSON.stringify({ main }));
  await fs.writeFile(entry, "module.exports = 'original';\n");
  const resourcesDir = path.join(root, "resources");
  await fs.mkdir(resourcesDir);
  const asarPath = path.join(resourcesDir, "app.asar");
  await packAsar(source, asarPath);
  const install: DiscordInstall = {
    channel: "stable",
    rootDir: root,
    appDir: root,
    resourcesDir,
    asarPath,
    version: "1.0.0",
  };
  const cleanup = async () => {
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("vestra-patch-"))
      await fs.rm(resolved, { recursive: true, force: true });
  };
  return { root, install, cleanup };
}

const safety = { testMode: false };

test("hook resolves for a nested main entry", async () => {
  const { root, install, cleanup } = await fixture("bootstrap/index.js");
  try {
    const { plan } = planInject(install, payload, safety);
    await applyInject(plan, payload, safety);
    const out = path.join(root, "unpacked");
    await unpackAsar(install.asarPath, out);
    delete (globalThis as Record<string, unknown>)[HOOK_FLAG];
    const entry = path.join(out, "bootstrap", "index.js");
    assert.match(await fs.readFile(entry, "utf8"), /require\("\.\.\/vestra\/vestra-main-hook\.cjs"\)/);
    assert.equal(createRequire(import.meta.url)(entry), "original");
    assert.equal((globalThis as Record<string, unknown>)[HOOK_FLAG], true);
  } finally {
    delete (globalThis as Record<string, unknown>)[HOOK_FLAG];
    await cleanup();
  }
});

test("root main keeps the plain relative hook path", async () => {
  const { install, cleanup } = await fixture("bundle.js");
  try {
    const { plan } = planInject(install, payload, safety);
    assert.ok(plan.hookLines.join("\n").includes('require("./vestra/vestra-main-hook.cjs")'));
  } finally {
    await cleanup();
  }
});

test("isInjected is false once the archive was replaced by the pristine one", async () => {
  const { install, cleanup } = await fixture("bundle.js");
  try {
    const { plan } = planInject(install, payload, safety);
    await applyInject(plan, payload, safety);
    assert.equal(isInjected(install), true);
    await fs.copyFile(plan.backupPath, install.asarPath);
    assert.equal(isInjected(install), false);
  } finally {
    await cleanup();
  }
});

test("cleanup failure does not fail a successful inject", async () => {
  const { install, cleanup } = await fixture("bundle.js");
  const warn = console.warn;
  const warned: unknown[][] = [];
  console.warn = (...args: unknown[]) => void warned.push(args);
  try {
    const { plan } = planInject(install, payload, safety);
    let called = 0;
    await applyInject(plan, payload, {
      ...safety,
      removeDir: async () => {
        called++;
        throw new Error("EBUSY");
      },
    });
    assert.equal(called, 1);
    assert.equal(warned.length, 1);
    assert.equal(isInjected(install), true);
  } finally {
    console.warn = warn;
    await cleanup();
  }
});

test("no temporary archive remains after inject", async () => {
  const { install, cleanup } = await fixture("bundle.js");
  try {
    const { plan } = planInject(install, payload, safety);
    await applyInject(plan, payload, safety);
    const names = await fs.readdir(install.resourcesDir);
    assert.deepEqual(names.filter((n) => n.endsWith(".vestra-tmp")), []);
    assert.ok(readAsarFile(install.asarPath, "vestra/vestra-main-hook.cjs").includes(HOOK_FLAG));
  } finally {
    await cleanup();
  }
});
