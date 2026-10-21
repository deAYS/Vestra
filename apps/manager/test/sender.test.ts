import { test } from "node:test";
import assert from "node:assert/strict";
import { isManagerSender } from "../src/main/sender.js";

test("Manager native methods only accept its bundled main frame", () => {
  const expected = "file:///C:/Vestra/dist/renderer/index.html";
  const frame = { url: expected };
  assert.equal(
    isManagerSender(
      { senderFrame: frame, sender: { mainFrame: frame } },
      expected,
    ),
    true,
  );
  for (const url of [
    "https://evil.test",
    "file:///C:/other/index.html",
    expected + "?external=1",
  ]) {
    const bad = { url };
    assert.equal(
      isManagerSender(
        { senderFrame: bad, sender: { mainFrame: bad } },
        expected,
      ),
      false,
    );
  }
  assert.equal(
    isManagerSender(
      { senderFrame: { url: expected }, sender: { mainFrame: frame } },
      expected,
    ),
    false,
  );
});

test("equivalent escaped file paths accept only the same bundled file", () => {
  const expected =
    "file:///C:/Users/RUNNER%7E1/Vestra/dist/renderer/index.html";
  const accept = (url: string): boolean => {
    const frame = { url };
    return isManagerSender(
      { senderFrame: frame, sender: { mainFrame: frame } },
      expected,
    );
  };
  assert.equal(accept(expected.replace("%7E", "~")), true);
  assert.equal(accept(expected.replace("%7E", "%7e") + "#updates"), true);
  for (const url of [
    expected + "?external=1",
    expected.replace("RUNNER%7E1", "other"),
    expected.replace("file:", "https:"),
    expected.replace("%7E", "%2F"),
    expected.replace("%7E", "%5C"),
    expected.replace("%7E", "%"),
  ])
    assert.equal(accept(url), false, url);
});
