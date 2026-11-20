import { Logger, type ScopedLogger } from "./logger.js";

/** Namespace every patch belongs to — a plugin name or patch group. */
export type PatchOwner = string;

/** Remove one installed hook. Idempotent, never throws. */
export type Unpatch = () => void;

/** Mutate `args` in place (or observe). Return value is ignored. */
export type BeforeHook = (args: unknown[], thisArg: unknown) => void;

/**
 * Observe/override the result. Return undefined to keep it; any other value
 * (including null) replaces it.
 */
export type AfterHook = (args: unknown[], result: unknown, thisArg: unknown) => unknown;

/**
 * Replace the call. Invoke `callOriginal` (optionally with new args) to run
 * the next `instead` hook, or the original when none remain.
 */
export type InsteadHook = (
  args: unknown[],
  callOriginal: (...args: unknown[]) => unknown,
  thisArg: unknown,
) => unknown;

type HookKind = "before" | "after" | "instead";

interface HookRecord {
  id: number;
  owner: PatchOwner;
  kind: HookKind;
  hook: BeforeHook | AfterHook | InsteadHook;
}

interface PatchedEntry {
  original: (...args: unknown[]) => unknown;
  hooks: HookRecord[];
  /** Put the target property back exactly as it was before wrapping. */
  restore: () => void;
}

/** Keys the wrapper sets explicitly instead of copying (or must never copy). */
const SKIPPED_STATIC_KEYS = new Set<string | symbol>(["length", "name", "prototype", "arguments", "caller"]);

/**
 * Make `wrapper` look like `original`: same name/length/prototype, the same
 * static properties (displayName, defaultProps, ...), the same static
 * inheritance and the original's source from toString().
 */
