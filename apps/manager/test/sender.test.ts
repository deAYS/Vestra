import { test } from "node:test";
import assert from "node:assert/strict";
import { isManagerSender } from "../src/main/sender.js";

test("Manager native methods only accept its bundled main frame", () => {
  const expected = "file:///C:/Vestra/dist/renderer/index.html";
  const frame = { url: expected };
  assert.equal(isManagerSender({ senderFrame: frame, sender: { mainFrame: frame } }, expected), true);
  for (const url of ["https://evil.test", "file:///C:/other/index.html", expected + "?external=1"]) {
    const bad = { url };
    assert.equal(isManagerSender({ senderFrame: bad, sender: { mainFrame: bad } }, expected), false);
  }
  assert.equal(isManagerSender({ senderFrame: { url: expected }, sender: { mainFrame: frame } }, expected), false);
});
