// Vestra Installer — thin CLI adapter over the installer service.
// Parses argv, validates usage, builds service options, invokes
// createInstallerService(), formats console output, chooses exit codes.
// All installation logic lives in service.ts / operations.ts — never here.

import * as fs from "node:fs";
import * as path from "node:path";
import type { DiscordChannel } from "@vestra/injector";
import { resolveHome } from "./home.js";
import { createInstallerService, type InstallerServiceContext } from "./service.js";

export interface CliIO {
  log(message: string): void;
  error(message: string): void;
}

const DEFAULT_IO: CliIO = {
  log: (m) => console.log(m),
  error: (m) => console.error(m),
};

const CHANNELS: DiscordChannel[] = ["stable", "ptb", "canary"];

function parseChannels(values: string[]): DiscordChannel[] | undefined {
  const out: DiscordChannel[] = [];
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const c = part.trim().toLowerCase();
      if (c === "") continue;
      if (!(CHANNELS as string[]).includes(c)) {
        throw new Error(`Unknown channel "${part}" (expected stable, ptb, canary).`);
      }
      if (!out.includes(c as DiscordChannel)) out.push(c as DiscordChannel);
    }
  }
  return out.length === 0 ? undefined : out;
}

function parseRoots(values: string[]): Array<{ channel: DiscordChannel; rootDir: string }> | undefined {
  const out: Array<{ channel: DiscordChannel; rootDir: string }> = [];
  for (const raw of values) {
    const sep = raw.indexOf(":");
    if (sep <= 0) throw new Error(`Bad --root "${raw}" (expected channel:DIR).`);
    const channel = raw.slice(0, sep).toLowerCase();
    const rootDir = raw.slice(sep + 1);
    if (!(CHANNELS as string[]).includes(channel)) {
      throw new Error(`Unknown channel "${channel}" in --root (expected stable, ptb, canary).`);
    }
    if (rootDir === "") throw new Error(`Bad --root "${raw}" (expected channel:DIR).`);
    out.push({ channel: channel as DiscordChannel, rootDir });
  }
  return out.length === 0 ? undefined : out;
}

function defaultBundlePath(): string {
  const guess = path.join(process.cwd(), "packages", "core", "dist", "vestra.js");
  try {
    if (fs.statSync(guess).isFile()) return guess;
  } catch {
    // Fall through to empty (operations will explain).
  }
  return "";
}

function usage(io: CliIO): number {
  io.log("Usage: vestra <install|uninstall|repair|status|list|check|registry> [options]");
  io.log("  --home DIR        product home (default %AppData%/Vestra)");
  io.log("  --bundle PATH     core bundle (default packages/core/dist/vestra.js)");
  io.log("  --channel a,b     stable,ptb,canary (repeatable; default all)");
  io.log("  --root ch:DIR     extra Discord root to scan (repeatable; portable installs)");
  io.log("  --force           reinstall even when already injected");
  io.log("  --purge           uninstall also deletes the product home");
  io.log("  --repair          with check: repair unhealthy installs after verifying");
  io.log("  registry prune    remove stale registry records only (never touches Discord files)");
  io.log("    --dry-run       report what would be removed without changing anything");
  return 2;
}

function capitalizeChannel(channel: string): string {
  return channel === "" ? channel : channel[0]?.toUpperCase() + channel.slice(1);
}

function serviceContext(
  homeDir: string,
  bundlePath: string | undefined,
  extraRoots: Array<{ channel: DiscordChannel; rootDir: string }> | undefined,
): InstallerServiceContext {
  return {
    homeDir,
    bundlePath,
    discovery: extraRoots === undefined ? undefined : { extraRoots },
    // testMode intentionally unset: env fallback (VESTRA_TEST=1) applies,
    // exactly as operations.ts did before. No service path bypasses safety.
  };
}

