import { app, BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { InstallerService } from "@vestra/installer";
import {
  MANAGER_IPC,
  isDiscordChannel,
  type DiscordChannel,
} from "../shared/channels.js";
import type { UpdateState } from "../shared/updates.js";
import {
  findRelease,
  downloadPackage,
  verifyPackage,
  type ReleasePackage,
} from "./githubUpdates.js";
import { launchUpdateHelper } from "./updateHandoff.js";
import { isManagerSender } from "./sender.js";
import { DiscordLifecycle } from "./discordLifecycle.js";
import { MaintenanceController, withInstallLock } from "./maintenance.js";

interface Pending {
  token: string;
  version: string;
  created: number;
  channels: DiscordChannel[];
}
export interface UpdateHost {
  version?: string;
  supported?: boolean;
  request?: typeof fetch;
  handoff?: typeof launchUpdateHelper;
  quit?: () => void;
  lifecycle?: Pick<DiscordLifecycle, "run">;
}
export class ManagerUpdates {
  private state: UpdateState;
  private release: ReleasePackage | undefined;
  private packageFile: string | undefined;
  private busy = false;
  private resumePending = false;
  private distributionInfo: { portable: boolean; target: string } | undefined;
  private get home(): string {
    return this.service.context.homeDir;
  }
  private get directory(): string {
    return path.join(this.home, "updates");
  }
  private get pendingFile(): string {
    return path.join(this.directory, "pending.json");
  }
  constructor(
    private service: InstallerService,
    private maintenance: MaintenanceController,
    private host: UpdateHost = {},
  ) {
    this.state = {
      phase: "idle",
      currentVersion: host.version ?? app.getVersion(),
      supported:
        host.supported ??
        (app.isPackaged &&
          process.platform === "win32" &&
          process.arch === "x64"),
    };
  }
  snapshot(): UpdateState {
    return { ...this.state };
  }
  private async distribution(): Promise<{ portable: boolean; target: string }> {
    if (this.distributionInfo) return this.distributionInfo;
    const filename = path.join(this.home, "manager-installation.json");
    const root = path.resolve(
      process.env["LOCALAPPDATA"] ??
        path.join(app.getPath("home"), "AppData", "Local"),
      "Vestra",
      "maintenance",
    );
    const recovery = path
      .resolve(process.execPath)
      .toLowerCase()
      .startsWith(root.toLowerCase() + path.sep);
    if (recovery) {
      try {
        const saved = JSON.parse(await fs.readFile(filename, "utf8"));
        if (
          typeof saved.portable === "boolean" &&
          typeof saved.target === "string" &&
          path.isAbsolute(saved.target) &&
          path.extname(saved.target).toLowerCase() === ".exe"
        ) {
          await fs.access(saved.target);
          this.distributionInfo = saved;
          return saved;
        }
      } catch {}
      throw new Error(
        "Open your original Vestra Manager to update it. Its installation location is unavailable.",
      );
    }
    const info = {
      portable: Boolean(process.env["PORTABLE_EXECUTABLE_FILE"]),
      target: process.env["PORTABLE_EXECUTABLE_FILE"] ?? process.execPath,
    };
    await fs.mkdir(this.home, { recursive: true });
    await fs.writeFile(filename, JSON.stringify(info));
    this.distributionInfo = info;
    return info;
  }
  private async publish(patch: Partial<UpdateState>): Promise<void> {
    this.state = { ...this.state, ...patch };
    for (const win of BrowserWindow.getAllWindows())
      if (!win.webContents.isDestroyed())
        win.webContents.send(MANAGER_IPC.updateState, this.snapshot());
    await fs.mkdir(this.home, { recursive: true });
    const status = JSON.stringify({
      available: ["available", "ready", "downloading"].includes(
        this.state.phase,
      ),
      version: this.state.version,
      checkedAt: this.state.checkedAt,
    });
    await fs.writeFile(path.join(this.home, "update-status.json.tmp"), status);
    await fs.rename(
      path.join(this.home, "update-status.json.tmp"),
      path.join(this.home, "update-status.json"),
    );
  }
  private async exclusive(
    operation: () => Promise<void>,
  ): Promise<UpdateState> {
    if (this.busy) return this.snapshot();
    this.busy = true;
    try {
      await operation();
    } catch (error) {
      await this.publish({
        phase: this.resumePending ? "ready" : "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.busy = false;
    }
    return this.snapshot();
  }
  check(): Promise<UpdateState> {
    return this.exclusive(async () => {
      if (!this.state.supported) {
        await this.publish({
          phase: "idle",
          message:
            "Automatic updates are available in packaged Windows x64 builds.",
        });
        return;
      }
      if (this.state.phase === "ready") return;
      await this.publish({
        phase: "checking",
        message: "Checking GitHub releases…",
      });
      const distribution = await this.distribution();
      this.release = await findRelease(
        this.state.currentVersion,
        distribution.portable ? "Portable" : "Setup",
        this.host.request,
      );
      await this.publish({
        phase: this.release ? "available" : "current",
        ...(this.release ? { version: this.release.version } : {}),
        checkedAt: Date.now(),
        message: this.release
          ? "An update is available."
          : "You have the latest compatible release.",
      });
    });
  }
  download(): Promise<UpdateState> {
    return this.exclusive(async () => {
      if (!this.release || !this.state.supported)
        throw new Error("Check for an update first.");
      await this.publish({
        phase: "downloading",
        progress: 0,
        message: "Downloading and verifying the update…",
      });
      let last = -1;
      this.packageFile = await downloadPackage(
        this.directory,
        this.release,
        (progress) => {
          if (progress !== last) {
            last = progress;
            this.state = { ...this.state, progress };
            for (const win of BrowserWindow.getAllWindows())
              if (!win.webContents.isDestroyed())
                win.webContents.send(MANAGER_IPC.updateState, this.snapshot());
          }
        },
        this.host.request,
      );
      await this.publish({
        phase: "ready",
        progress: 100,
        message: "Verified and ready. Install when you can restart Discord.",
      });
    });
  }
  install(): Promise<UpdateState> {
    if (this.resumePending)
      return this.finish(true).then(() => this.snapshot());
    return this.exclusive(() =>
      withInstallLock(this.home, async () => {
        if (this.state.phase !== "ready" || !this.packageFile || !this.release)
          throw new Error("Download and verify the update first.");
        await verifyPackage(this.packageFile, this.release);
        const distribution = await this.distribution();
        const pending: Pending = {
          token: randomUUID(),
          version: this.release.version,
          created: Date.now(),
          channels: [],
        };
        // Never install into channels that have not already opted into Vestra.
        const status = await this.service.status();
        pending.channels = [
          ...new Set(
            status.statuses
              .filter((s) => s.vestraInstalled)
              .map((s) => s.installation.channel),
          ),
        ];
        await fs.writeFile(this.pendingFile, JSON.stringify(pending));
        await this.publish({
          phase: "installing",
          message: "Restarting Manager to install the update…",
        });
        await (this.host.handoff ?? launchUpdateHelper)(
          {
            pid: process.pid,
            packageFile: this.packageFile,
            ...distribution,
            release: this.release,
            token: pending.token,
            errorFile: path.join(this.directory, "handoff-error.txt"),
          },
          this.directory,
        );
        (this.host.quit ?? (() => app.quit()))();
      }),
    );
  }
  async finish(approved = false): Promise<void> {
    let pending: Pending;
    try {
      pending = JSON.parse(await fs.readFile(this.pendingFile, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        await this.publish({
          phase: "error",
          message:
            "Update handoff could not be read. Use Repair to finish updating Discord.",
        });
      return;
    }
    if (
      !pending ||
      typeof pending !== "object" ||
      typeof pending.token !== "string" ||
      !pending.token
    ) {
      await this.publish({
        phase: "error",
        message:
          "The update handoff is invalid. Use Repair to finish updating Discord.",
      });
      return;
    }
    const argument = process.argv.find((value) =>
      value.startsWith("--finish-update="),
    );
    const valid =
      pending.version === this.state.currentVersion &&
      Number.isFinite(pending.created) &&
      Date.now() - pending.created >= 0 &&
      Date.now() - pending.created <= 24 * 60 * 60 * 1000 &&
      Array.isArray(pending.channels) &&
      pending.channels.every(isDiscordChannel);
    if (!argument && !approved) {
      if (valid) {
        this.resumePending = true;
        await this.publish({
          phase: "ready",
          version: pending.version,
          message:
            "Manager was updated. Finish updating Discord when you can restart it.",
        });
        return;
      }
      let failure = "";
      try {
        failure = await fs.readFile(
          path.join(this.directory, "handoff-error.txt"),
          "utf8",
        );
      } catch {}
      await this.publish({
        phase: "error",
        message:
          failure ||
          "An update was interrupted. Check for updates to retry, or use Repair to finish updating Discord.",
      });
      return;
    }
    if (
      !valid ||
      (!approved &&
        pending.token !== argument?.slice("--finish-update=".length))
    ) {
      await this.publish({
        phase: "error",
        message:
          "The update handoff is expired or does not match this Manager. No Discord files were changed.",
      });
      return;
    }
    this.resumePending = true;
    await this.exclusive(async () => {
      await this.publish({
        phase: "installing",
        version: pending.version,
        message: "Updating your Discord installations…",
      });
      const lifecycle =
        this.host.lifecycle ?? new DiscordLifecycle(this.service);
      await withInstallLock(this.home, async () => {
        for (const channel of [...new Set(pending.channels)]) {
          const result = await lifecycle.run("repair", channel);
          if (!result.ok)
            throw new Error(
              result.results.map((r) => r.detail ?? r.action).join("; "),
            );
          await this.maintenance.track(channel, true);
        }
      });
      await fs.rm(this.pendingFile, { force: true });
      this.resumePending = false;
      await fs.rm(path.join(this.directory, "handoff-error.txt"), {
        force: true,
      });
      await this.publish({
        phase: "current",
        checkedAt: Date.now(),
        message:
          "Vestra was updated. Your themes, plugins and preferences were kept.",
      });
    });
  }
  register(): void {
    const url = pathToFileURL(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "renderer",
        "index.html",
      ),
    ).href;
    for (const [channel, handler] of [
      [MANAGER_IPC.updateGet, () => this.snapshot()],
      [MANAGER_IPC.updateCheck, () => this.check()],
      [MANAGER_IPC.updateDownload, () => this.download()],
      [MANAGER_IPC.updateInstall, () => this.install()],
    ] as const)
      ipcMain.handle(channel, (event) => {
        if (!isManagerSender(event, url))
          throw new Error("Untrusted update request.");
        return handler();
      });
  }
}
