import { test } from "node:test";
import assert from "node:assert/strict";
import { ToastManager } from "./api/toasts.js";
const wait = (time: number) =>
  new Promise((resolve) => setTimeout(resolve, time));
test("hover pauses the one dismissal clock and resume keeps the remaining duration", async () => {
  const manager = new ToastManager();
  try {
    const id = manager.info("Pause me", undefined, 120);
    await wait(25);
    manager.pause(id);
    manager.pause(id);
    const remaining = manager.remainingMs(id);
    assert.ok(remaining > 0 && remaining <= 120);
    await wait(160);
    assert.equal(manager.list().length, 1);
    assert.equal(manager.remainingMs(id), remaining);
    manager.resume(id);
    manager.resume(id);
    await wait(150);
    assert.equal(manager.list().length, 0);
  } finally {
    manager.clear();
  }
});
test("clearing paused notifications and overflowing sticky cards cannot resurrect them", async () => {
  const manager = new ToastManager();
  const id = manager.info("Cleared", undefined, 20);
  manager.pause(id);
  manager.clear();
  manager.resume(id);
  assert.equal(manager.list().length, 0);
  for (let i = 0; i < 6; i++) manager.info(String(i), undefined, 0);
  assert.equal(manager.list().length, 4);
  await wait(30);
  assert.equal(manager.list().length, 4);
  manager.clear();
});
