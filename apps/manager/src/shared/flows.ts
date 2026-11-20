import type { DiscordChannel } from "./channels.js";
import type { CheckSummary, OperationSummary } from "./types.js";

export interface ServiceLike {
  check(args: { channels: DiscordChannel[] }): Promise<CheckSummary>;
  install(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  repair(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  uninstall(args: {
    channels: DiscordChannel[];
    purge?: boolean;
  }): Promise<OperationSummary>;
}

export type FlowOk = { ok: true; warning?: string };

/** Success notice plus any warning, without repeating "Installed."/"Removed.". */
export function composeNotice(message: string, warning?: string): string {
  if (!warning) return message;
  return `${message} ${warning.replace(/(Installed|Removed)\. (?=Keep Vestra)/, "")}`;
}

function withWarning(summary: OperationSummary): { warning?: string } {
  return summary.warning ? { warning: summary.warning } : {};
}
export type FlowErr = {
  ok: false;
  code?: string | undefined;
  detail?: string | undefined;
  message: string;
};

function statusFor(summary: CheckSummary, channel: DiscordChannel) {
  return summary.statuses.find((s) => s.installation.channel === channel);
}

/** Install one channel, then deep-verify. Success only when check is healthy. */
export async function runInstallFlow(
  service: ServiceLike,
  channel: DiscordChannel,
): Promise<FlowOk | FlowErr> {
  const installed = await service.install({ channels: [channel] });
  if (!installed.ok) {
    const failed = installed.results.find((r) => !r.ok);
    return {
      ok: false,
      code: failed?.code,
      detail: failed?.detail,
      message: composeNotice("Installation failed.", installed.warning),
    };
  }
  const verify = await service.check({ channels: [channel] });
  const status = statusFor(verify, channel);
  if (status?.health === "healthy")
    return { ok: true, ...withWarning(installed) };
  return {
    ok: false,
    code: status?.code ?? "verification-failed",
    detail: status?.detail,
    message: "Installation completed, but verification failed.",
  };
}

/** Explicit repair always replaces the payload, then verifies the result. */
export async function runRepairFlow(
  service: ServiceLike,
  channel: DiscordChannel,
): Promise<
  (FlowOk & { repaired: boolean }) | (FlowErr & { repaired?: false })
> {
  const repaired = await service.repair({ channels: [channel] });
  if (!repaired.ok) {
    const failed = repaired.results.find((r) => !r.ok);
    return {
      ok: false,
      repaired: false,
      code: failed?.code,
      detail: failed?.detail,
      message: composeNotice("Repair failed.", repaired.warning),
    };
  }
  const after = await service.check({ channels: [channel] });
  const status = statusFor(after, channel);
  if (status?.health === "healthy") return { ok: true, repaired: true, ...withWarning(repaired) };
  return {
    ok: false,
    repaired: false,
    code: status?.code ?? "verification-failed",
    detail: status?.detail,
    message: "Repair completed, but verification failed.",
  };
}

/** Uninstall one channel. purge=false is the only supported mode here. */
export async function runUninstallFlow(
  service: ServiceLike,
  channel: DiscordChannel,
): Promise<FlowOk | FlowErr> {
  const result = await service.uninstall({ channels: [channel], purge: false });
  if (result.ok && result.results.some((r) => r.channel === channel && r.ok))
    return { ok: true, ...withWarning(result) };
  const failed = result.results.find((r) => !r.ok);
  return {
    ok: false,
    code: failed?.code,
    detail: failed?.detail,
    message: composeNotice("Uninstall failed.", result.warning),
  };
}
