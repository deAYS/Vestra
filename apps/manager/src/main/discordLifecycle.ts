import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
  DiscordInstallation,
  InstallerProgressEvent,
  InstallerService,
  OperationSummary,
} from "@vestra/installer";
import type { DiscordChannel } from "../shared/channels.js";

const execute = promisify(execFile);
const imageNames = {
  stable: "Discord.exe",
  ptb: "DiscordPTB.exe",
  canary: "DiscordCanary.exe",
} as const;
export interface DiscordProcess {
  pid: number;
  executable: string;
}
export interface DiscordSystem {
  processes(): Promise<DiscordProcess[]>;
  stop(process: DiscordProcess): Promise<void>;
  launch(executable: string, args: string[]): Promise<void>;
  exists(filename: string): boolean;
  wait(ms: number): Promise<void>;
}

export function belongsToRoot(executable: string, root: string): boolean {
  if (!path.win32.isAbsolute(executable) || !path.win32.isAbsolute(root))
    return false;
  const relative = path.win32.relative(root, executable);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.win32.isAbsolute(relative)
  );
}

export const windowsDiscordSystem: DiscordSystem = {
  async processes() {
    const script =
      "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='Discord.exe' OR Name='DiscordPTB.exe' OR Name='DiscordCanary.exe' OR Name='Update.exe'\" | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress";
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const { stdout } = await execute(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 15000 },
    );
    const parsed: unknown = JSON.parse(stdout.trim() || "[]");
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.flatMap(
      (entry: { ProcessId?: unknown; ExecutablePath?: unknown }) =>
        Number.isInteger(entry?.ProcessId) &&
        typeof entry.ExecutablePath === "string"
          ? [
              {
                pid: entry.ProcessId as number,
                executable: entry.ExecutablePath,
              },
            ]
          : [],
    );
  },
  async stop(process) {
    try {
      await execute("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 15000,
      });
    } catch (error) {
      if (
        (await windowsDiscordSystem.processes()).some(
          (candidate) => candidate.pid === process.pid,
        )
      )
        throw error;
    }
  },
  async launch(executable, args) {
    const env = { ...process.env };
    delete env["ELECTRON_RUN_AS_NODE"];
    delete env["NODE_OPTIONS"];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  },
  exists: (filename) => fs.existsSync(filename),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class DiscordLifecycle {
  private busy = false;
  constructor(
    private readonly service: InstallerService,
    private readonly system: DiscordSystem = windowsDiscordSystem,
  ) {}

  async updaterBusy(install: DiscordInstallation): Promise<boolean> {
    return (await this.system.processes()).some(
      (proc) =>
        belongsToRoot(proc.executable, install.rootDir) &&
        path.win32.basename(proc.executable).toLowerCase() === "update.exe",
    );
  }

  async run(
    kind: "install" | "repair" | "uninstall",
    channel: DiscordChannel,
    onProgress?: (event: InstallerProgressEvent) => void,
  ): Promise<OperationSummary> {
    if (this.busy)
      throw new Error("Another Discord operation is already running.");
    this.busy = true;
    let stopped = false;
    let target: DiscordInstallation | undefined;
    try {
      target = (await this.service.discover({ channels: [channel] }))[0];
      if (!target) throw new Error("Discord installation not found.");
      for (let attempt = 0; await this.updaterBusy(target); attempt++) {
        if (attempt >= 30)
          throw new Error(
            "Discord is updating. Wait for its updater to finish, then try again.",
          );
        await this.system.wait(2000);
      }
      // Squirrel can create a newer app-* directory while we wait.
      target = (await this.service.discover({ channels: [channel] }))[0];
      if (!target)
        throw new Error(
          "Discord installation moved during its update. Refresh and try again.",
        );
      onProgress?.({
        operation: kind,
        phase: "stopping",
        installation: target,
      });
      const matching = (await this.system.processes()).filter(
        (proc) =>
          belongsToRoot(proc.executable, target!.rootDir) &&
          path.win32.basename(proc.executable).toLowerCase() ===
            imageNames[channel].toLowerCase(),
      );
      stopped = matching.length > 0;
      for (const proc of matching) await this.system.stop(proc);
      for (let attempt = 0; ; attempt++) {
        const remaining = (await this.system.processes()).filter(
          (proc) =>
            belongsToRoot(proc.executable, target!.rootDir) &&
            path.win32.basename(proc.executable).toLowerCase() ===
              imageNames[channel].toLowerCase(),
        );
        if (remaining.length === 0) break;
        if (attempt >= 20)
          throw new Error(
            "Discord did not close. No installation files were changed.",
          );
        await this.system.wait(250);
      }
      if (await this.updaterBusy(target))
        throw new Error(
          "Discord started an update. No installation files were changed; try again when it finishes.",
        );
      const args = { channels: [channel], onProgress };
      const result =
        kind === "uninstall"
          ? await this.service.uninstall({ ...args, purge: false })
          : kind === "install"
            ? await this.service.install({ ...args, force: true })
            : await this.service.repair(args);
      if (!result.ok) return result;
      const checked = await this.service.check({ channels: [channel] });
      const verified = checked.statuses.find(
        (status) => status.installation.channel === channel,
      );
      if (
        !verified ||
        (kind === "uninstall"
          ? verified.vestraInstalled
          : verified.health !== "healthy")
      ) {
        throw new Error("Discord verification failed after " + kind + ".");
      }
      onProgress?.({
        operation: kind,
        phase: "restarting",
        installation: target,
      });
      await this.restart(channel, target);
      stopped = false;
      return result;
    } finally {
      // A failed install still leaves the user with their original Discord.
      try {
        if (stopped && target) await this.restart(channel, target);
      } finally {
        this.busy = false;
      }
    }
  }

  private async restart(
    channel: DiscordChannel,
    fallback: DiscordInstallation,
  ): Promise<void> {
    const current =
      (await this.service.discover({ channels: [channel] }))[0] ?? fallback;
    const executable = path.join(current.appDir, imageNames[channel]);
    if (!this.system.exists(executable))
      throw new Error("Discord executable not found. Open Discord manually.");
    // Start the verified version directly. Update.exe can replace it again before launch.
    await this.system.launch(executable, []);
  }
}
