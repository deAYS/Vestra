import { createHash } from "node:crypto";

export function assertArtifactFilename(name: string): void {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/.test(name) || name.includes("..") || ["__proto__", "constructor", "prototype"].includes(name)) {
    throw new TypeError("Unsafe artifact filename.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every written byte needs a hash; every hash needs a file. No unchecked extras. */
export function verifyFileManifest(files: unknown, hashes: unknown, required: readonly string[], exact = false): void {
  if (!isRecord(files) || !isRecord(hashes)) throw new Error("Invalid file manifest.");
  const names = Object.keys(files);
  if (!names.length || names.length !== Object.keys(hashes).length) throw new Error("Incomplete file manifest.");
  for (const name of required) {
    if (!Object.hasOwn(files, name) || !Object.hasOwn(hashes, name)) throw new Error(`Manifest missing required file "${name}".`);
  }
  if (exact && names.length !== required.length) throw new Error("Unexpected payload files.");
  for (const name of names) {
    assertArtifactFilename(name);
    const b64 = files[name];
    const hash = hashes[name];
    if (!Object.hasOwn(hashes, name) || typeof b64 !== "string" || typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Invalid file manifest entry.");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) throw new Error("Invalid base64 file content.");
    if (createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex") !== hash.toLowerCase()) throw new Error(`Manifest hash mismatch for "${name}".`);
  }
}
