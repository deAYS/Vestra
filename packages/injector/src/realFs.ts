import * as nodeFs from "node:fs";
import { createRequire } from "node:module";

/** Subset of `node:fs` Vestra needs for physical Discord file probes. */
export type RealFs = Pick<
  typeof nodeFs,
  "statSync" | "existsSync" | "readdirSync" | "readFileSync" | "copyFileSync" | "rmSync"
> & {
  promises: typeof nodeFs.promises;
};

let cached: RealFs | undefined;
let testOverride: RealFs | undefined;

function tryLoadOriginalFs(): RealFs | undefined {
  try {
    const require = createRequire(import.meta.url);
    // `original-fs` is provided by Electron at runtime; it is marked external
    // in bundles and must never become an npm dependency.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const original = require("original-fs") as Partial<RealFs>;
    if (original === undefined || original === null) return undefined;
    if (typeof original.statSync !== "function") return undefined;
    return original as RealFs;
  } catch {
    return undefined;
  }
}

/**
 * Return the real (unpatched) filesystem implementation.
 * Cached after first resolution. Test overrides (via
 * `__setRealFsForTests`) take precedence.
 */
export function getRealFs(): RealFs {
  if (testOverride !== undefined) return testOverride;
  if (cached !== undefined) return cached;
  cached = tryLoadOriginalFs() ?? (nodeFs as unknown as RealFs);
  return cached;
}

/** Test-only hook. NOT exported from the public barrel (`index.ts`). */
export function __setRealFsForTests(fs: RealFs): void {
  testOverride = fs;
}

/** Test-only hook. NOT exported from the public barrel (`index.ts`). */
export function __resetRealFsForTests(): void {
  testOverride = undefined;
  cached = undefined;
}
