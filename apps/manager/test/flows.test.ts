// Manager operation flows over a fake service (no Electron, no Discord).
// Verifies: single-channel scoping, install-then-verify, verify-first
// repair, uninstall purge=false, and progress-agnostic behavior parity.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { DiscordChannel } from "../src/shared/channels.js";
import {
  runInstallFlow,
  runRepairFlow,
  runUninstallFlow,
  type ServiceLike,
} from "../src/shared/flows.js";
import type {
  CheckSummary,
  InstallStatus,
  OperationSummary,
} from "../src/shared/types.js";

interface FakeState {
  installed: boolean;
  healthy: boolean;
}

function makeStatus(channel: DiscordChannel, state: FakeState): InstallStatus {
  if (!state.installed) {
    return {
      installation: {
        channel,
        version: "1.0.0",
        rootDir: `/fake/${channel}`,
        appDir: `/fake/${channel}/app`,
        asarPath: `/fake/${channel}/app.asar`,
        isActive: true,
      },
      health: "not-installed",
      vestraInstalled: false,
      repairable: true,
      detail: "not installed",
    };
  }
  return {
    installation: {
      channel,
      version: "1.0.0",
      rootDir: `/fake/${channel}`,
      appDir: `/fake/${channel}/app`,
      asarPath: `/fake/${channel}/app.asar`,
      isActive: true,
    },
    health: state.healthy ? "healthy" : "drifted",
    vestraInstalled: true,
    repairable: !state.healthy,
    detail: state.healthy
      ? "healthy"
      : "asar drifted (hook or bundle mismatch)",
    code: state.healthy ? undefined : "verification-failed",
  };
}

interface Call {
  method: string;
  channels: DiscordChannel[] | undefined;
  purge?: boolean | undefined;
}

/** Fixture-backed fake: temp/sentinel semantics, never a real Discord path. */
function makeFake(initial: Partial<Record<DiscordChannel, FakeState>> = {}) {
  const state: Record<string, FakeState> = {
    stable: { ...(initial["stable"] ?? { installed: false, healthy: false }) },
    canary: { ...(initial["canary"] ?? { installed: false, healthy: false }) },
  };
  const calls: Call[] = [];
  const service: ServiceLike = {
    check: async (args) => {
      calls.push({ method: "check", channels: args.channels });
      const statuses = (
        args.channels ?? (["stable", "canary"] as DiscordChannel[])
      ).map((c) => makeStatus(c, state[c] as FakeState));
      const summary: CheckSummary = { statuses, stale: [] };
      return summary;
    },
    install: async (args) => {
      calls.push({ method: "install", channels: args.channels });
      for (const c of args.channels)
        state[c] = { installed: true, healthy: true };
      const summary: OperationSummary = {
        ok: true,
        results: args.channels.map((c) => ({
          asarPath: `/fake/${c}/app.asar`,
          channel: c,
          ok: true,
          action: "installed",
        })),
      };
      return summary;
    },
    repair: async (args) => {
      calls.push({ method: "repair", channels: args.channels });
      for (const c of args.channels)
        state[c] = { installed: true, healthy: true };
      const summary: OperationSummary = {
        ok: true,
        results: args.channels.map((c) => ({
          asarPath: `/fake/${c}/app.asar`,
          channel: c,
          ok: true,
          action: "repaired",
        })),
      };
      return summary;
    },
    uninstall: async (args) => {
      calls.push({
        method: "uninstall",
        channels: args.channels,
        purge: args.purge,
      });
      for (const c of args.channels)
        state[c] = { installed: false, healthy: false };
      const summary: OperationSummary = {
        ok: true,
        results: args.channels.map((c) => ({
          asarPath: `/fake/${c}/app.asar`,
          channel: c,
          ok: true,
          action: "uninstalled",
        })),
      };
      return summary;
    },
  };
  return { service, calls, state };
}

describe("operation flows", () => {
  test("10+11. install passes exactly one channel, then deep-verifies", async () => {
    const { service, calls } = makeFake();
    const result = await runInstallFlow(service, "canary");
    assert.equal(result.ok, true);
    const installs = calls.filter((c) => c.method === "install");
    assert.equal(installs.length, 1);
    assert.deepEqual(installs[0]?.channels, ["canary"]);
    const checks = calls.filter((c) => c.method === "check");
    assert.ok(checks.length >= 1);
    assert.deepEqual(checks[checks.length - 1]?.channels, ["canary"]);
  });

  test("install surfaces verification failure when check is not healthy", async () => {
    const { service } = makeFake();
    const broken: ServiceLike = {
      ...service,
      check: async (args) => ({
        statuses: args.channels.map((c) =>
          makeStatus(c, { installed: true, healthy: false }),
        ),
        stale: [],
      }),
    };
    const result = await runInstallFlow(broken, "stable");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "verification-failed");
  });

  test("12. explicit repair rewrites healthy installs and verifies afterwards", async () => {
    const { service, calls } = makeFake({
      canary: { installed: true, healthy: true },
    });
    const result = await runRepairFlow(service, "canary");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.repaired, true);
    assert.equal(calls.filter((c) => c.method === "repair").length, 1);
    assert.ok(calls.some((c) => c.method === "check"));
    assert.deepEqual(
      calls.map((call) => call.method),
      ["repair", "check"],
    );
  });

  test("13. drifted repair touches only the selected channel", async () => {
    const { service, calls, state } = makeFake({
      stable: { installed: true, healthy: true },
      canary: { installed: true, healthy: false },
    });
    const result = await runRepairFlow(service, "canary");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.repaired, true);
    const repairs = calls.filter((c) => c.method === "repair");
    assert.equal(repairs.length, 1);
    assert.deepEqual(repairs[0]?.channels, ["canary"]);
    assert.equal((state["stable"] as FakeState).healthy, true);
    assert.equal((state["canary"] as FakeState).healthy, true);
  });

  test("15. uninstall always uses purge=false", async () => {
    const { service, calls } = makeFake({
      canary: { installed: true, healthy: true },
    });
    const result = await runUninstallFlow(service, "canary");
    assert.equal(result.ok, true);
    const uninstalls = calls.filter((c) => c.method === "uninstall");
    assert.equal(uninstalls.length, 1);
    assert.deepEqual(uninstalls[0]?.channels, ["canary"]);
    assert.equal(uninstalls[0]?.purge, false);
  });
});