function mirrorFunction(wrapper: Function, original: Function): void {
  for (const key of ["name", "length"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    if (descriptor === undefined) continue;
    try { Object.defineProperty(wrapper, key, descriptor); } catch { /* keep the wrapper's own */ }
  }
  if (Object.prototype.hasOwnProperty.call(original, "prototype")) {
    try {
      (wrapper as { prototype: unknown }).prototype = (original as { prototype: unknown }).prototype;
    } catch { /* keep the wrapper's own */ }
  }
  try { Object.setPrototypeOf(wrapper, Object.getPrototypeOf(original)); } catch { /* keep Function.prototype */ }
  for (const key of Reflect.ownKeys(original)) {
    if (SKIPPED_STATIC_KEYS.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    if (descriptor === undefined) continue;
    try { Object.defineProperty(wrapper, key, descriptor); } catch { /* skip uncopyable statics */ }
  }
  if (!Object.prototype.hasOwnProperty.call(original, "toString")) {
    const source = (): string => Function.prototype.toString.call(original);
    try {
      Object.defineProperty(wrapper, "toString", { value: source, writable: true, configurable: true, enumerable: false });
    } catch { /* keep the wrapper's own */ }
  }
}

function isObject(value: unknown): value is Record<string | symbol, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

export interface PatcherOptions {
  logger?: ScopedLogger;
}

export class Patcher {
  private readonly targets = new WeakMap<object, Map<string | symbol, PatchedEntry>>();
  /** Currently-patched targets (WeakMap is not iterable). Pruned as entries drain. */
  private readonly knownTargets = new Set<object>();
  private readonly logger: ScopedLogger;
  private nextId = 1;

  constructor(options?: PatcherOptions) {
    this.logger = options?.logger ?? Logger.extend("Patcher");
  }

  /** Run `hook` before the call. Mutate `args` to change what the target sees. */
  before(
    owner: PatchOwner,
    target: object,
    key: string | symbol,
    hook: BeforeHook,
  ): Unpatch {
    return this.add(owner, target, key, "before", hook);
  }

  /** Run `hook` after the call. Return non-undefined to replace the result. */
  after(
    owner: PatchOwner,
    target: object,
    key: string | symbol,
    hook: AfterHook,
  ): Unpatch {
    return this.add(owner, target, key, "after", hook);
  }

  /** Replace the call. Use `callOriginal` to fall through to the original. */
  instead(
    owner: PatchOwner,
    target: object,
    key: string | symbol,
    hook: InsteadHook,
  ): Unpatch {
    return this.add(owner, target, key, "instead", hook);
  }

  /**
   * Remove every hook owned by `owner` (or all hooks when omitted).
   * Restores originals whose hook lists drain. Returns hooks removed.
   * Never throws.
   */
  unpatchAll(owner?: PatchOwner): number {
    if (owner !== undefined && (typeof owner !== "string" || owner === "")) {
      this.logger.warn("Patcher.unpatchAll() called with an invalid owner — ignoring.");
      return 0;
    }
    let removed = 0;
    try {
      for (const [target, byKey] of this.allEntries()) {
        for (const [key, entry] of [...byKey]) {
          const doomed = owner === undefined ? entry.hooks : entry.hooks.filter((h) => h.owner === owner);
          for (const hook of doomed) {
            try {
              this.removeHook(target, key, entry, hook.id);
              removed += 1;
            } catch (err: unknown) {
              this.logger.captureError(err, `Patcher.unpatchAll "${String(key)}"`);
            }
          }
        }
      }
    } catch (err: unknown) {
      this.logger.captureError(err, "Patcher.unpatchAll");
    }
    return removed;
  }

  /** Hooks currently installed (for `owner`, or all when omitted). */
  getPatchCount(owner?: PatchOwner): number {
    let count = 0;
    try {
      for (const [, byKey] of this.allEntries()) {
        for (const entry of byKey.values()) {
          count += owner === undefined ? entry.hooks.length : entry.hooks.filter((h) => h.owner === owner).length;
        }
      }
    } catch (err: unknown) {
      this.logger.captureError(err, "Patcher.getPatchCount");
    }
    return count;
  }

  private add(
    owner: PatchOwner,
    target: object,
    key: string | symbol,
    kind: HookKind,
    hook: BeforeHook | AfterHook | InsteadHook,
  ): Unpatch {
    if (typeof owner !== "string" || owner === "") {
      throw new Error(`Patcher.${kind}() requires a non-empty owner namespace.`);
    }
    if (!isObject(target)) throw new Error(`Patcher.${kind}() requires a target object.`);
    if ((typeof key !== "string" || key === "") && typeof key !== "symbol") {
      throw new Error(`Patcher.${kind}() requires a method key.`);
    }
    if (typeof hook !== "function") throw new Error(`Patcher.${kind}() requires a hook function.`);

    let original: unknown;
    try {
      original = (target as Record<string | symbol, unknown>)[key];
    } catch (err: unknown) {
      this.logger.captureError(err, `Patcher.${kind} "${String(key)}"`);
      throw new Error(`Patcher.${kind}() cannot read "${String(key)}".`);
    }
    if (typeof original !== "function") {
      throw new Error(`Patcher.${kind}() target "${String(key)}" is not a function.`);
    }

    const id = this.nextId++;
    const record: HookRecord = { id, owner, kind, hook };
    const entry = this.getOrWrap(target, key, original as (...args: unknown[]) => unknown);
    entry.hooks.push(record);

    let done = false;
    return () => {
      if (done) return;
      done = true;
      try {
        this.removeHook(target, key, entry, id);
      } catch (err: unknown) {
        this.logger.captureError(err, `Patcher.unpatch "${String(key)}"`);
      }
    };
  }

  private getOrWrap(
    target: object,
    key: string | symbol,
    original: (...args: unknown[]) => unknown,
  ): PatchedEntry {
    const existing = this.targets.get(target)?.get(key);
    if (existing !== undefined) return existing;

    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    const assignable = descriptor === undefined || ("value" in descriptor && descriptor.writable === true);
    if (!assignable && descriptor?.configurable !== true) {
      throw new Error(`Cannot patch ${String(key)}: export is read-only`);
    }

    const self = this;
    const entry: PatchedEntry = { original, hooks: [], restore: () => {} };
    function wrapper(this: unknown, ...args: unknown[]): unknown {
      return self.invoke(entry, key, this, args, new.target as Function | undefined);
    }
    mirrorFunction(wrapper, original);
    const record = target as Record<string | symbol, unknown>;
    try {
      if (assignable) {
        record[key] = wrapper;
        entry.restore = descriptor === undefined
          ? () => { delete record[key]; }
          : () => { record[key] = original; };
      } else {
        Object.defineProperty(target, key, {
          value: wrapper,
          writable: true,
          configurable: true,
          enumerable: descriptor?.enumerable ?? true,
        });
        entry.restore = () => { Object.defineProperty(target, key, descriptor as PropertyDescriptor); };
      }
    } catch (err: unknown) {
      this.logger.captureError(err, `Patcher.wrap "${String(key)}"`);
      throw new Error(`Patcher cannot wrap "${String(key)}" (target may be frozen).`);
    }
    let byKey = this.targets.get(target);
    if (byKey === undefined) {
      byKey = new Map();
      this.targets.set(target, byKey);
      this.knownTargets.add(target);
    }
    byKey.set(key, entry);
    return entry;
  }

  private removeHook(target: object, key: string | symbol, entry: PatchedEntry, id: number): void {
    const index = entry.hooks.findIndex((h) => h.id === id);
    if (index === -1) return;
    entry.hooks.splice(index, 1);
    if (entry.hooks.length > 0) return;
    // Last hook out: restore the original byte-for-byte.
    try {
      entry.restore();
    } catch (err: unknown) {
      this.logger.captureError(err, `Patcher.restore "${String(key)}"`);
      return;
    }
    const byKey = this.targets.get(target);
    if (byKey !== undefined) {
      byKey.delete(key);
      if (byKey.size === 0) {
        this.targets.delete(target);
        this.knownTargets.delete(target);
      }
    }
  }

  private *allEntries(): Generator<[object, Map<string | symbol, PatchedEntry>]> {
    for (const target of [...this.knownTargets]) {
      const byKey = this.targets.get(target);
      if (byKey !== undefined) yield [target, byKey];
      else this.knownTargets.delete(target);
    }
  }

  private invoke(
    entry: PatchedEntry,
    key: string | symbol,
    thisArg: unknown,
    args: unknown[],
    newTarget?: Function,
  ): unknown {
    const label = String(key);
    const snapshot = [...entry.hooks];
    for (const record of snapshot) {
      if (record.kind !== "before") continue;
      try {
        (record.hook as BeforeHook)(args, thisArg);
      } catch (err: unknown) {
        this.logger.captureError(err, `Patcher.before "${label}" (owner "${record.owner}")`);
      }
    }

    const insteads = snapshot.filter((r) => r.kind === "instead");
    let result: unknown;
    try {
      result = this.runInsteadChain(entry, insteads, 0, args, thisArg, label, newTarget);
    } catch (err: unknown) {
      // The original itself threw: afters still observe? No — propagate after
      // logging so behavior matches an unpatched throw.
      this.logger.captureError(err, `Patcher.call "${label}"`);
      throw err;
    }

    for (const record of snapshot) {
      if (record.kind !== "after") continue;
      try {
        const replacement = (record.hook as AfterHook)(args, result, thisArg);
        if (replacement !== undefined) result = replacement;
      } catch (err: unknown) {
        this.logger.captureError(err, `Patcher.after "${label}" (owner "${record.owner}")`);
      }
    }
    return result;
  }

  private runInsteadChain(
    entry: PatchedEntry,
    insteads: HookRecord[],
    index: number,
    args: unknown[],
    thisArg: unknown,
    label: string,
    newTarget?: Function,
  ): unknown {
    const record = insteads[index];
    if (record === undefined) {
      // `new Wrapped()` must construct the original (class components need it).
      if (newTarget !== undefined) return Reflect.construct(entry.original, args, newTarget);
      return entry.original.apply(thisArg, args);
    }
    let calledNext = false;
    let nextFailed = false;
    let nextError: unknown;
    let nextResult: unknown;
    const callOriginal = (...nextArgs: unknown[]): unknown => {
      calledNext = true;
      const effective = nextArgs.length === 0 ? args : nextArgs;
      try {
        nextResult = this.runInsteadChain(entry, insteads, index + 1, effective, thisArg, label, newTarget);
        return nextResult;
      } catch (err) { nextFailed = true; nextError = err; throw err; }
    };
    try {
      return (record.hook as InsteadHook)(args, callOriginal, thisArg);
    } catch (err: unknown) {
      // An original failure must propagate exactly once. If a hook throws
      // after calling through successfully, preserve that call's result.
      if (nextFailed) throw nextError;
      this.logger.captureError(err, `Patcher.instead "${label}" (owner "${record.owner}")`);
      if (calledNext) return nextResult;
      return callOriginal();
    }
  }
}

/** Default shared patcher. PluginManager auto-cleans it on disable/shutdown. */
export const patcher = new Patcher();

/** Create an isolated patcher (tests, alternate owners). */
export function createPatcher(options?: PatcherOptions): Patcher {
  return new Patcher(options);
}
