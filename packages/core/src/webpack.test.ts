import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createWebpackFinder } from "./webpack/finder.js";
import { getWebpackRequire, onModulesRegistered, resetModuleRegistration } from "./webpack/raw.js";
import { waitForModule } from "./webpack/waitFor.js";
import { defineWrapper } from "./discord/wrappers.js";
import type { WebpackFinder } from "./webpack/index.js";

type Cache = Record<string, unknown>;

/**
 * A fake webpack require whose module cache carries a sentinel module: every
 * full scan reads the sentinel's `exports` exactly once, so `scans()` counts
 * full module-cache scans. Keyed hits and key-count checks never touch it.
 */
function fakeRequire(): { req: (() => void) & { c: Cache }; c: Cache; scans: () => number } {
  let scans = 0;
  const c: Cache = {};
  c["0"] = {
    get exports() {
      scans += 1;
      return { sentinel: true };
    },
  };
  const req = Object.assign(() => {}, { c });
  return { req, c, scans: () => scans };
}

/** Replace Date.now with a manual clock starting at a fixed base. */
function fakeNow() {
  const realNow = Date.now;
  const base = realNow();
  let offset = 0;
  Date.now = () => base + offset;
  return {
    advance(ms: number) {
      offset += ms;
    },
    /** Set the offset from the time the miss sequence started. */
    set(ms: number) {
      offset = ms;
    },
    restore() {
      Date.now = realNow;
    },
  };
}

const STASH = "__VESTRA_WEBPACK_REQUIRE__";
const CHUNK = "webpackChunkVestraWebpackTest";

/** Run `fn` with `req` stashed as the global webpack require; restores after. */
async function withStash<T>(req: unknown, fn: () => Promise<T> | T): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const saved = g[STASH];
  g[STASH] = req;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete g[STASH];
    else g[STASH] = saved;
  }
}

/**
 * A webpack-like chunk array: its own `push` registers factories and runs
 * them into the cache a microtask later (as webpack's chunk promises do).
 */
function installChunkArray(c: Cache): { array: unknown[]; pushes: () => number } {
  const g = globalThis as Record<string, unknown>;
  const array: unknown[] = [];
  let pushes = 0;
  array.push = function (this: unknown[], ...items: unknown[]): number {
    pushes += 1;
    for (const item of items) {
      const modules = (item as [unknown, Record<string, () => unknown>])[1];
      for (const [id, factory] of Object.entries(modules)) {
        void Promise.resolve().then(() => {
          c[id] = { exports: factory() };
        });
      }
    }
    return Array.prototype.push.apply(this, items);
  };
  g[CHUNK] = array;
  return { array, pushes: () => pushes };
}

