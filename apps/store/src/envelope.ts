// Vestra Store — plugin envelope.
// Phase 13. A plugin artifact is one JSON envelope carrying the plugin files
// as base64 plus a file manifest. Download verifies the envelope hash (pinned
// in the feed entry) and then every inner file hash — tampered bytes never
// reach the plugins dir. `index.js` is the required renderer entry (see the
// entry convention in store.ts).

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const PLUGIN_ENTRY_FILE = "index.js";

export interface PluginEnvelope {
  tool: "vestra-plugin-envelope";
  version: 1;
  name: string;
  pluginVersion: string;
  files: Record<string, string>;
  manifest: { files: Record<string, string> };
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function assertSafeName(name: string, what: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) && what === "plugin") {
    throw new Error(`Unsafe plugin name "${name}".`);
  }
  if (name === "" || name.includes("..") || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    throw new Error(`Unsafe file name "${name}".`);
  }
}

/** Build an envelope from a plugin source dir (release engineering). */
export async function buildPluginEnvelope(
  sourceDir: string,
  meta: { name: string; pluginVersion: string },
): Promise<{ envelope: PluginEnvelope; bytes: Buffer }> {
  assertSafeName(meta.name, "plugin");
  if (meta.pluginVersion === "") throw new Error("buildPluginEnvelope() requires a pluginVersion.");
  let entries: string[];
  try {
    entries = await fs.promises.readdir(sourceDir);
  } catch (err: unknown) {
    throw new Error(`buildPluginEnvelope() cannot read dir: ${describe(err)}`);
  }
  if (!entries.includes(PLUGIN_ENTRY_FILE)) {
    throw new Error(`Plugin source needs an "${PLUGIN_ENTRY_FILE}" entry file.`);
  }
  const files: Record<string, string> = {};
  for (const entry of entries) {
    assertSafeName(entry, "file");
    const full = path.join(sourceDir, entry);
    const st = await fs.promises.stat(full);
    if (!st.isFile()) continue;
    files[entry] = (await fs.promises.readFile(full)).toString("base64");
  }
  const manifestFiles: Record<string, string> = {};
  for (const [name, b64] of Object.entries(files)) {
    manifestFiles[name] = sha256Hex(Buffer.from(b64, "base64"));
  }
  const envelope: PluginEnvelope = {
    tool: "vestra-plugin-envelope",
    version: 1,
    name: meta.name,
    pluginVersion: meta.pluginVersion,
    files,
    manifest: { files: manifestFiles },
  };
  return { envelope, bytes: Buffer.from(JSON.stringify(envelope), "utf8") };
}

/** Parse + fully verify envelope bytes against the feed-pinned hash. */
export function parsePluginEnvelope(
  bytes: Buffer,
  expectedSha256: string,
  expectedName: string,
): PluginEnvelope {
  if (sha256Hex(bytes).toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error("Plugin envelope hash mismatch (corrupt or tampered download).");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Plugin envelope is not valid JSON.");
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    (parsed as { tool?: unknown }).tool !== "vestra-plugin-envelope" ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { pluginVersion?: unknown }).pluginVersion !== "string" ||
    typeof (parsed as { files?: unknown }).files !== "object" ||
    (parsed as { files?: unknown }).files === null
  ) {
    throw new Error("Plugin envelope has an unexpected shape.");
  }
  const envelope = parsed as PluginEnvelope;
  if (envelope.name !== expectedName) {
    throw new Error(`Envelope is for "${envelope.name}", expected "${expectedName}".`);
  }
  for (const [name, hash] of Object.entries(envelope.manifest.files)) {
    assertSafeName(name, "file");
    const b64 = envelope.files[name];
    if (typeof b64 !== "string") throw new Error(`Envelope missing file "${name}".`);
    if (sha256Hex(Buffer.from(b64, "base64")).toLowerCase() !== String(hash).toLowerCase()) {
      throw new Error(`Envelope file "${name}" fails its manifest hash.`);
    }
  }
  if (typeof envelope.files[PLUGIN_ENTRY_FILE] !== "string") {
    throw new Error(`Envelope missing required entry "${PLUGIN_ENTRY_FILE}".`);
  }
  return envelope;
}

/** Write a verified envelope into a version dir. Returns the dir. */
export async function writePluginPayload(
  pluginsRoot: string,
  envelope: PluginEnvelope,
): Promise<string> {
  assertSafeName(envelope.name, "plugin");
  if (envelope.pluginVersion === "") throw new Error("Envelope has no pluginVersion.");
  const dir = path.join(pluginsRoot, envelope.name, envelope.pluginVersion);
  await fs.promises.mkdir(dir, { recursive: true });
  for (const [name, b64] of Object.entries(envelope.files)) {
    assertSafeName(name, "file");
    await fs.promises.writeFile(path.join(dir, name), Buffer.from(b64, "base64"));
  }
  return dir;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
