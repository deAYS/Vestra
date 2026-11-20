// Manager operations (what the IPC handlers run): start-status cleanup and the
// Restart Discord recovery record. Temp Vestra home and fakes only.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runManagerOperation, type OperationDeps } from "../src/main/operations.js";
import { readRecoveryState, writeRecoveryState } from "../src/main/recovery/state.js";
import type { DiscordChannel } from "../src/shared/channels.js";
import type { DiscordInstallation, OperationSummary } from "../src/shared/types.js";
import type { LifecycleHooks } from "../src/main/discordLifecycle.js";

function installation(channel: DiscordChannel, version: string): DiscordInstallation {
  return {
    channel,
    version,
    rootDir: `/fake/${channel}`,
    appDir: `/fake/${channel}/app-${version}`,
    asarPath: `/fake/${channel}/app-${version}/resources/app.asar`,
    isActive: true,
  };
}

async function harness(options: { installed?: boolean; ok?: boolean; statusFails?: boolean } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-operations-test-"));
  await fs.mkdir(path.join(home, "status"), { recursive: true });
  for (const channel of ["stable", "canary"])
    await fs.writeFile(
      path.join(home, "status", `${channel}.json`),
      JSON.stringify({ start: { at: 1, discordVersion: "1.0.9", vestraVersion: "0.1.0", ok: true } }),
    );
  const calls: string[] = [];
  const ok = options.ok ?? true;
  const deps: OperationDeps = {
    service: {
      context: { homeDir: home },
      async discover() {
        return [installation("stable", "1.0.10")];
      },
      async status() {
        if (options.statusFails) throw new Error("fixture status failure");
        return {
          statuses: [
            {
              installation: installation("stable", "1.0.10"),
              health: options.installed ? "healthy" : "not-installed",
              vestraInstalled: options.installed ?? false,
              repairable: true,
            },
          ],
          stale: [],
        };
      },
    },
    lifecycle: {
      async run(kind, channel, _progress, hooks: LifecycleHooks = {}): Promise<OperationSummary> {
        calls.push(`${kind}:${channel}:${hooks.afterVerify ? "clears" : "keeps"}`);
        if (ok) await hooks.afterVerify?.();
        return {
          ok,
          results: [{ asarPath: "/fake/app.asar", channel, ok, action: kind }],
        };
      },
    },
    maintenance: {
      async track(channel, enabled) {
        calls.push(`track:${channel}:${enabled}`);
      },
    },
  };
  const exists = (channel: string) =>
    fs.stat(path.join(home, "status", `${channel}.json`)).then(
      () => true,
      () => false,
    );
  return { home, deps, calls, exists };
}

test("install and uninstall clear only that channel's start status", async () => {
  for (const kind of ["install", "uninstall"] as const) {
    const h = await harness({ installed: kind === "uninstall" });
    const result = await runManagerOperation(h.deps, kind, "stable");
    assert.equal(result.ok, true);
    assert.equal(await h.exists("stable"), false, `${kind} clears stable`);
    assert.equal(await h.exists("canary"), true, `${kind} keeps canary`);
  }
});

test("repair clears start status only when the files had no Vestra", async () => {
  const installed = await harness({ installed: true });
  await runManagerOperation(installed.deps, "repair", "stable");
  assert.equal(await installed.exists("stable"), true, "repairing a live install keeps its start record");
  assert.deepEqual(installed.calls, ["repair:stable:keeps", "track:stable:true"]);

  const fresh = await harness({ installed: false });
  await runManagerOperation(fresh.deps, "repair", "stable");
  assert.equal(await fresh.exists("stable"), false);

  const unknown = await harness({ statusFails: true });
  await runManagerOperation(unknown.deps, "repair", "stable");
  assert.equal(await unknown.exists("stable"), true, "an unknown prior state keeps the record");
});

test("a failed operation keeps the start status", async () => {
  const h = await harness({ ok: false });
  const result = await runManagerOperation(h.deps, "install", "stable");
  assert.equal(result.ok, false);
  assert.equal(await h.exists("stable"), true);
});

test("Restart Discord repairs, then records the re-install as patched", async () => {
  const h = await harness({ installed: false });
  await writeRecoveryState(h.home, {
    stable: { phase: "waiting-for-exit", version: "1.0.10", at: 5, attempts: 1, signature: "sig" },
    canary: { phase: "idle", version: "1.0.3", at: 4, attempts: 0 },
  });
  const result = await runManagerOperation(h.deps, "restart", "stable");
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls, ["repair:stable:clears", "track:stable:true"]);
  const state = await readRecoveryState(h.home);
  assert.equal(state.stable?.phase, "patched");
  assert.equal(state.stable?.version, "1.0.10");
  assert.equal(state.stable?.attempts, 0);
  assert.ok((state.stable?.at ?? 0) > 5);
  assert.deepEqual(state.canary, { phase: "idle", version: "1.0.3", at: 4, attempts: 0 });
});

test("a failed Restart Discord leaves the waiting record", async () => {
  const h = await harness({ ok: false });
  const waiting = { phase: "waiting-for-exit" as const, version: "1.0.10", at: 5, attempts: 0 };
  await writeRecoveryState(h.home, { stable: waiting });
  await runManagerOperation(h.deps, "restart", "stable");
  assert.deepEqual((await readRecoveryState(h.home)).stable, waiting);
});
