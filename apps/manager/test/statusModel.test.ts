// Manager status model: cheap status() is never authoritative.
// Shallow-installed cards render Installed/Checking, never Healthy.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDeepResult,
  cardFromShallow,
  cardStateFromDeepHealth,
  formatShortDate,
  formatStartedAt,
  lastReinstall,
  recoverySubline,
  rowModel,
  rowStatusText,
  startFailureText,
  type CardModel,
  type RowModel,
} from "../src/shared/statusModel.js";
import type { InstallStatus } from "../src/shared/types.js";
import type { RunState } from "@vestra/shared";
import type { ChannelRecovery } from "../src/shared/recovery.js";

function shallow(overrides: Partial<InstallStatus> = {}): InstallStatus {
  return {
    installation: {
      channel: "canary",
      version: "1.0.1156",
      rootDir: "/fake",
      appDir: "/fake/app",
      asarPath: "/fake/app.asar",
      isActive: true,
    },
    health: "healthy",
    vestraInstalled: true,
    repairable: false,
    detail: "installed (not deep-verified)",
    ...overrides,
  };
}

describe("status model", () => {
  test("7. shallow installed renders Installed/Checking, NOT Healthy", () => {
    const card = cardFromShallow(shallow());
    assert.equal(card.state, "installed-checking");
    assert.notEqual(card.state, "healthy");
  });

  test("6. not-installed card renders Not installed", () => {
    const card = cardFromShallow(
      shallow({ health: "not-installed", vestraInstalled: false, repairable: true }),
    );
    assert.equal(card.state, "not-installed");
  });

  test("8. deep check success becomes Healthy", () => {
    assert.equal(cardStateFromDeepHealth("healthy"), "healthy");
    const base: CardModel = { channel: "canary", version: "1.0.1156", state: "installed-checking" };
    const next = applyDeepResult(base, shallow({ health: "healthy" }));
    assert.equal(next.state, "healthy");
  });

  test("9. deep check drift becomes Needs Repair", () => {
    assert.equal(cardStateFromDeepHealth("drifted"), "needs-repair");
    assert.equal(cardStateFromDeepHealth("stale"), "needs-repair");
    const base: CardModel = { channel: "canary", version: "1.0.1156", state: "installed-checking" };
    const next = applyDeepResult(
      base,
      shallow({ health: "drifted", detail: "asar drifted", code: "verification-failed" }),
    );
    assert.equal(next.state, "needs-repair");
    assert.equal(next.detail, "asar drifted");
  });

  test("deep error becomes Check failed; not-installed stays Not installed", () => {
    assert.equal(cardStateFromDeepHealth("error"), "check-failed");
    assert.equal(cardStateFromDeepHealth("not-installed"), "not-installed");
  });

  test("missing deep result leaves the card untouched", () => {
    const base: CardModel = { channel: "stable", version: null, state: "installed-checking" };
    assert.deepEqual(applyDeepResult(base, undefined), base);
  });
});

// ---------------------------------------------------------------------------
// Row model: one truthful line per Discord install.
// ---------------------------------------------------------------------------

const AT = new Date(2026, 10, 20, 14, 41).getTime();

function card(
  state: CardModel["state"],
  version: string | null = "1.0.9",
): CardModel {
  return { channel: "stable", version, state, detail: "C:\\private\\path detail" };
}

const active: RunState = { kind: "active", at: AT };
const waiting: ChannelRecovery = {
  phase: "waiting-for-exit",
  version: "1.0.9",
  at: AT,
  attempts: 0,
};

