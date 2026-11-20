import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveRunState,
  parseStartStatus,
  startStatusFilename,
  START_REASON_MAX,
} from "./startStatus.js";

const rec = (v: string, at: number) => ({
  at,
  discordVersion: v,
  vestraVersion: "0.1.0",
});

test("empty file is not-started", () => {
  assert.deepEqual(deriveRunState({}, "1.0.9"), { kind: "not-started" });
});

test("null installed version is not-started", () => {
  assert.deepEqual(
    deriveRunState({ launch: rec("1.0.9", 10), start: { ...rec("1.0.9", 11), ok: true } }, null),
    { kind: "not-started" },
  );
});

test("launch then ok start is active", () => {
  assert.deepEqual(
    deriveRunState({ launch: rec("1.0.9", 10), start: { ...rec("1.0.9", 11), ok: true } }, "1.0.9"),
    { kind: "active", at: 11 },
  );
});

test("stale start with newer launch is awaiting-login", () => {
  assert.deepEqual(
    deriveRunState({ launch: rec("1.0.9", 20), start: { ...rec("1.0.9", 11), ok: true } }, "1.0.9"),
    { kind: "awaiting-login" },
  );
});

test("start for another version is not-started", () => {
  assert.deepEqual(
    deriveRunState({ start: { ...rec("1.0.8", 11), ok: true } }, "1.0.9"),
    { kind: "not-started" },
  );
});

test("ok start with launch of an older version is active", () => {
  assert.deepEqual(
    deriveRunState({ launch: rec("1.0.8", 50), start: { ...rec("1.0.9", 11), ok: true } }, "1.0.9"),
    { kind: "active", at: 11 },
  );
});

test("failed start reports reason", () => {
  assert.deepEqual(
    deriveRunState(
      {
        launch: rec("1.0.9", 10),
        start: { ...rec("1.0.9", 12), ok: false, reason: "untrusted-url" },
      },
      "1.0.9",
    ),
    { kind: "failed", at: 12, reason: "untrusted-url" },
  );
});

test("failed start without reason uses unknown", () => {
  assert.deepEqual(
    deriveRunState({ start: { ...rec("1.0.9", 12), ok: false } }, "1.0.9"),
    { kind: "failed", at: 12, reason: "unknown" },
  );
});

test("launch only is awaiting-login for installed version", () => {
  assert.deepEqual(deriveRunState({ launch: rec("1.0.9", 10) }, "1.0.9"), {
    kind: "awaiting-login",
  });
  assert.deepEqual(deriveRunState({ launch: rec("1.0.8", 10) }, "1.0.9"), {
    kind: "not-started",
  });
});

test("parse never throws and drops invalid records", () => {
  assert.deepEqual(parseStartStatus("{not json"), {});
  assert.deepEqual(parseStartStatus('{"start":{"ok":"yes"}}'), {});
  assert.deepEqual(parseStartStatus(undefined), {});
  assert.deepEqual(parseStartStatus("[]"), {});
  assert.deepEqual(parseStartStatus("null"), {});
});

test("parse keeps valid records and truncates reason", () => {
  const long = "x".repeat(START_REASON_MAX + 50);
  const parsed = parseStartStatus(
    JSON.stringify({
      launch: rec("1.0.9", 1),
      start: { ...rec("1.0.9", 2), ok: false, reason: long },
    }),
  );
  assert.deepEqual(parsed.launch, rec("1.0.9", 1));
  assert.equal(parsed.start?.reason?.length, START_REASON_MAX);
});

test("status filename is posix per channel", () => {
  assert.equal(startStatusFilename("ptb"), "status/ptb.json");
});
