// Vestra Manager — operation flows over a minimal service interface.
// The renderer passes window.vestraManager; tests pass a fake.
// One selected installation per action: callers pass exactly one channel.
//
// Install:  install([ch]) -> check([ch]) -> success only if deep healthy.
// Repair:   check([ch]) first; healthy => no repair call; drifted =>
//           repair([ch]) -> check([ch]) again -> success only if healthy.
// Uninstall: uninstall([ch]) with purge=false (enforced here AND main-side).

import type { DiscordChannel } from "./channels.js";
import type { CheckSummary, OperationSummary } from "./types.js";

export interface ServiceLike {
  check(args: { channels: DiscordChannel[] }): Promise<CheckSummary>;
  install(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  repair(args: { channels: DiscordChannel[] }): Promise<OperationSummary>;
  uninstall(args: { channels: DiscordChannel[]; purge?: boolean }): Promise<OperationSummary>;
}

export type FlowOk = { ok: true };
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
      message: "Installation failed.",
    };
  }
  const verify = await service.check({ channels: [channel] });
  const status = statusFor(verify, channel);
  if (status?.health === "healthy") return { ok: true };
  return {
    ok: false,
    code: status?.code ?? "verification-failed",
    detail: status?.detail,
    message: "Installation completed, but verification failed.",
  };
}

export const ALREADY_HEALTHY_MESSAGE = "Vestra is already healthy.";

/** Verify-first repair. Never rewrites a healthy install. */
export async function runRepairFlow(
  service: ServiceLike,
  channel: DiscordChannel,
): Promise<(FlowOk & { repaired: boolean }) | (FlowErr & { repaired?: false })> {
  const before = await service.check({ channels: [channel] });
  const current = statusFor(before, channel);
  if (current?.health === "healthy") {
    return { ok: true, repaired: false };
  }
  const repaired = await service.repair({ channels: [channel] });
  if (!repaired.ok) {
    const failed = repaired.results.find((r) => !r.ok);
    return {
      ok: false,
      repaired: false,
      code: failed?.code,
      detail: failed?.detail,
      message: "Repair failed.",
    };
  }
  const after = await service.check({ channels: [channel] });
  const status = statusFor(after, channel);
  if (status?.health === "healthy") return { ok: true, repaired: true };
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
  if (result.ok) return { ok: true };
  const failed = result.results.find((r) => !r.ok);
  return {
    ok: false,
    code: failed?.code,
    detail: failed?.detail,
    message: "Uninstall failed.",
  };
}
