import { resolveHome } from "@vestra/installer";
import { fetchPluginFeed } from "./feed.js";
import * as store from "./store.js";

export interface StoreCliIO {
  log(message: string): void;
  error(message: string): void;
}

const DEFAULT_IO: StoreCliIO = {
  log: (m) => console.log(m),
  error: (m) => console.error(m),
};

function usage(io: StoreCliIO): number {
  io.log("Usage: vestra-store <command> [options]");
  io.log("  browse|search Q|install N|update [N]|remove N|enable N|disable N|list|prune");
  io.log("  repos|repo-add URL|repo-remove URL");
  io.log("  --home DIR        product home (default %AppData%/Vestra)");
  io.log("  --feed URL        extra feed (all commands use trusted repos + this)");
  return 2;
}

/** Run the CLI. Never throws; reports an exit code. */
export async function runStoreCli(argv: string[], io?: StoreCliIO): Promise<number> {
  const out = io ?? DEFAULT_IO;

  const [command, ...rest] = argv;
  const valid = [
    "browse", "search", "install", "update", "remove", "enable", "disable",
    "list", "prune", "repos", "repo-add", "repo-remove",
  ];
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    return usage(out);
  }
  if (!valid.includes(command)) {
    out.error(`Unknown command "${command}".`);
    return usage(out);
  }

  let home = "";
  let feed = "";
  const positionals: string[] = [];
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
      else if (arg.startsWith("--")) throw new Error(`Unknown flag "${arg}".`);
      else positionals.push(arg);
    } catch (err: unknown) {
      out.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
  }

  const homeDir = resolveHome(home === "" ? undefined : { homeDir: home });
  const ctx = { homeDir, feedUrl: feed === "" ? undefined : feed };

  try {
    switch (command) {
      case "repos": {
        const repos = await store.getRepos(homeDir);
        out.log(repos.length === 0 ? "No trusted feeds." : repos.join("\n"));
        return 0;
      }
      case "repo-add": {
        if (positionals[0] === undefined) {
          out.error("repo-add needs a feed URL.");
          return 2;
        }
        // Validate by fetching once before trusting.
        await fetchPluginFeed(positionals[0]);
        const repos = await store.addRepo(homeDir, positionals[0]);
        out.log(`Trusted: ${positionals[0]} (${repos.length} feeds)`);
        return 0;
      }
      case "repo-remove": {
        if (positionals[0] === undefined) {
          out.error("repo-remove needs a feed URL.");
          return 2;
        }
        const repos = await store.removeRepo(homeDir, positionals[0]);
        out.log(`Removed. (${repos.length} feeds)`);
        return 0;
      }
      case "browse": {
        const entries = await store.browsePlugins(ctx);
        if (entries.length === 0) out.log("No plugins in configured feeds.");
        for (const e of entries) {
          out.log(`${e.name}@${e.version} — ${e.description} (by ${e.authors.join(", ")})`);
        }
        return 0;
      }
      case "search": {
        if (positionals[0] === undefined) {
          out.error("search needs a query.");
          return 2;
        }
        const entries = await store.searchPlugins(ctx, positionals[0]);
        if (entries.length === 0) out.log("No matches.");
        for (const e of entries) out.log(`${e.name}@${e.version} — ${e.description}`);
        return 0;
      }
      case "install": {
        if (positionals[0] === undefined) {
          out.error("install needs a plugin name.");
          return 2;
        }
        const r = await store.installPlugin(ctx, positionals[0]);
        out.log(r.alreadyInstalled ? `Already installed: ${r.name}@${r.version}` : `Installed (disabled): ${r.name}@${r.version} — enable to activate.`);
        return 0;
      }
      case "update": {
        if (positionals[0] !== undefined) {
          const r = await store.updatePlugin(ctx, positionals[0]);
          out.log(r.updated ? `Updated to ${r.version}.` : `Already current (${r.version}).`);
          return 0;
        }
        const installed = await store.listInstalled(homeDir);
        let changed = 0;
        let failed = 0;
        for (const p of installed) {
          try {
            const r = await store.updatePlugin(ctx, p.name);
            if (r.updated) {
              changed++;
              out.log(`Updated ${p.name} to ${r.version}.`);
            }
          } catch (err: unknown) {
            failed++;
            out.log(`FAILED ${p.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (installed.length === 0) out.log("Nothing installed.");
        else if (changed === 0 && failed === 0) out.log("Everything current.");
        return failed === 0 ? 0 : 1;
      }
      case "remove": {
        if (positionals[0] === undefined) {
          out.error("remove needs a plugin name.");
          return 2;
        }
        await store.removePlugin(ctx, positionals[0]);
        out.log(`Removed ${positionals[0]}.`);
        return 0;
      }
      case "enable":
      case "disable": {
        if (positionals[0] === undefined) {
          out.error(`${command} needs a plugin name.`);
          return 2;
        }
        await store.setPluginEnabled(ctx, positionals[0], command === "enable");
        out.log(`${positionals[0]} ${command === "enable" ? "enabled" : "disabled"}. Takes effect on next Discord start.`);
        return 0;
      }
      case "list": {
        const installed = await store.listInstalled(homeDir);
        if (installed.length === 0) out.log("Nothing installed.");
        for (const p of installed) {
          out.log(`${p.name}@${p.version} [${p.enabled ? "enabled" : "disabled"}${p.present ? "" : ", MISSING FILES"}]`);
        }
        return 0;
      }
      case "prune": {
        const removed = await store.prunePlugins(homeDir);
        out.log(removed.length === 0 ? "Nothing to prune." : `Pruned: ${removed.join(", ")}`);
        return 0;
      }
      default:
        return usage(out);
    }
  } catch (err: unknown) {
    out.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
