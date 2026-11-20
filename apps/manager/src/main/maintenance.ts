import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { getRealFs } from "@vestra/injector";
import {
  layoutHome,
  loadRegistry,
  withInstallLock,
  type InstallerService,
} from "@vestra/installer";
import { systemTool } from "./systemTools.js";
import { isDiscordChannel, type DiscordChannel } from "../shared/channels.js";
import type { MaintenanceStatus } from "../shared/types.js";

const execute = promisify(execFile);
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export interface MaintenanceConfig {
  enabled: boolean;
  channels: DiscordChannel[];
  runtime?: string;
}

export async function readMaintenance(
  home: string,
): Promise<MaintenanceConfig> {
  try {
    const parsed = JSON.parse(
      await fs.promises.readFile(path.join(home, "maintenance.json"), "utf8"),
    );
    if (typeof parsed.enabled !== "boolean" || !Array.isArray(parsed.channels))
      throw new Error("Invalid maintenance configuration.");
    return {
      enabled: parsed.enabled,
      channels: [
        ...new Set<DiscordChannel>(parsed.channels.filter(isDiscordChannel)),
      ],
      ...(typeof parsed.runtime === "string"
        ? { runtime: parsed.runtime }
        : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { enabled: true, channels: [] };
    throw error;
  }
}

function isActive(config: MaintenanceConfig): boolean {
  return config.enabled && config.channels.length > 0;
}

/** The runtime folder name (content hash) a config points at, if any. */
function runtimeFolder(config: MaintenanceConfig): string | undefined {
  return config.runtime === undefined
    ? undefined
    : path.basename(path.dirname(config.runtime)).toLowerCase();
}

async function saveConfig(
  home: string,
  config: MaintenanceConfig,
): Promise<void> {
  await fs.promises.mkdir(home, { recursive: true });
  const filename = path.join(home, "maintenance.json");
  await fs.promises.writeFile(
    filename + ".tmp",
    JSON.stringify(config, null, 2),
  );
  await fs.promises.rename(filename + ".tmp", filename);
}

export interface MaintenanceHost {
  packaged: boolean;
  executable: string;
  localAppData: string;
}

export interface MaintenanceDeps {
  exec?: (file: string, args: string[]) => Promise<unknown>;
  launch?: (executable: string, args: string[]) => Promise<void>;
}

export class MaintenanceController {
  private readonly run: (file: string, args: string[]) => Promise<unknown>;
  constructor(
    private readonly service: InstallerService,
    private readonly host: MaintenanceHost,
    private readonly deps: MaintenanceDeps = {},
  ) {
    this.run =
      deps.exec ??
      ((file, args) => execute(file, args, { windowsHide: true }));
  }
  private get home(): string {
    return this.service.context.homeDir;
  }

  async status(): Promise<MaintenanceStatus> {
    const config = await readMaintenance(this.home);
    return {
      enabled: config.enabled && config.channels.length > 0,
      available: this.host.packaged && process.platform === "win32",
      channels: config.channels,
    };
  }

  async setEnabled(enabled: boolean): Promise<MaintenanceStatus> {
    const config = await readMaintenance(this.home);
    config.enabled = enabled;
    if (enabled && config.channels.length === 0) {
      const registry = await loadRegistry(layoutHome(this.home).registryPath);
      config.channels = [
        ...new Set(
          Object.values(registry)
            .map((record) => record.channel)
            .filter(isDiscordChannel),
        ),
      ];
      if (config.channels.length === 0)
        throw new Error("Install Vestra before enabling automatic recovery.");
    }
    await this.configure(config);
    return this.status();
  }

  async track(channel: DiscordChannel, installed: boolean): Promise<void> {
    const config = await readMaintenance(this.home);
    config.channels = config.channels.filter((value) => value !== channel);
    if (installed) config.channels.push(channel);
    await this.configure(config);
  }

  /**
   * After a Manager update, recovery is still registered on the previous
   * build's runtime. Stages and registers this build's runtime when the
   * configured one differs; the running recovery process hands over to it on
   * its next trigger. Resolves false when nothing needed to change.
   */
  async refreshRuntime(): Promise<boolean> {
    if (!this.host.packaged || process.platform !== "win32") return false;
    const config = await readMaintenance(this.home);
    if (!isActive(config)) return false;
    const name = await this.runtimeName();
    if (runtimeFolder(config) === name) return false;
    return withInstallLock(this.home, async () => {
      // Another operation may have registered a runtime meanwhile.
      const current = await readMaintenance(this.home);
      if (!isActive(current) || runtimeFolder(current) === name) return false;
      await this.configure(current);
      return true;
    });
  }

  private async configure(config: MaintenanceConfig): Promise<void> {
    if (!this.host.packaged || process.platform !== "win32") {
      await saveConfig(this.home, config);
      return;
    }
    if (!config.enabled || config.channels.length === 0) {
      // Deleting an absent named value is harmless; registry access failures are not.
      const query = await this.run(systemTool("reg"), [
        "query",
        RUN_KEY,
        "/v",
        "VestraMaintenance",
      ]).then(
        () => true,
        (error) => {
          if ((error as { code?: unknown }).code === 1) return false;
          throw error;
        },
      );
      if (query)
        await this.run(systemTool("reg"), [
          "delete",
          RUN_KEY,
          "/v",
          "VestraMaintenance",
          "/f",
        ]);
      await saveConfig(this.home, config);
      return;
    }
    // The runtime recovery may still be running from, before it is replaced.
    const running = runtimeFolder(config);
    const runtime = await this.stageRuntime();
    const current = path.basename(path.dirname(runtime));
    await this.run(systemTool("reg"), [
      "add",
      RUN_KEY,
      "/v",
      "VestraMaintenance",
      "/t",
      "REG_SZ",
      "/d",
      `"${runtime}" --maintain`,
      "/f",
    ]);
    // Persist only after the registration worked, so a failure keeps the old config.
    config.runtime = runtime;
    await saveConfig(this.home, config);
    await this.pruneRuntimes([current, ...(running === undefined ? [] : [running])]);
    await this.lifecycleSystemLaunch(runtime);
  }

  private async lifecycleSystemLaunch(runtime: string): Promise<void> {
    if (this.deps.launch) return this.deps.launch(runtime, ["--maintain"]);
    const { windowsDiscordSystem } = await import("./discordLifecycle.js");
    await windowsDiscordSystem.launch(runtime, ["--maintain"]);
  }

  private get runtimeParent(): string {
    return path.join(this.host.localAppData, "Vestra", "maintenance");
  }

  /**
   * Removes runtime copies from older builds, except `keep`: the new runtime
   * and the one configured until now, which a recovery process may still be
   * running from. That process hands over to the new runtime on its next
   * trigger, and its copy goes on a later configure. Any other copy that is
   * still in use may be only partially removed, since Windows keeps open files.
   */
  private async pruneRuntimes(keep: string[]): Promise<void> {
    const kept = new Set(keep.map((name) => name.toLowerCase()));
    try {
      for (const entry of await fs.promises.readdir(this.runtimeParent)) {
        if (kept.has(entry.toLowerCase())) continue;
        await fs.promises
          .rm(path.join(this.runtimeParent, entry), { recursive: true, force: true })
          .catch(() => {});
      }
    } catch {
      /* best effort */
    }
  }

  /** The runtime folder name: a hash of this build's app and Vestra payload. */
  private async runtimeName(): Promise<string> {
    const source = path.dirname(this.host.executable);
    const hash = createHash("sha256");
    hash.update(
      await getRealFs().promises.readFile(
        path.join(source, "resources", "app.asar"),
      ),
    );
    hash.update(await fs.promises.readFile(this.service.context.bundlePath!));
    return hash.digest("hex").slice(0, 16);
  }

  private async stageRuntime(): Promise<string> {
    // Portable apps execute from a temporary extraction directory. Keep an
    // independent runtime so recovery also works after that directory disappears.
    const source = path.dirname(this.host.executable);
    const physicalFs = getRealFs();
    const destination = path.join(this.runtimeParent, await this.runtimeName());
    const executable = path.join(
      destination,
      path.basename(this.host.executable),
    );
    const marker = path.join(destination, ".complete");
    if (!fs.existsSync(marker)) {
      await physicalFs.promises.mkdir(destination, { recursive: true });
      for (const entry of await physicalFs.promises.readdir(source, {
        withFileTypes: true,
      })) {
        if (entry.isSymbolicLink()) continue;
        if (
          entry.isDirectory() &&
          entry.name !== "resources" &&
          entry.name !== "locales"
        )
          continue;
        if (
          entry.isFile() &&
          /^(uninstall|vestra-.*-(setup|portable))/i.test(entry.name)
        )
          continue;
        await physicalFs.promises.cp(
          path.join(source, entry.name),
          path.join(destination, entry.name),
          { recursive: true },
        );
      }
      await fs.promises.writeFile(marker, "Vestra recovery runtime\n");
    }
    return executable;
  }
}

/** A failed "keep installed" step never turns a finished operation into an error. */
export async function trackAfterOperation<
  T extends { ok: boolean; warning?: string },
>(
  maintenance: Pick<MaintenanceController, "track">,
  kind: "install" | "repair" | "uninstall",
  channel: DiscordChannel,
  result: T,
): Promise<T> {
  if (!result.ok) return result;
  try {
    await maintenance.track(channel, kind !== "uninstall");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const own =
      kind === "uninstall"
        ? `Removed. Keep Vestra installed couldn't be updated: ${message}`
        : `Installed. Keep Vestra installed couldn't be turned on: ${message}`;
    return {
      ...result,
      warning: result.warning ? `${result.warning} ${own}` : own,
    };
  }
}
