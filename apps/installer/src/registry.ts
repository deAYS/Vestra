import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface RegistryEntry {
  asarPath: string;
  channel: string;
  installVersion: string;
  payloadVersion: string;
  at: string;
  /** Versioned app dir, e.g. `.../app-1.0.1157` (optional, new writes). */
  appDir?: string | undefined;
  /** Channel root dir, e.g. `%LOCALAPPDATA%/DiscordCanary` (optional, new writes). */
  rootDir?: string | undefined;
}

export type InstallRegistry = Record<string, RegistryEntry>;

/** Diagnostics for tolerant registry loading. */
export interface RegistryLoadDiagnostics {
  registry: InstallRegistry;
  /** Keys dropped because they were not objects with a string asarPath. */
  malformedKeys: string[];
  /** Verbatim raw values of malformed keys (preserved, never silently deleted). */
  malformed: Record<string, unknown>;
  /** Set when an unreadable registry file was moved aside (short reason, no paths). */
  warning?: string | undefined;
}

/** Load the registry with per-record diagnostics. Missing/corrupt files yield `{}`. */
export async function loadRegistryWithDiagnostics(registryPath: string): Promise<RegistryLoadDiagnostics> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(registryPath, "utf8");
  } catch {
    return { registry: {}, malformedKeys: [], malformed: {} };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { registry: {}, malformedKeys: [], malformed: {} };
    }
    const out: InstallRegistry = {};
    const malformedKeys: string[] = [];
    const malformed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof value === "object" && value !== null &&
        typeof (value as { asarPath?: unknown }).asarPath === "string"
      ) {
        out[key] = value as RegistryEntry;
      } else {
        malformedKeys.push(key);
        malformed[key] = value;
      }
    }
    return { registry: out, malformedKeys, malformed };
  } catch {
    // Invalid JSON: keep the bytes for recovery and start from an empty registry.
    let warning = "registry-corrupt: installs.json was unreadable and could not be moved aside";
    try {
      await fs.promises.rename(registryPath, `${registryPath}.corrupt-${Date.now()}`);
      warning = "registry-corrupt: installs.json was unreadable and was moved aside";
    } catch {
      // Leave it in place; the next save replaces it.
    }
    return { registry: {}, malformedKeys: [], malformed: {}, warning };
  }
}

/** Load the registry. Missing/corrupt files yield `{}`. */
export async function loadRegistry(registryPath: string): Promise<InstallRegistry> {
  const { registry } = await loadRegistryWithDiagnostics(registryPath);
  const out: InstallRegistry = {};
  for (const [key, value] of Object.entries(registry)) {
    if (typeof (value as { payloadVersion?: unknown }).payloadVersion === "string") {
      out[key] = value;
    }
  }
  return out;
}

/** Persist the registry atomically. */
export async function saveRegistry(registryPath: string, registry: InstallRegistry): Promise<void> {
  await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });
  const tmpPath = `${registryPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf8");
    await fs.promises.rename(tmpPath, registryPath);
  } catch (err: unknown) {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
}
