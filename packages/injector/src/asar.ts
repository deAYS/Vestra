// @vestra/injector — asar driver.
// Phase 10. Thin wrapper over @electron/asar with Vestra-shaped errors.
// All functions operate on real paths; tests exercise them with fake asars.

import * as fs from "node:fs";
import * as asar from "@electron/asar";

export class AsarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsarError";
  }
}

/** Unpack `asarPath` into `destDir` (created as needed, cache-busted). */
export async function unpackAsar(asarPath: string, destDir: string): Promise<void> {
  try {
    await fs.promises.mkdir(destDir, { recursive: true });
    asar.uncache(asarPath);
    asar.extractAll(asarPath, destDir);
  } catch (err: unknown) {
    throw new AsarError(`unpack failed for "${asarPath}": ${describe(err)}`);
  }
}

/**
 * Pack `srcDir` into `asarPath` (overwrites), then drop @electron/asar's
 * same-process filesystem cache for that path so later reads see the new
 * bytes. (The cache is keyed by archive path: without invalidation, reads
 * after a repack in one process silently return the OLD contents.)
 */
export async function packAsar(srcDir: string, asarPath: string): Promise<void> {
  try {
    await asar.createPackage(srcDir, asarPath);
    asar.uncache(asarPath);
  } catch (err: unknown) {
    throw new AsarError(`pack failed for "${asarPath}": ${describe(err)}`);
  }
}

/** Read one file out of an asar without unpacking (cache-busted). */
export function readAsarFile(asarPath: string, filename: string): string {
  try {
    asar.uncache(asarPath);
    return asar.extractFile(asarPath, filename).toString("utf8");
  } catch (err: unknown) {
    throw new AsarError(`read failed for "${filename}" in "${asarPath}": ${describe(err)}`);
  }
}

/** Resolve the asar's main entry (package.json `main`, default `index.js`). */
export function readAsarMain(asarPath: string): string {
  let pkg: { main?: unknown };
  try {
    pkg = JSON.parse(readAsarFile(asarPath, "package.json")) as { main?: unknown };
  } catch (err: unknown) {
    throw new AsarError(`package.json unreadable in "${asarPath}": ${describe(err)}`);
  }
  const main = typeof pkg.main === "string" && pkg.main !== "" ? pkg.main : "index.js";
  return main.startsWith("./") ? main.slice(2) : main;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
