// Manager security contract (static): narrow preload API, hardened window,
// main-side purge=false, no Node leakage into the renderer, no CLI
// subprocess, no duplicated install logic.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.join(import.meta.dirname, "..", "src");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

/** Strip line/block comments so doc prose can't trip the leak scanner. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

describe("security boundary", () => {
  test("19. renderer cannot access Node APIs", () => {
    const rendererFiles = listFiles(path.join(SRC, "renderer")).filter((f) =>
      /\.(ts|tsx)$/.test(f),
    );
    assert.ok(rendererFiles.length > 0);
    const banned = [
      "node:fs",
      "node:path",
      "node:child_process",
      "child_process",
      "require(",
      "process.env",
    ];
    for (const file of rendererFiles) {
      const content = codeOnly(fs.readFileSync(file, "utf8"));
      for (const token of banned) {
        assert.ok(!content.includes(token), `${path.basename(file)} leaks ${token}`);
      }
    }
  });

  test("20. preload exposes only the narrow Manager API", () => {
    const preload = codeOnly(read(path.join("preload", "index.ts")));
    assert.match(preload, /exposeInMainWorld\("vestraManager"/);
    for (const method of [
      "discover",
      "status",
      "check",
      "install",
      "repair",
      "uninstall",
      "onProgress",
      "isDevelopmentBuild",
    ]) {
      assert.ok(preload.includes(method), `preload missing ${method}`);
    }
    for (const banned of ["node:fs", "node:path", "child_process", "require("]) {
      assert.ok(!preload.includes(banned), `preload leaks ${banned}`);
    }
    assert.ok(!preload.includes("invokeAny"), "no arbitrary invoke");
  });

  test("window enforces contextIsolation + no nodeIntegration", () => {
    const windowSrc = read(path.join("main", "window.ts"));
    assert.match(windowSrc, /contextIsolation:\s*true/);
    assert.match(windowSrc, /nodeIntegration:\s*false/);
  });

  test("main bridge registers six methods and forces uninstall purge=false", () => {
    const bridge = read(path.join("main", "installerBridge.ts"));
    for (const channel of ["discover", "status", "check", "install", "repair", "uninstall"]) {
      assert.ok(bridge.includes(channel), `bridge missing ${channel}`);
    }
    assert.match(bridge, /purge:\s*false/);
    assert.ok(!bridge.includes("uninstallAll") || bridge.includes("service.uninstall"));
  });

  test("manager never shells out to the vestra CLI and shares no logic copy", () => {
    const all = listFiles(SRC).filter((f) => /\.(ts|tsx|mjs)$/.test(f));
    for (const file of all) {
      const content = codeOnly(fs.readFileSync(file, "utf8"));
      assert.ok(!content.includes("child_process"), path.basename(file));
      assert.ok(!content.includes("vestra.mjs"), path.basename(file));
      assert.ok(
        !/spawnSync|execFile|execSync/.test(content),
        `${path.basename(file)} spawns subprocesses`,
      );
    }
    const bridge = codeOnly(read(path.join("main", "installerBridge.ts")));
    assert.match(bridge, /InstallerService/);
  });
});
