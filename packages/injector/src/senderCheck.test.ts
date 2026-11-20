import assert from "node:assert/strict";
import test from "node:test";
import { senderRejection } from "./senderCheck.js";

const good = (url: string) => url === "https://discord.com/channels/@me";
const url = "https://discord.com/channels/@me";

test("trusted main frame passes", () => {
  const frame = { url, parent: null };
  assert.equal(senderRejection({ senderFrame: frame, sender: { mainFrame: frame } }, good), null);
});

test("different frame object identity with parent null passes", () => {
  assert.equal(
    senderRejection(
      { senderFrame: { url, parent: null }, sender: { mainFrame: { url, parent: null } } },
      good,
    ),
    null,
  );
});

test("null senderFrame with matching ids falls back to main frame", () => {
  const event = {
    senderFrame: null,
    processId: 4,
    frameId: 1,
    sender: { mainFrame: { url, parent: null, processId: 4, routingId: 1 } },
  };
  assert.equal(senderRejection(event, good), null);
});

test("null senderFrame with mismatched ids is no-frame", () => {
  const event = {
    senderFrame: null,
    processId: 4,
    frameId: 2,
    sender: { mainFrame: { url, parent: null, processId: 4, routingId: 1 } },
  };
  assert.equal(senderRejection(event, good), "no-frame");
});

test("subframe is rejected", () => {
  assert.equal(
    senderRejection({ senderFrame: { url, parent: {} }, sender: { mainFrame: {} } }, good),
    "subframe",
  );
});

test("untrusted url is rejected", () => {
  assert.equal(
    senderRejection({ senderFrame: { url: "https://evil.test/", parent: null }, sender: {} }, good),
    "untrusted-url",
  );
});

test("missing sender is rejected", () => {
  assert.equal(senderRejection({}, good), "no-sender");
  assert.equal(senderRejection(null, good), "no-sender");
});

test("throwing frame getter is no-frame", () => {
  const frame = {
    parent: null,
    get url(): string {
      throw new Error("destroyed");
    },
  };
  assert.equal(senderRejection({ senderFrame: frame, sender: {} }, good), "no-frame");
});
