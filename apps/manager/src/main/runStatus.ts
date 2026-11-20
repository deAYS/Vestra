import * as fs from "node:fs";
import * as path from "node:path";
import {
  deriveRunState,
  parseStartStatus,
  startStatusFilename,
} from "@vestra/shared";
import type { DiscordInstallation, RunStatusMap } from "../shared/types.js";
import { readRecoveryState, type RecoveryState } from "./recovery/state.js";

async function readText(filename: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(filename, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Start status (written by Vestra inside Discord) and recovery state for each
 * discovered install. Missing or invalid files read as "not started"; never throws.
 */
export async function readRunStatus(
  home: string,
  installations: ReadonlyArray<Pick<DiscordInstallation, "channel" | "version">>,
): Promise<RunStatusMap> {
  let recovery: RecoveryState = {};
  try {
    recovery = await readRecoveryState(home);
  } catch {
    /* unreadable state is no state */
  }
  const out: RunStatusMap = {};
  for (const { channel, version } of installations) {
    const file = parseStartStatus(
      await readText(path.join(home, ...startStatusFilename(channel).split("/"))),
    );
    const record = recovery[channel];
    out[channel] = {
      run: deriveRunState(file, version),
      ...(record ? { recovery: record } : {}),
    };
  }
  return out;
}
