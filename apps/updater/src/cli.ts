// Vestra Updater — minimal CLI.
// Phase 12. `check | download | apply | update | prune | status`.
// Exits 0 (ok / nothing to do), 1 (failures), 2 (usage).

import type { DiscordChannel } from "@vestra/injector";
import { resolveHome } from "@vestra/installer";
import { applyUpdate, checkForUpdates, currentStagedVersion, downloadUpdate, prunePayloads } from "./update.js";

export interface UpdaterCliIO {
  log(message: string): void;
  error(message: string): void;
}

const DEFAULT_IO: UpdaterCliIO = {
  log: (m) => console.log(m),
  error: (m) => console.error(m),
};

const CHANNELS: DiscordChannel[] = ["stable", "ptb", "canary"];

function usage(io: UpdaterCliIO): number {
  io.log("Usage: vestra-updater <check|download|apply|update|prune|status> [options]");
  io.log("  --home DIR        product home (default %AppData%/Vestra)");
  io.log("  --feed URL        release feed (required for check/download/update)");
  io.log("  --version V       target release (download/apply; default newest)");
  io.log("  --root ch:DIR     extra Discord root (repeatable)");
  io.log("  --keep N          prune: staged versions to keep (default 2)");
  return 2;
}

/** Run the CLI. Never throws; reports an exit code. */
export async function runUpdaterCli(argv: string[], io?: UpdaterCliIO): Promise<number> {
  const out = io ?? DEFAULT_IO;
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    return usage(out);
  }
  if (!["check", "download", "apply", "update", "prune", "status"].includes(command)) {
    out.error(`Unknown command "${command}".`);
    return usage(out);
  }

  let home = "";
  let feed = "";
  let version = "";
  const rootFlags: string[] = [];
  let keep = 2;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    const next = rest[i + 1] as string | undefined;
    const take = (): string => {
      if (next === undefined || next.startsWith("--")) throw new Error(`Flag "${arg}" needs a value.`);
      i++;
      return next;
    };
    try {
      if (arg === "--home") home = take();
      else if (arg === "--feed") feed = take();
      else if (arg === "--version") version = take();
      else if (arg === "--root") rootFlags.push(take());
      else if (arg === "--keep") {
        const n = Number(take());
        if (!Number.isInteger(n) || n < 1) throw new Error(`--keep needs a positive integer.`);
        keep = n;
      } else throw new Error(`Unknown flag "${arg}".`);
    } catch (err: unknown) {
      out.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
  }

  const extraRoots: Array<{ channel: DiscordChannel; rootDir: string }> = [];
  try {
    for (const raw of rootFlags) {
      const sep = raw.indexOf(":");
      if (sep <= 0) throw new Error(`Bad --root "${raw}" (expected channel:DIR).`);
      const channel = raw.slice(0, sep).toLowerCase();
      const rootDir = raw.slice(sep + 1);
      if (!(CHANNELS as string[]).includes(channel) || rootDir === "") {
        throw new Error(`Bad --root "${raw}" (expected channel:DIR).`);
      }
      extraRoots.push({ channel: channel as DiscordChannel, rootDir });
    }
  } catch (err: unknown) {
    out.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const homeDir = resolveHome(home === "" ? undefined : { homeDir: home });
  const ctx = {
    homeDir,
    feedUrl: feed === "" ? undefined : feed,
    discovery: extraRoots.length === 0 ? undefined : { extraRoots },
  };

  try {
    if (command === "status") {
      const current = await currentStagedVersion(homeDir);
      out.log(`staged: ${current}`);
      return 0;
    }
    if (command === "prune") {
      const removed = await prunePayloads(homeDir, keep);
      out.log(removed.length === 0 ? "Nothing to prune." : `Pruned: ${removed.join(", ")}`);
      return 0;
    }
    if (command === "check") {
      const s = await checkForUpdates(ctx);
      out.log(s.available ? `Update available: ${s.version} (current ${s.current})` : `Current (${s.current}).`);
      return 0;
    }
    if (command === "download") {
      const d = await downloadUpdate(ctx, version === "" ? undefined : version);
      out.log(d.alreadyStaged ? `Already staged: ${d.version}` : `Staged: ${d.version}`);
      return 0;
    }
    if (command === "apply") {
      if (version === "") {
        out.error("--version is required for apply.");
        return 2;
      }
      const r = await applyUpdate(ctx, version);
      reportApply(out, r);
      return r.failed.length === 0 ? 0 : 1;
    }
    // update = check + download + apply.
    const s = await checkForUpdates(ctx);
    if (!s.available || s.version === undefined) {
      out.log(`Current (${s.current}).`);
      return 0;
    }
    const d = await downloadUpdate(ctx, s.version);
    out.log(d.alreadyStaged ? `Already staged: ${d.version}` : `Staged: ${d.version}`);
    const r = await applyUpdate(ctx, d.version);
    reportApply(out, r);
    return r.failed.length === 0 ? 0 : 1;
  } catch (err: unknown) {
    out.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

function reportApply(
  out: UpdaterCliIO,
  r: { version: string; reinstalled: string[]; rolledBack: string[]; failed: Array<{ asarPath: string; error: string }> },
): void {
  if (r.reinstalled.length === 0 && r.rolledBack.length === 0 && r.failed.length === 0) {
    out.log(`Nothing to apply (${r.version} already everywhere).`);
  }
  for (const p of r.reinstalled) out.log(`updated: ${p}`);
  for (const p of r.rolledBack) out.log(`rolled back: ${p}`);
  for (const f of r.failed) out.log(`FAILED ${f.asarPath}: ${f.error}`);
}