function removeChunkArray(): void {
  delete (globalThis as Record<string, unknown>)[CHUNK];
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Registration state is module-wide: never let one test's hooks or timers leak.
afterEach(() => {
  resetModuleRegistration();
});

/** A logger that counts captured errors. */
function countingLogger(): { logger: ScopedLoggerLike; errors: () => number } {
  let errors = 0;
  const noop = (): void => {};
  const logger: ScopedLoggerLike = {
    scope: "Test",
    debug: noop,
    log: noop,
    info: noop,
    warn: noop,
    error: noop,
    captureError: () => {
      errors += 1;
    },
  };
  return { logger, errors: () => errors };
}

type ScopedLoggerLike = NonNullable<Parameters<typeof createWebpackFinder>[0]>["logger"] & object;

test("findByProps / findByDisplayName / findStore scan the module cache once per key", () => {
  const { req, c, scans } = fakeRequire();
  const ab = { a: 1, b: 2 };
  c["5"] = { exports: ab };
  c["6"] = { exports: { displayName: "Popout" } };
  c["7"] = { exports: { getName: () => "UserStore", subscribe: () => {} } };
  const finder = createWebpackFinder({ source: () => req });

  for (let i = 0; i < 100; i++) assert.equal(finder.findByProps("a", "b"), ab);
  assert.equal(scans(), 1, "100 findByProps calls cost one full scan");
  finder.findByProps("b", "a");
  assert.equal(scans(), 1, "prop order shares the key");

  for (let i = 0; i < 100; i++) assert.equal(finder.findByDisplayName("Popout")?.["displayName"], "Popout");
  assert.equal(scans(), 2);
  for (let i = 0; i < 100; i++) assert.equal(typeof finder.findStore("UserStore")?.["getName"], "function");
  assert.equal(scans(), 3);

  assert.throws(() => finder.findByProps(), /at least one prop/);
  assert.throws(() => finder.findByDisplayName(""), /non-empty name/);
  assert.throws(() => finder.findStore(""), /non-empty name/);
});

test("a cached id is re-validated: replaced exports are re-read, stale ids rescan", () => {
  const { req, c, scans } = fakeRequire();
  c["5"] = { exports: { a: 1, b: 2 } };
  const finder = createWebpackFinder({ source: () => req });
  assert.equal(finder.findByProps("a", "b")?.["a"], 1);
  assert.equal(scans(), 1);

  const replaced = { a: 3, b: 4 };
  c["5"] = { exports: replaced };
  assert.equal(finder.findByProps("a", "b"), replaced, "same id, new exports: re-read without a scan");
  assert.equal(scans(), 1);

  const moved = { a: 5, b: 6 };
  c["5"] = { exports: { unrelated: true } };
  c["9"] = { exports: moved };
  assert.equal(finder.findByProps("a", "b"), moved, "stale id: full scan finds the new module");
  assert.equal(scans(), 2);
  assert.equal(finder.findByProps("a", "b"), moved);
  assert.equal(scans(), 2);

  delete c["9"];
  assert.equal(finder.findByProps("a", "b"), undefined, "a gone module is a miss");
});

test("find(filter) re-validates its cached id and clearCache drops every entry", () => {
  const { req, c, scans } = fakeRequire();
  c["5"] = { exports: { default: { marker: 1 } } };
  const finder = createWebpackFinder({ source: () => req });
  const filter = (e: Record<string, unknown>): boolean => e["marker"] === 1;
  const first = finder.find(filter);
  assert.equal(first, (c["5"] as { exports: { default: unknown } }).exports.default, "a .default match returns the default object");
  assert.equal(finder.find(filter), first);
  assert.equal(scans(), 1);

  c["5"] = { exports: { default: { marker: 2 } } };
  assert.equal(finder.find(filter), undefined, "stale cached exports are not returned");
  assert.equal(scans(), 2);

  c["5"] = { exports: { marker: 1 } };
  finder.find(filter);
  finder.findByProps("marker");
  const before = scans();
  finder.clearCache();
  finder.find(filter);
  finder.findByProps("marker");
  assert.equal(scans(), before + 2, "clearCache forgets filter and keyed entries");
});

test("a waiter wakes on chunk registration and does not scan while idle", async () => {
  const { req, c, scans } = fakeRequire();
  const { array } = installChunkArray(c);
  try {
    await withStash(req, async () => {
      const finder = createWebpackFinder({ source: () => req });
      const isLate = (e: Record<string, unknown>): boolean => e["late"] === true;
      const pending = finder.waitFor(isLate, { timeoutMs: 5_000 });
      assert.equal(scans(), 1, "one immediate check");
      await delay(700);
      assert.equal(scans(), 1, "no polling scans while nothing registers");

      let resolved: unknown = "pending";
      void pending.then((v) => {
        resolved = v;
      });
      array.push([["late-chunk"], { "42": () => ({ late: true }) }]);
      await delay(30);
      assert.deepEqual(resolved, { late: true }, "resolved within one registration event");
      assert.equal(scans(), 2);
      assert.equal(finder.find(isLate), resolved, "the waiter's result is cached");
      assert.equal(scans(), 2);
    });
  } finally {
    removeChunkArray();
  }
});

test("the chunk push hook calls through, keeps return values, and uninstalls cleanly", async () => {
  const { req, c } = fakeRequire();
  const { array, pushes } = installChunkArray(c);
  const original = array.push;
  try {
    await withStash(req, async () => {
      let events = 0;
      const off = onModulesRegistered(() => {
        events += 1;
      });
      assert.notEqual(array.push, original, "push is wrapped while a listener exists");
      const result = array.push([["a"], {}], [["b"], {}]);
      assert.equal(result, 2, "the original push's return value is kept");
      assert.equal(pushes(), 1);
      assert.equal(array.length, 2);
      array.push([["c"], {}]);
      await delay(10);
      assert.equal(events, 1, "pushes in one task coalesce into one event");

      const off2 = onModulesRegistered(() => {});
      off();
      assert.notEqual(array.push, original, "still wrapped while another listener exists");
      off2();
      assert.equal(array.push, original, "the last listener restores the original push");

      // Someone wraps on top of us: our wrapper stays as an inert pass-through.
      const off3 = onModulesRegistered(() => {
        events += 1;
      });
      const ours = array.push;
      const foreign = function (this: unknown[], ...items: unknown[]): number {
        return (ours as (...args: unknown[]) => number).apply(this, items);
      };
      array.push = foreign;
      off3();
      assert.equal(array.push, foreign, "a foreign wrapper on top is never removed");
      const before = events;
      array.push([["d"], {}]);
      await delay(10);
      assert.equal(events, before, "no listeners, no events");
      assert.equal(pushes(), 3, "calls still reach the original push");

      const off4 = onModulesRegistered(() => {
        events += 1;
      });
      array.push([["e"], {}]);
      await delay(10);
      assert.equal(events, before + 1, "the retained wrapper is reused, not stacked");
      assert.equal(pushes(), 4, "one call per push, never doubled");
      off4();
    });
  } finally {
    removeChunkArray();
  }
});

test("Vestra's own require-capture push does not wake waiters", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g[STASH];
  delete g[STASH];
  const array: unknown[] = [];
  array.push = function (this: unknown[], ...items: unknown[]): number {
    return Array.prototype.push.apply(this, items);
  };
  g[CHUNK] = array;
  let events = 0;
  const off = onModulesRegistered(() => {
    events += 1;
  });
  try {
    getWebpackRequire();
    getWebpackRequire();
    // Another Vestra instance (its own module state) capturing through our wrapper.
    array.push([["vestra-123-other"], {}, () => {}]);
    await delay(10);
    assert.equal(events, 0);
    array.push([["real-chunk"], {}]);
    await delay(10);
    assert.equal(events, 1, "real chunks still wake listeners");
  } finally {
    off();
    removeChunkArray();
    if (saved !== undefined) g[STASH] = saved;
  }
});

