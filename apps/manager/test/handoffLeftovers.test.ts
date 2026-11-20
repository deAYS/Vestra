import { test, mock } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

mock.module("electron", () => ({
  app: { getVersion: () => "1.0.0", isPackaged: false, getPath: () => "" },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle() {} },
}));
const { ManagerUpdates } = await import("../src/main/updates.js");

async function setup(pending?: Record<string, unknown>, error?: string) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-handoff-"));
  const dir = path.join(home, "updates");
  await fs.mkdir(dir, { recursive: true });
  if (pending)
    await fs.writeFile(path.join(dir, "pending.json"), JSON.stringify(pending));
  if (error) await fs.writeFile(path.join(dir, "handoff-error.txt"), error);
  const updates = new ManagerUpdates(
    { context: { homeDir: home } } as never,
    {} as never,
    { version: "1.0.0", supported: false },
  );
  return { home, dir, updates };
}
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

test("an expired pending handoff is deleted at boot and check still runs", async () => {
  const { home, dir, updates } = await setup({
    token: "t",
    version: "1.0.0",
    created: Date.now() - 25 * 60 * 60 * 1000,
    channels: [],
  });
  try {
    await updates.finish();
    assert.equal(await exists(path.join(dir, "pending.json")), false);
    assert.equal((await updates.check()).phase, "idle");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("a handoff error is shown once and gone on the next boot", async () => {
  const { home, dir, updates } = await setup(
    {
      token: "t",
      version: "0.0.1",
      created: Date.now(),
      channels: [],
    },
    "Update checksum changed. Update cancelled.",
  );
  try {
    await updates.finish();
    assert.equal(updates.snapshot().phase, "error");
    assert.match(updates.snapshot().message ?? "", /checksum changed/);
    assert.equal(await exists(path.join(dir, "pending.json")), false);
    assert.equal(await exists(path.join(dir, "handoff-error.txt")), false);
    const next = new ManagerUpdates(
      { context: { homeDir: home } } as never,
      {} as never,
      { version: "1.0.0", supported: false },
    );
    await next.finish();
    assert.notEqual(next.snapshot().phase, "error");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
