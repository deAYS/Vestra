// Manager status model: cheap status() is never authoritative.
// Shallow-installed cards render Installed/Checking, never Healthy.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDeepResult,
  cardFromShallow,
  cardStateFromDeepHealth,
  type CardModel,
} from "../src/shared/statusModel.js";
import type { InstallStatus } from "../src/shared/types.js";

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