/** Run `registry prune`. Metadata-only: never touches Discord files. */
async function runRegistryPrune(out: CliIO, args: string[]): Promise<number> {
  const [sub, ...flagArgs] = args;
  if (sub !== "prune") {
    out.error(sub === undefined ? `Missing subcommand (expected "prune").` : `Unknown registry subcommand "${sub}" (expected "prune").`);
    return 2;
  }
  let home = "";
  const channelFlags: string[] = [];
  const rootFlags: string[] = [];
  let dryRun = false;
  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i] as string;
    const next = flagArgs[i + 1] as string | undefined;
    const take = (): string => {
      if (next === undefined || next.startsWith("--")) throw new Error(`Flag "${arg}" needs a value.`);
      i++;
      return next;
    };
    try {
      if (arg === "--home") home = take();
      else if (arg === "--channel") channelFlags.push(take());
      else if (arg === "--root") rootFlags.push(take());
      else if (arg === "--dry-run") dryRun = true;
      else if (arg === "--bundle" || arg === "--force" || arg === "--purge" || arg === "--repair") {
        throw new Error(`Flag "${arg}" does not apply to "registry prune".`);
      } else throw new Error(`Unknown flag "${arg}".`);
    } catch (err: unknown) {
      out.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
  }

  let channels: DiscordChannel[] | undefined;
  try {
    channels = parseChannels(channelFlags);
  } catch (err: unknown) {
    out.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const homeDir = resolveHome(home === "" ? undefined : { homeDir: home });
  let extraRoots: Array<{ channel: DiscordChannel; rootDir: string }> | undefined;
  try {
    extraRoots = parseRoots(rootFlags);
  } catch (err: unknown) {
    out.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const installer = createInstallerService(serviceContext(homeDir, undefined, extraRoots));
  try {
    const result = await installer.pruneRegistry({ channels, dryRun });
    for (const s of result.removed) {
      const version = s.installVersion === "" ? "unknown version" : s.installVersion;
      out.log(`${dryRun ? "would remove" : "stale"}: ${capitalizeChannel(s.channel)} ${version} — ${s.key}`);
    }
    if (!dryRun) {
      for (const key of result.active) out.log(`active: ${key}`);
    }
    for (const skip of result.skipped) {
      if (skip.reason === "channel-filtered") continue;
      out.log(`skipped (${skip.reason}): ${skip.key}${skip.detail === undefined ? "" : ` — ${skip.detail}`}`);
    }
    if (result.removed.length === 0) {
      out.log("No stale registry records found.");
      return 0;
    }
    const noun = result.removed.length === 1 ? "record" : "records";
    if (dryRun) {
      out.log(`Would remove ${result.removed.length} stale registry ${noun}. No changes made (dry run).`);
    } else {
      out.log(`Removed ${result.removed.length} stale registry ${noun}.`);
      out.log("No Discord files modified.");
    }
    return 0;
  } catch (err: unknown) {
    out.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/** Run the CLI. Never throws; reports an exit code. */
export async function runCli(argv: string[], io?: CliIO): Promise<number> {
  const out = io ?? DEFAULT_IO;
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    return usage(out);
  }
  if (!["install", "uninstall", "repair", "status", "list", "check", "registry"].includes(command)) {
    out.error(`Unknown command "${command}".`);
    return usage(out);
  }
  if (command === "registry") {
    return runRegistryPrune(out, rest);
  }

  let home = "";
  let bundle = "";
  const channelFlags: string[] = [];
  const rootFlags: string[] = [];
  let force = false;
  let purge = false;
  let repair = false;
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
      else if (arg === "--bundle") bundle = take();
      else if (arg === "--channel") channelFlags.push(take());
      else if (arg === "--root") rootFlags.push(take());
      else if (arg === "--force") force = true;
      else if (arg === "--purge") purge = true;
      else if (arg === "--repair") repair = true;
      else throw new Error(`Unknown flag "${arg}".`);
    } catch (err: unknown) {
      out.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
  }

  let channels: DiscordChannel[] | undefined;
  try {
    channels = parseChannels(channelFlags);
  } catch (err: unknown) {
    out.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const homeDir = resolveHome(home === "" ? undefined : { homeDir: home });
  let extraRoots: Array<{ channel: DiscordChannel; rootDir: string }> | undefined;
  try {
    extraRoots = parseRoots(rootFlags);
  } catch (err: unknown) {
    out.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const installer = createInstallerService(
    serviceContext(homeDir, bundle === "" ? defaultBundlePath() : bundle, extraRoots),
  );

  try {
    if (command === "list") {
      if (repair) {
        out.error(`Flag "--repair" only applies to "check".`);
        return 2;
      }
      const found = await installer.discover();
      if (found.length === 0) out.log("No Discord installs found.");
      for (const i of found) out.log(`${i.channel} ${i.version ?? "unknown"} — ${i.asarPath}`);
      return 0;
    }
    if (command === "status" || command === "check") {
      if (repair && command === "status") {
        out.error(`Flag "--repair" only applies to "check" (use "check --repair").`);
        return 2;
      }
      if (command === "status") {
        // Cheap/general state: injected + registry only, never ASAR bytes.
        // "installed (not deep-verified)" is deliberately NOT called
        // "healthy" in the deep sense — only check() verifies integrity.
        const { statuses, stale } = await installer.status({ channels });
        if (statuses.length === 0) out.log("No Discord installs found.");
        for (const s of statuses) out.log(`${s.installation.channel} ${s.installation.asarPath}: ${s.detail ?? s.health}`);
        for (const p of stale) out.log(`stale record: ${p}`);
        return statuses.every((s) => s.health === "healthy") ? 0 : 1;
      }
      // Authoritative deep diagnostic: inspects the actual installation
      // (receipt + backup + asar bytes + staged payload + registry).
      // Never relies on cached status from the main hook (which emits
      // console-only drift warnings and performs zero writes).
      const { statuses, stale } = await installer.check({ channels });
      if (statuses.length === 0) out.log("No Discord installs found.");
      for (const s of statuses) out.log(`${s.installation.channel} ${s.installation.asarPath}: ${s.health === "healthy" ? "healthy" : (s.detail ?? s.health)}`);
      for (const p of stale) out.log(`stale record: ${p}`);
      if (repair) {
        if (statuses.every((s) => s.health === "healthy")) return 0;
        const batch = await installer.repair({ channels });
        if (batch.results.length === 0) out.log("Nothing to repair (no matching installs).");
        for (const r of batch.results) {
          out.log(`${r.channel} ${r.asarPath}: ${r.action}${r.detail === undefined ? "" : ` — ${r.detail}`}`);
        }
        return batch.ok ? 0 : 1;
      }
      return statuses.every((s) => s.health === "healthy") ? 0 : 1;
    }
    if (repair) {
      out.error(`Flag "--repair" only applies to "check" (use "check --repair").`);
      return 2;
    }
    const summary =
      command === "install"
        ? await installer.install({ channels, force })
        : command === "uninstall"
          ? await installer.uninstall({ channels, purge })
          : await installer.repair({ channels });
    if (summary.results.length === 0) out.log("Nothing to do (no matching installs).");
    for (const r of summary.results) {
      out.log(`${r.channel} ${r.asarPath}: ${r.action}${r.detail === undefined ? "" : ` — ${r.detail}`}`);
    }
    return summary.ok ? 0 : 1;
  } catch (err: unknown) {
    out.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