test("without a chunk array a shared fallback poll wakes waiters only when modules change", async () => {
  const { req, c, scans } = fakeRequire();
  await withStash(req, async () => {
    const finder = createWebpackFinder({ source: () => req });
    const first = finder.waitFor((e) => e["slow"] === 1, { timeoutMs: 5_000 });
    const second = finder.waitFor((e) => e["slow"] === 2, { timeoutMs: 5_000 });
    assert.equal(scans(), 2);
    await delay(600);
    assert.equal(scans(), 2, "an unchanged module cache triggers no scans");
    c["50"] = { exports: { slow: 1 } };
    c["51"] = { exports: { slow: 2 } };
    const started = Date.now();
    assert.deepEqual(await first, { slow: 1 });
    assert.deepEqual(await second, { slow: 2 });
    assert.ok(Date.now() - started < 600, "found by the next poll tick");
  });
});

test("modules executed after their chunk was registered are still found", async () => {
  const { req, c } = fakeRequire();
  const { array } = installChunkArray(c);
  try {
    await withStash(req, async () => {
      const finder = createWebpackFinder({ source: () => req });
      const pending = finder.waitFor((e) => e["lazy"] === true, { timeoutMs: 5_000 });
      array.push([["empty"], {}]);
      await delay(20);
      c["77"] = { exports: { lazy: true } }; // required later, no push
      assert.deepEqual(await pending, { lazy: true });
    });
  } finally {
    removeChunkArray();
  }
});

