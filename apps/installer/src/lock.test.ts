import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withInstallLock } from "./lock.js";

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "vestra-lock-test-"),
  );
  try {
    await run(home);
  } finally {
    await fs.promises.rm(home, { recursive: true, force: true });
  }
}

test("nested calls for the same home run directly", async () => {
  await withHome(async (home) => {
    const result = await withInstallLock(home, () =>
      withInstallLock(home, async () => "inner"),
    );
    assert.equal(result, "inner");
  });
});

test("a concurrent top-level call is rejected", async () => {
  await withHome(async (home) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const first = withInstallLock(home, async () => {
      entered();
      await gate;
    });
    await started;
    await assert.rejects(
      () => withInstallLock(home, async () => {}),
      new Error(
        "Another installation operation is running. Try again shortly.",
      ),
    );
    release();
    await first;
  });
});

test("the lock is released after an operation throws", async () => {
  await withHome(async (home) => {
    await assert.rejects(
      () =>
        withInstallLock(home, async () => {
          throw new Error("fixture failure");
        }),
      /fixture failure/,
    );
    await withInstallLock(home, async () => {});
  });
});
