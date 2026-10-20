import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertSafeVersion } from "@vestra/shared";
import {
  BUNDLE_FILE,
  HOOKDIR_PREFIX,
  LOADER_FILE,
  MAIN_HOOK_FILE,
  PRELOAD_FILE,
  buildLoaderSource,
  buildMainHookSource,
  buildPreloadSource,
} from "@vestra/injector";

export const PAYLOAD_FILES = [BUNDLE_FILE, PRELOAD_FILE, MAIN_HOOK_FILE, LOADER_FILE] as const;

export interface PayloadManifest {
  tool: "vestra-installer";
  version: 1;
  payloadVersion: string;
  builtAt: string;
  files: Record<string, string>;
}

export interface StageOptions {
  /** Absolute path of the built core bundle (`packages/core/dist/vestra.js`). */
  bundlePath: string;
  payloadVersion: string;
  payloadRoot: string;
  /** Fail when the versioned payload already exists. Default false (rebuild). */
  failIfExists?: boolean;
}

export function payloadDirFor(payloadRoot: string, version: string): string {
  assertSafeVersion(version);
  return path.join(payloadRoot, version);
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Stage (or restage) a versioned payload. Returns the payload dir. */
export async function stagePayload(options: StageOptions): Promise<string> {
  if (options.bundlePath === "") throw new TypeError("stagePayload() requires bundlePath.");
  if (options.payloadVersion === "") throw new TypeError("stagePayload() requires payloadVersion.");
  assertSafeVersion(options.payloadVersion);
  let bundle: string;
  try {
    bundle = await fs.promises.readFile(options.bundlePath, "utf8");
  } catch (err: unknown) {
    throw new Error(`stagePayload() cannot read bundle: ${describe(err)}`);
  }
  if (bundle === "") throw new Error("stagePayload() refusing empty bundle.");

  const dir = payloadDirFor(options.payloadRoot, options.payloadVersion);
  if (options.failIfExists === true) {
    try {
      const st = await fs.promises.stat(path.join(dir, "manifest.json"));
      if (st.isFile()) throw new Error(`Payload ${options.payloadVersion} already staged.`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("already staged")) throw err;
    }
  }
  // Install-independent payload: hookdir-relative preload survives updates.
  const files: Record<string, string> = {
    [BUNDLE_FILE]: bundle,
    [PRELOAD_FILE]: buildPreloadSource({}),
    [MAIN_HOOK_FILE]: buildMainHookSource({ preloadPath: `${HOOKDIR_PREFIX}${PRELOAD_FILE}` }),
    [LOADER_FILE]: buildLoaderSource({}),
  };
  const manifest: PayloadManifest = {
    tool: "vestra-installer",
    version: 1,
    payloadVersion: options.payloadVersion,
    builtAt: new Date().toISOString(),
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [name, sha256Hex(content)] as const),
    ),
  };
  await fs.promises.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.promises.writeFile(path.join(dir, name), content, "utf8");
  }
  await fs.promises.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return dir;
}

/** Read a staged manifest, or undefined when absent/invalid. */
export async function readPayloadManifest(dir: string): Promise<PayloadManifest | undefined> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(path.join(dir, "manifest.json"), "utf8")) as Partial<PayloadManifest>;
    if (parsed.tool !== "vestra-installer" || parsed.version !== 1) return undefined;
    if (typeof parsed.payloadVersion !== "string" || typeof parsed.files !== "object" || parsed.files === null) {
      return undefined;
    }
    assertSafeVersion(parsed.payloadVersion);
    if (Object.keys(parsed.files).length !== PAYLOAD_FILES.length || PAYLOAD_FILES.some(name => !Object.hasOwn(parsed.files!, name) || !/^[a-f0-9]{64}$/i.test(parsed.files![name] ?? ""))) return undefined;
    return parsed as PayloadManifest;
  } catch {
    return undefined;
  }
}

/** Verify every payload file against its manifest hash. */
export async function verifyPayload(dir: string): Promise<{ ok: boolean; bad: string[] }> {
  const manifest = await readPayloadManifest(dir);
  if (manifest === undefined) return { ok: false, bad: ["manifest.json"] };
  const bad: string[] = [];
  for (const [name, hash] of Object.entries(manifest.files)) {
    try {
      const content = await fs.promises.readFile(path.join(dir, name), "utf8");
      if (sha256Hex(content) !== hash) bad.push(name);
    } catch {
      bad.push(name);
    }
  }
  return { ok: bad.length === 0, bad };
}

/** Load staged payload sources for injection (verified first). */
export async function loadPayloadSources(
  dir: string,
): Promise<Record<(typeof PAYLOAD_FILES)[number], string>> {
  const check = await verifyPayload(dir);
  if (!check.ok) throw new Error(`Payload corrupt (${check.bad.join(", ")}): ${dir}`);
  const out: Record<string, string> = {};
  for (const name of PAYLOAD_FILES) {
    out[name] = await fs.promises.readFile(path.join(dir, name), "utf8");
  }
  return out as Record<(typeof PAYLOAD_FILES)[number], string>;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