test("waitForModule keeps its timeout, abort and validation semantics", async () => {
  const noEvents = (): (() => void) => () => {};
  assert.equal(await waitForModule(() => undefined, () => false, { timeoutMs: 40 }, undefined, noEvents), undefined);
  let searches = 0;
  const late = waitForModule(() => {
    searches += 1;
    return searches >= 2 ? { ok: true } : undefined;
  }, () => true, { timeoutMs: 40 }, undefined, noEvents);
  assert.deepEqual(await late, { ok: true }, "a final check runs at the deadline");

  const controller = new AbortController();
  const started = Date.now();
  const aborted = waitForModule(() => undefined, () => false, { timeoutMs: 5_000, signal: controller.signal }, undefined, noEvents);
  setTimeout(() => controller.abort(), 20);
  assert.equal(await aborted, undefined);
  assert.ok(Date.now() - started < 1_000, "abort resolves promptly");

  const forever = new AbortController();
  let foreverResult: unknown = "pending";
  const endless = waitForModule(() => undefined, () => false, { timeoutMs: Infinity, signal: forever.signal }, undefined, noEvents);
  void endless.then((v) => {
    foreverResult = v;
  });
  await delay(30);
  assert.equal(foreverResult, "pending", "timeoutMs: Infinity waits until aborted");
  forever.abort();
  assert.equal(await endless, undefined);

  let subscribed = 0;
  let unsubscribed = 0;
  await waitForModule(() => ({ now: true }), () => true, undefined, undefined, () => {
    subscribed += 1;
    return () => {
      unsubscribed += 1;
    };
  });
  assert.equal(subscribed, 0, "an immediate hit never subscribes");
  assert.equal(unsubscribed, 0);

  let listener: (() => void) | undefined;
  let found: Record<string, unknown> | undefined;
  const woken = waitForModule(() => found, () => true, { timeoutMs: 5_000 }, undefined, (l) => {
    listener = l;
    return () => {
      unsubscribed += 1;
    };
  });
  found = { woke: true };
  listener?.();
  assert.deepEqual(await woken, { woke: true });
  assert.equal(unsubscribed, 1, "the waiter unsubscribes once resolved");

  await assert.rejects(waitForModule(() => undefined, () => false, { timeoutMs: 0 }), /timeoutMs > 0/);
  await assert.rejects(waitForModule(() => undefined, () => false, { intervalMs: 0 }), /intervalMs > 0/);
});

test("a wrapper miss is not cached: the next access resolves the registered module", () => {
  const { req, c } = fakeRequire();
  const finder = createWebpackFinder({ source: () => req });
  let resolves = 0;
  const wrapper = defineWrapper("Probe", {
    finder,
    resolve: (f) => {
      resolves += 1;
      return f.findByProps("probe");
    },
  });
  const clock = fakeNow();
  try {
    assert.equal(wrapper.get(), undefined);
    assert.equal(wrapper.isAvailable(), false);
    c["8"] = { exports: { probe: true } };
    clock.advance(100);
    assert.deepEqual(wrapper.get(), { probe: true }, "picked up at the next module count check");
  } finally {
    clock.restore();
  }
  const count = resolves;
  wrapper.get();
  assert.equal(resolves, count, "a hit is settled");
  wrapper.reset();
  wrapper.get();
  assert.equal(resolves, count + 1);
});

test("a permanent wrapper miss costs at most one scan until modules change or a second passes", () => {
  const { req, c, scans } = fakeRequire();
  const finder = createWebpackFinder({ source: () => req });
  let resolves = 0;
  const wrapper = defineWrapper("Missing", {
    finder,
    resolve: (f) => {
      resolves += 1;
      return f.findByProps("neverThere");
    },
  });
  const clock = fakeNow();
  try {
    for (let i = 0; i < 100; i++) assert.equal(wrapper.get(), undefined);
    for (let i = 0; i < 100; i++) assert.equal(wrapper.isAvailable(), false);
    assert.ok(scans() <= 1, `100 misses cost ${scans()} scans`);
    assert.equal(resolves, 1);

    c["9"] = { exports: { unrelated: true } };
    clock.advance(100);
    wrapper.get();
    assert.equal(resolves, 2, "a module count change re-resolves");
    wrapper.get();
    assert.equal(resolves, 2);

    clock.advance(1_000);
    wrapper.get();
    assert.equal(resolves, 3, "a miss older than 1 s re-resolves");

    wrapper.reset();
    wrapper.get();
    assert.equal(resolves, 4, "reset clears the miss memo");
  } finally {
    clock.restore();
  }
});