describe("row model", () => {
  const cases: Array<{
    name: string;
    card: CardModel;
    run?: RunState;
    recovery?: ChannelRecovery;
    want: Partial<RowModel> & { state: RowModel["state"] };
  }> = [
    {
      name: "not installed",
      card: card("not-installed"),
      want: { state: "not-installed", primary: "install", installed: false },
    },
    {
      name: "checking",
      card: card("installed-checking"),
      run: active,
      want: { state: "checking", installed: true },
    },
    {
      name: "needs repair",
      card: card("needs-repair"),
      run: active,
      want: { state: "needs-repair", primary: "repair", installed: true },
    },
    {
      name: "check failed",
      card: card("check-failed"),
      run: active,
      want: { state: "check-failed", primary: "retry", installed: true },
    },
    {
      name: "active",
      card: card("healthy"),
      run: active,
      want: { state: "active", installed: true, startedAt: AT },
    },
    {
      name: "awaiting login",
      card: card("healthy"),
      run: { kind: "awaiting-login" },
      want: { state: "awaiting-login", installed: true },
    },
    {
      name: "not started",
      card: card("healthy"),
      run: { kind: "not-started" },
      want: { state: "not-started", installed: true },
    },
    {
      name: "no run status is neutral, never active",
      card: card("healthy"),
      want: { state: "not-started", installed: true },
    },
    {
      name: "didn't start (window not recognized)",
      card: card("healthy"),
      run: { kind: "failed", at: AT, reason: "untrusted-url" },
      want: {
        state: "didnt-start",
        primary: "repair",
        detail: "Discord's window wasn't recognized",
        installed: true,
      },
    },
    {
      name: "didn't start (bootstrap error)",
      card: card("healthy"),
      run: { kind: "failed", at: AT, reason: "bootstrap-error" },
      want: {
        state: "didnt-start",
        primary: "repair",
        detail: "Vestra failed while loading",
        installed: true,
      },
    },
    {
      name: "waiting-restart beats active",
      card: card("healthy"),
      run: active,
      recovery: waiting,
      want: { state: "waiting-restart", primary: "restart", installed: true },
    },
    {
      name: "needs-repair beats waiting-restart",
      card: card("needs-repair"),
      run: active,
      recovery: waiting,
      want: { state: "needs-repair", primary: "repair" },
    },
    {
      name: "checking beats waiting-restart",
      card: card("installed-checking"),
      recovery: waiting,
      want: { state: "checking" },
    },
    {
      name: "check-failed beats waiting-restart",
      card: card("check-failed"),
      recovery: waiting,
      want: { state: "check-failed", primary: "retry" },
    },
    {
      name: "unpatched new version waiting for exit shows waiting-restart",
      card: card("not-installed", "1.0.9"),
      recovery: waiting,
      want: { state: "waiting-restart", primary: "restart", installed: false },
    },
    {
      name: "waiting record for another version leaves Not installed",
      card: card("not-installed", "1.0.10"),
      recovery: waiting,
      want: { state: "not-installed", primary: "install" },
    },
    {
      name: "waiting record without a version leaves Not installed",
      card: card("not-installed", "1.0.9"),
      recovery: { phase: "waiting-for-exit", at: AT, attempts: 0 },
      want: { state: "not-installed", primary: "install" },
    },
    {
      name: "unknown card version never matches a waiting record",
      card: card("not-installed", null),
      recovery: waiting,
      want: { state: "not-installed", primary: "install" },
    },
    {
      name: "patched recovery does not change an active row",
      card: card("healthy"),
      run: active,
      recovery: { phase: "patched", version: "1.0.9", at: AT, attempts: 0 },
      want: { state: "active" },
    },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const row = rowModel(c.card, c.run, c.recovery);
      for (const [key, value] of Object.entries(c.want))
        assert.deepEqual(row[key as keyof RowModel], value, `${c.name}: ${key}`);
      if (!("primary" in c.want))
        assert.equal("primary" in row, false, `${c.name}: no primary`);
      assert.equal(row.channel, "stable");
      assert.equal(row.version, c.card.version);
    });
  }

  test("raw card detail (paths, messages) never reaches the row", () => {
    for (const state of [
      "not-installed",
      "installed-checking",
      "healthy",
      "needs-repair",
      "check-failed",
    ] as const) {
      const row = rowModel(card(state), undefined, undefined);
      assert.equal(row.detail, undefined, state);
    }
  });

  test("start failure reasons map to plain text with a safe fallback", () => {
    for (const reason of ["untrusted-url", "subframe", "no-frame", "no-sender"])
      assert.equal(startFailureText(reason), "Discord's window wasn't recognized");
    assert.equal(startFailureText("bootstrap-error"), "Vestra failed while loading");
    assert.equal(startFailureText("unknown"), "Vestra failed while loading");
    assert.equal(startFailureText("some-new-code"), "Vestra failed while loading");
  });

  test("status copy is exact for every state", () => {
    const now = new Date(2026, 10, 20, 18, 0);
    const base = { channel: "stable" as const, version: "1.0.9", installed: true };
    const expected: Array<[RowModel, string]> = [
      [{ ...base, state: "active", startedAt: AT }, "Vestra active · started today 14:41"],
      [
        { ...base, state: "didnt-start", primary: "repair", detail: "Vestra failed while loading" },
        "Installed, but didn't start — Vestra failed while loading",
      ],
      [{ ...base, state: "awaiting-login" }, "Installed · starts after you log in to Discord"],
      [{ ...base, state: "not-started" }, "Installed · will start next time Discord opens"],
      [{ ...base, state: "waiting-restart", primary: "restart" }, "Waiting for Discord restart"],
      [{ ...base, state: "needs-repair", primary: "repair" }, "Needs repair"],
      [{ ...base, state: "checking" }, "Checking…"],
      [{ ...base, state: "check-failed", primary: "retry" }, "Couldn't check"],
      [{ ...base, installed: false, state: "not-installed", primary: "install" }, "Not installed"],
    ];
    for (const [row, copy] of expected) assert.equal(rowStatusText(row, now), copy);
  });

  test("started time reads today / yesterday / a short date", () => {
    const now = new Date(2026, 10, 20, 18, 0);
    assert.equal(formatStartedAt(new Date(2026, 10, 20, 9, 5).getTime(), now), "today 09:05");
    assert.equal(formatStartedAt(new Date(2026, 10, 19, 23, 59).getTime(), now), "yesterday 23:59");
    assert.equal(formatStartedAt(new Date(2026, 10, 18, 8, 0).getTime(), now), "Nov 18");
    assert.equal(formatStartedAt(new Date(2025, 0, 3, 8, 0).getTime(), now), "Jan 3, 2025");
    assert.equal(formatShortDate(new Date(2026, 10, 18).getTime(), now), "Nov 18");
    assert.equal(formatShortDate(new Date(2025, 11, 31).getTime(), now), "Dec 31, 2025");
  });

  test("footer sub-line shows the latest patched re-install only", () => {
    const now = new Date(2026, 10, 20, 18, 0);
    assert.equal(lastReinstall({}), undefined);
    assert.equal(
      lastReinstall({
        stable: { phase: "waiting-for-exit", version: "1.0.9", at: AT, attempts: 0 },
      }),
      undefined,
    );
    assert.equal(
      lastReinstall({ stable: { phase: "patched", at: AT, attempts: 0 } }),
      undefined,
      "a patched record without a version has nothing to say",
    );
    const stableAt = new Date(2026, 10, 18).getTime();
    const latest = lastReinstall({
      stable: { phase: "patched", version: "1.0.9269", at: stableAt, attempts: 0 },
      canary: {
        phase: "patched",
        version: "1.0.1347",
        at: new Date(2026, 10, 12).getTime(),
        attempts: 0,
      },
    });
    assert.deepEqual(latest, { version: "1.0.9269", at: stableAt });
    assert.equal(recoverySubline(latest!, now), "Last re-installed into 1.0.9269 · Nov 18");
  });
});
