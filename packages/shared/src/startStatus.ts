export interface LaunchRecord {
  at: number;
  discordVersion: string;
  vestraVersion: string;
}

export interface StartRecord {
  at: number;
  discordVersion: string;
  vestraVersion: string;
  ok: boolean;
  reason?: string;
}

export interface StartStatusFile {
  launch?: LaunchRecord;
  start?: StartRecord;
}

export type RunState =
  | { kind: "active"; at: number }
  | { kind: "failed"; at: number; reason: string }
  | { kind: "awaiting-login" }
  | { kind: "not-started" };

export const START_REASON_MAX = 200;

/** Posix path relative to the Vestra home directory. */
export function startStatusFilename(
  channel: "stable" | "ptb" | "canary",
): string {
  return `status/${channel}.json`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBase(
  value: unknown,
): { at: number; discordVersion: string; vestraVersion: string } | undefined {
  if (!isObject(value)) return undefined;
  const { at, discordVersion, vestraVersion } = value;
  if (
    typeof at !== "number" ||
    !Number.isFinite(at) ||
    typeof discordVersion !== "string" ||
    typeof vestraVersion !== "string"
  )
    return undefined;
  return { at, discordVersion, vestraVersion };
}

/** Never throws; invalid records are dropped. */
export function parseStartStatus(text: string | undefined): StartStatusFile {
  if (text === undefined) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isObject(raw)) return {};
  const out: StartStatusFile = {};
  const launch = parseBase(raw["launch"]);
  if (launch) out.launch = launch;
  const startRaw = raw["start"];
  const start = parseBase(startRaw);
  if (start && isObject(startRaw) && typeof startRaw["ok"] === "boolean") {
    const record: StartRecord = { ...start, ok: startRaw["ok"] };
    const reason = startRaw["reason"];
    if (typeof reason === "string")
      record.reason = reason.slice(0, START_REASON_MAX);
    out.start = record;
  }
  return out;
}

export function deriveRunState(
  file: StartStatusFile,
  installedVersion: string | null,
): RunState {
  if (installedVersion === null) return { kind: "not-started" };
  const { launch, start } = file;
  if (start && start.discordVersion === installedVersion) {
    if (
      start.ok &&
      (!launch ||
        launch.discordVersion !== installedVersion ||
        start.at >= launch.at)
    )
      return { kind: "active", at: start.at };
    if (!start.ok && (!launch || start.at >= launch.at))
      return { kind: "failed", at: start.at, reason: start.reason ?? "unknown" };
  }
  if (launch && launch.discordVersion === installedVersion)
    return { kind: "awaiting-login" };
  return { kind: "not-started" };
}