test("a wrapper miss checks the module count at most every 100 ms and backs off to 30 s", () => {
  let size = 10;
  let sizeChecks = 0;
  let resolves = 0;
  const finder = {
    getModuleCacheSize: () => {
      sizeChecks += 1;
      return size;
    },
  } as unknown as WebpackFinder;
  const wrapper = defineWrapper("Backoff", {
    finder,
    resolve: () => {
      resolves += 1;
      return undefined;
    },
  });
  const clock = fakeNow();
  try {
    wrapper.get();
    const checks = sizeChecks;
    for (let i = 0; i < 50; i++) wrapper.get();
    clock.advance(99);
    wrapper.get();
    assert.equal(sizeChecks, checks, "no count check within 100 ms of the last one");
    clock.advance(1);
    wrapper.get();
    assert.equal(sizeChecks, checks + 1, "one count check after 100 ms");
    assert.equal(resolves, 1);

    // Time-based retries of the unchanged miss: 1 s, 2 s, 4 s, 8 s, 16 s, then 30 s.
    clock.set(0);
    const retries: number[] = [];
    for (let at = 0; at <= 100_000; at += 100) {
      clock.set(at);
      const before = resolves;
      wrapper.get();
      if (resolves > before) retries.push(at);
    }
    assert.deepEqual(retries.slice(0, 7), [1_000, 3_000, 7_000, 15_000, 31_000, 61_000, 91_000]);

    // A module count change retries at once and restarts the delay at 1 s.
    size += 1;
    clock.advance(100);
    const before = resolves;
    wrapper.get();
    assert.equal(resolves, before + 1, "a count change re-resolves");
    clock.advance(999);
    wrapper.get();
    assert.equal(resolves, before + 1);
    clock.advance(1);
    wrapper.get();
    assert.equal(resolves, before + 2, "the delay is 1 s again");

    // reset() restarts it too.
    clock.advance(2_000);
    wrapper.get();
    wrapper.reset();
    wrapper.get();
    const afterReset = resolves;
    clock.advance(1_000);
    wrapper.get();
    assert.equal(resolves, afterReset + 1, "reset restarts the delay at 1 s");
  } finally {
    clock.restore();
  }
});

test("a finder without a module count keeps the 1 s retry", () => {
  let resolves = 0;
  const wrapper = defineWrapper("NoCount", {
    finder: {} as unknown as WebpackFinder,
    resolve: () => {
      resolves += 1;
      return undefined;
    },
  });
  const clock = fakeNow();
  try {
    wrapper.get();
    for (let i = 1; i <= 5; i++) {
      clock.advance(1_000);
      wrapper.get();
      assert.equal(resolves, i + 1, `retry ${i} after 1 s`);
    }
  } finally {
    clock.restore();
  }
});

test("a cached hit is not lost to a throwing default getter", () => {
  const { req, c, scans } = fakeRequire();
  const { logger, errors } = countingLogger();
  const exports = {
    marker: 1,
    get default(): unknown {
      throw new Error("blocked default");
    },
  };
  c["5"] = { exports };
  const finder = createWebpackFinder({ source: () => req, logger });
  const filter = (e: Record<string, unknown>): boolean => e["marker"] === 1;
  for (let i = 0; i < 100; i++) assert.equal(finder.find(filter), exports);
  assert.equal(scans(), 1, "hits re-validate the top-level exports without a rescan");
  assert.equal(errors(), 0, "no error logged per hit");
});

test("prop names containing commas never share a key with separate names", () => {
  const { req, c, scans } = fakeRequire();
  const joined = { "a,b": 1 };
  const separate = { a: 1, b: 2 };
  c["5"] = { exports: joined };
  c["6"] = { exports: separate };
  const finder = createWebpackFinder({ source: () => req });
  for (let i = 0; i < 50; i++) {
    assert.equal(finder.findByProps("a,b"), joined);
    assert.equal(finder.findByProps("a", "b"), separate);
  }
  assert.equal(scans(), 2, "one scan per distinct key");
});
