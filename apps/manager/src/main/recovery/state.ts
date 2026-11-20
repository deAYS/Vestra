import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { isDiscordChannel, type DiscordChannel } from "../../shared/channels.js";
import type {
  ChannelRecovery,
  RecoveryPhase,
  RecoveryState,
} from "../../shared/recovery.js";

export type { ChannelRecovery, RecoveryPhase, RecoveryState };

const PHASES: readonly RecoveryPhase[] = [
  "idle",
  "patched",
  "waiting-for-exit",
  "failed",
];

function stateFile(home: string): string {
  return path.join(home, "recovery-state.json");
}

function parseRecord(value: unknown): ChannelRecovery | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    !PHASES.includes(raw["phase"] as RecoveryPhase) ||
    typeof raw["at"] !== "number" ||
    !Number.isFinite(raw["at"]) ||
    typeof raw["attempts"] !== "number" ||
    !Number.isInteger(raw["attempts"]) ||
    raw["attempts"] < 0
  )
    return undefined;
  const record: ChannelRecovery = {
    phase: raw["phase"] as RecoveryPhase,
    at: raw["at"],
    attempts: raw["attempts"],
  };
  if (typeof raw["version"] === "string") record.version = raw["version"];
  if (typeof raw["detail"] === "string") record.detail = raw["detail"];
  if (typeof raw["signature"] === "string")
    record.signature = raw["signature"];
  return record;
}

/** Missing or invalid files and records read as empty. */
export async function readRecoveryState(home: string): Promise<RecoveryState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.promises.readFile(stateFile(home), "utf8"));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return {};
  const state: RecoveryState = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isDiscordChannel(key)) continue;
    const record = parseRecord(value);
    if (record) state[key] = record;
  }
  return state;
}

/** Replaces the file in one rename so readers never see a partial write. */
export async function writeRecoveryState(
  home: string,
  state: RecoveryState,
): Promise<void> {
  await fs.promises.mkdir(home, { recursive: true });
  const filename = stateFile(home);
  const temporary = `${filename}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.promises.writeFile(temporary, JSON.stringify(state, null, 2));
    await fs.promises.rename(temporary, filename);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Record that `channel` was re-installed into `version` outside the recovery
 * process (the Manager's Restart Discord). Same record the notification path
 * writes, so a waiting-for-exit row clears even when recovery isn't running.
 * Callers hold the install lock.
 */
export async function markRecoveryPatched(
  home: string,
  channel: DiscordChannel,
  version: string | undefined,
  now: number = Date.now(),
): Promise<void> {
  const state = await readRecoveryState(home);
  state[channel] = {
    phase: "patched",
    ...(version === undefined ? {} : { version }),
    at: now,
    attempts: 0,
  };
  await writeRecoveryState(home, state);
}
