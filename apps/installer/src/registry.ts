import * as fs from "node:fs";

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
}

/** Load the registry with per-record diagnostics. Missing/corrupt files yield `{}`. */
export async function loadRegistryWithDiagnostics(registryPath: string): Promise<RegistryLoadDiagnostics> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(registryPath, "utf8")) as unknown;
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
    return { registry: {}, malformedKeys: [], malformed: {} };
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
  const tmpPath = `${registryPath}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf8");
  await fs.promises.rename(tmpPath, registryPath);
}
