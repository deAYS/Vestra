import * as fs from "node:fs";
import * as path from "node:path";
import { startStatusFilename } from "@vestra/shared";
import { withInstallLock } from "@vestra/installer";
import type { DiscordChannel } from "../shared/channels.js";
import type {
  DiscordInstallation,
  InstallerProgressEvent,
  OperationSummary,
  StatusSummary,
} from "../shared/types.js";
import type { DiscordLifecycle } from "./discordLifecycle.js";
import { trackAfterOperation, type MaintenanceController } from "./maintenance.js";
import { versionOf } from "./recovery/monitor.js";
import { markRecoveryPatched } from "./recovery/state.js";

/** What a Manager button runs. `restart` is recovery's Restart Discord. */
export type ManagerOperation = "install" | "repair" | "uninstall" | "restart";

export interface OperationDeps {
  service: {
    context: { homeDir: string };
    discover(options: { channels: DiscordChannel[] }): Promise<DiscordInstallation[]>;
    status(options: { channels: DiscordChannel[] }): Promise<StatusSummary>;
  };
  lifecycle: Pick<DiscordLifecycle, "run">;
  maintenance: Pick<MaintenanceController, "track">;
}

/** Best effort: a start record from a previous install must not read as this one's. */
export async function clearStartStatus(
  home: string,
  channel: DiscordChannel,
): Promise<void> {
  await fs.promises
    .rm(path.join(home, ...startStatusFilename(channel).split("/")), { force: true })
    .catch(() => {});
}

async function filesHadVestra(
  deps: OperationDeps,
  channel: DiscordChannel,
): Promise<boolean | undefined> {
  try {
    const summary = await deps.service.status({ channels: [channel] });
    return summary.statuses.find((s) => s.installation.channel === channel)
      ?.vestraInstalled;
  } catch {
    return undefined;
  }
}

/**
 * Runs one operation under the install lock. A fresh payload (install, a repair
 * of files without Vestra) or an uninstall clears the channel's start status
 * while Discord is still closed. A successful Restart Discord records the
 * re-install as `patched`, as the recovery notification does, so the row stops
 * waiting even when the recovery process isn't running.
 */
export function runManagerOperation(
  deps: OperationDeps,
  operation: ManagerOperation,
  channel: DiscordChannel,
  onProgress?: (event: InstallerProgressEvent) => void,
): Promise<OperationSummary> {
  const home = deps.service.context.homeDir;
  const kind = operation === "restart" ? "repair" : operation;
  return withInstallLock(home, async () => {
    const clears =
      kind === "repair" ? (await filesHadVestra(deps, channel)) === false : true;
    const result = await deps.lifecycle.run(
      kind,
      channel,
      onProgress,
      clears ? { afterVerify: () => clearStartStatus(home, channel) } : {},
    );
    if (result.ok && operation === "restart") {
      try {
        const target = (await deps.service.discover({ channels: [channel] }))[0];
        await markRecoveryPatched(home, channel, target ? versionOf(target) : undefined);
      } catch {
        // Best effort: the next recovery sweep records the same outcome.
      }
    }
    return trackAfterOperation(deps.maintenance, kind, channel, result);
  });
}
