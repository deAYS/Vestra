// Run status reader: start-status files + recovery state from a temp Vestra
// home. Never touches a real Discord install or the real home directory.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readRunStatus } from "../src/main/runStatus.js";
import type { DiscordInstallation } from "../src/shared/types.js";

function install(channel: "stable" | "canary", version: string | null): DiscordInstallation {
  return {
    channel,
    version,
    rootDir: `/fake/${channel}`,
    appDir: `/fake/${channel}/app`,
    asarPath: `/fake/${channel}/app/resources/app.asar`,
    isActive: true,
  };
}

async function home(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "vestra-run-status-test-"));
}

const record = (version: string, at: number) => ({
  at,
  discordVersion: version,
  vestraVersion: "0.1.0",
});

test("reads each discovered channel's start status against its installed version", async () => {
  const dir = await home();
  await fs.mkdir(path.join(dir, "status"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "status", "stable.json"),
    JSON.stringify({ launch: record("1.0.9", 10), start: { ...record("1.0.9", 11), ok: true } }),
  );
  await fs.writeFile(
    path.join(dir, "status", "canary.json"),
    JSON.stringify({ launch: record("1.0.5", 10) }),
  );
  await fs.writeFile(
    path.join(dir, "recovery-state.json"),
    JSON.stringify({ canary: { phase: "waiting-for-exit", version: "1.0.5", at: 5, attempts: 0 } }),
  );
  const result = await readRunStatus(dir, [install("stable", "1.0.9"), install("canary", "1.0.5")]);
  assert.deepEqual(result.stable, { run: { kind: "active", at: 11 } });
  assert.deepEqual(result.canary, {
    run: { kind: "awaiting-login" },
    recovery: { phase: "waiting-for-exit", version: "1.0.5", at: 5, attempts: 0 },
  });
  assert.equal("ptb" in result, false, "undiscovered channels are left out");
});

test("missing, corrupt or stale files read as not started and never throw", async () => {
  const dir = await home();
  await fs.mkdir(path.join(dir, "status"), { recursive: true });
  await fs.writeFile(path.join(dir, "status", "canary.json"), "{not json");
  await fs.writeFile(path.join(dir, "recovery-state.json"), "[]");
  const result = await readRunStatus(dir, [install("stable", "1.0.9"), install("canary", "1.0.5")]);
  assert.deepEqual(result, {
    stable: { run: { kind: "not-started" } },
    canary: { run: { kind: "not-started" } },
  });
  const gone = await readRunStatus(path.join(dir, "does-not-exist"), [install("stable", null)]);
  assert.deepEqual(gone, { stable: { run: { kind: "not-started" } } });
});
