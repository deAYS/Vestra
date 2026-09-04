// Vestra Updater — release envelope.
// Phase 12. A release artifact is one JSON envelope carrying the payload
// files as base64 plus the payload manifest. Download verifies the envelope
// hash (from the feed) and then every inner file hash (from the manifest) —
// a corrupt or tampered artifact never reaches the payload dir.

import * as fs from "node:fs";
import * as path from "node:path";
import { PAYLOAD_FILES, sha256Hex } from "@vestra/installer";

export interface UpdateEnvelope {
  tool: "vestra-update-envelope";
  version: 1;
  payloadVersion: string;
  files: Record<string, string>;
  manifest: { files: Record<string, string> };
}

/** Build an envelope from a staged payload dir (release engineering). */
export async function buildEnvelope(payloadDir: string): Promise<{ envelope: UpdateEnvelope; bytes: Buffer }> {
  let manifest: { files?: unknown; payloadVersion?: unknown };
  try {
    manifest = JSON.parse(await fs.promises.readFile(path.join(payloadDir, "manifest.json"), "utf8")) as {
      files?: unknown;
      payloadVersion?: unknown;
    };
  } catch (err: unknown) {
    throw new Error(`buildEnvelope() cannot read manifest: ${describe(err)}`);
  }
  if (typeof manifest.payloadVersion !== "string" || manifest.payloadVersion === "") {
    throw new Error("buildEnvelope() manifest has no payloadVersion.");
  }
  const files: Record<string, string> = {};
  for (const name of PAYLOAD_FILES) {
    try {
      files[name] = (await fs.promises.readFile(path.join(payloadDir, name))).toString("base64");
    } catch (err: unknown) {
      throw new Error(`buildEnvelope() cannot read "${name}": ${describe(err)}`);
    }
  }
  const envelope: UpdateEnvelope = {
    tool: "vestra-update-envelope",
    version: 1,
    payloadVersion: manifest.payloadVersion,
    files,
    manifest: { files: (manifest.files ?? {}) as Record<string, string> },
  };
  return { envelope, bytes: Buffer.from(JSON.stringify(envelope), "utf8") };
}

/** Parse + fully verify envelope bytes against the expected feed hash. */
export function parseEnvelope(bytes: Buffer, expectedSha256: string): UpdateEnvelope {
  if (sha256Hex(bytes).toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error("Envelope hash mismatch (corrupt or tampered download).");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Envelope is not valid JSON.");
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    (parsed as { tool?: unknown }).tool !== "vestra-update-envelope" ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { payloadVersion?: unknown }).payloadVersion !== "string" ||
    typeof (parsed as { files?: unknown }).files !== "object" ||
    (parsed as { files?: unknown }).files === null ||
    typeof (parsed as { manifest?: unknown }).manifest !== "object" ||
    (parsed as { manifest?: unknown }).manifest === null
  ) {
    throw new Error("Envelope has an unexpected shape.");
  }
  const envelope = parsed as UpdateEnvelope;
  // Inner integrity: every file must match the embedded manifest.
  for (const [name, hash] of Object.entries(envelope.manifest.files)) {
    const b64 = envelope.files[name];
    if (typeof b64 !== "string") throw new Error(`Envelope missing file "${name}".`);
    const content = Buffer.from(b64, "base64");
    if (sha256Hex(content).toLowerCase() !== String(hash).toLowerCase()) {
      throw new Error(`Envelope file "${name}" fails its manifest hash.`);
    }
  }
  for (const name of PAYLOAD_FILES) {
    if (typeof envelope.files[name] !== "string") {
      throw new Error(`Envelope missing required file "${name}".`);
    }
  }
  return envelope;
}

/** Write a verified envelope into a payload dir (+ manifest.json). */
export async function writeEnvelopePayload(
  payloadRoot: string,
  envelope: UpdateEnvelope,
): Promise<string> {
  const dir = path.join(payloadRoot, envelope.payloadVersion);
  await fs.promises.mkdir(dir, { recursive: true });
  for (const name of PAYLOAD_FILES) {
    const content = Buffer.from(envelope.files[name] as string, "base64");
    await fs.promises.writeFile(path.join(dir, name), content);
  }
  const manifest = {
    tool: "vestra-installer",
    version: 1,
    payloadVersion: envelope.payloadVersion,
    builtAt: new Date().toISOString(),
    files: envelope.manifest.files,
  };
  await fs.promises.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return dir;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
