// Manager renderer tests (happy-dom + node:test, no Vitest/Jest/RTL).
// Fixture-backed fake bridge only — never a real Discord install.
// Covers: rows and their one-line status, shallow->deep transitions,
// install/repair/restart/uninstall flows, overflow menu, confirmation,
// inline progress, friendly errors, update card visibility, footer, refresh.

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const happyWindow = new Window({ url: "http://localhost/" });
const g = globalThis as unknown as Record<string, unknown>;
g["window"] = happyWindow;
g["document"] = happyWindow.document;
g["navigator"] = happyWindow.navigator;
g["HTMLElement"] = happyWindow.HTMLElement;
g["Element"] = happyWindow.Element;
g["Node"] = happyWindow.Node;
g["Text"] = happyWindow.Text;
g["DocumentFragment"] = happyWindow.DocumentFragment;
g["Event"] = happyWindow.Event;
g["MouseEvent"] = happyWindow.MouseEvent;
g["KeyboardEvent"] = happyWindow.KeyboardEvent;
g["CustomEvent"] = happyWindow.CustomEvent;
g["IS_REACT_ACT_ENVIRONMENT"] = true;
if (g["requestAnimationFrame"] === undefined) {
  g["requestAnimationFrame"] = (cb: (...args: unknown[]) => void): number => {
    const id = setTimeout(() => cb(Date.now()), 0);
    return id as unknown as number;
  };
}

// Dynamic imports: React must resolve DOM globals present above.
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { App } = await import("../src/renderer/App.js");
const { formatShortDate, formatStartedAt } = await import(
  "../src/shared/statusModel.js"
);
import type { DiscordChannel } from "../src/shared/channels.js";
import type {
  CheckSummary,
  DiscordInstallation,
  InstallerProgressEvent,
  MaintenanceStatus,
  OperationSummary,
  RunStatusMap,
  StatusSummary,
} from "../src/shared/types.js";
import type { UpdateState } from "../src/shared/updates.js";
import type { RunState } from "@vestra/shared";
import type { ChannelRecovery } from "../src/main/recovery/state.js";

function installEntry(
  channel: DiscordChannel,
  version: string,
): DiscordInstallation {
  return {
    channel,
    version,
    rootDir: `/fake/${channel}`,
    appDir: `/fake/${channel}/app-1.0.0`,
    asarPath: `/fake/${channel}/app-1.0.0/resources/app.asar`,
    isActive: true,
  };
}

interface RecordedCall {
  method: string;
  args: unknown;
}

class FakeApi {
  update: UpdateState = {
    phase: "current",
    currentVersion: "0.1.0-alpha.3",
    supported: true,
  };
  async updateState() {
    return this.update;
  }
  async checkUpdate() {
    return this.update;
  }
  async downloadUpdate() {
    return this.update;
  }
  async installUpdate() {
    return this.update;
  }
  async dismissUpdateError() {
    const { handoffError: _dropped, ...rest } = this.update;
    this.update = rest;
    return this.update;
  }
  onUpdate() {
    return () => {};
  }
  windowAction(action: string): void {
    this.calls.push({ method: "windowAction", args: action });
  }
  onWindowState(listener: (state: { maximized: boolean }) => void): () => void {
    listener({ maximized: false });
    return () => undefined;
  }
  installations: DiscordInstallation[] = [
    installEntry("stable", "1.0.1000"),
    installEntry("canary", "1.0.1156"),
  ];
  installed = new Set<DiscordChannel>();
  drifted = new Set<DiscordChannel>();
  running = new Set<DiscordChannel>();
  run: Partial<Record<DiscordChannel, RunState>> = {};
  recovery: Partial<Record<DiscordChannel, ChannelRecovery>> = {};
  maintenance: MaintenanceStatus = {
    available: true,
    enabled: true,
    channels: ["canary"],
  };
  devMode = false;
  failDiscover: string | null = null;
  failStatus: string | null = null;
  failRunStatus = false;
  failCheck: string | null = null;
  checkGate: Promise<void> | null = null;
  installGate: Promise<void> | null = null;
  failNext: {
    method: "install" | "repair" | "uninstall";
    code: string;
    detail: string;
  } | null = null;
  calls: RecordedCall[] = [];
  progressListeners: Array<(e: InstallerProgressEvent) => void> = [];
  emitted: InstallerProgressEvent[] = [];

  private emit(event: InstallerProgressEvent): void {
    this.emitted.push(event);
    for (const listener of this.progressListeners) listener(event);
  }

  async discover(): Promise<DiscordInstallation[]> {
    this.calls.push({ method: "discover", args: undefined });
    if (this.failDiscover !== null) throw new Error(this.failDiscover);
    return this.installations;
  }

  async status(args?: { channels?: DiscordChannel[] }): Promise<StatusSummary> {
    this.calls.push({ method: "status", args });
    if (this.failStatus !== null) throw new Error(this.failStatus);
    const wanted = args?.channels ?? this.installations.map((i) => i.channel);
    return {
      statuses: this.installations
        .filter((i) => wanted.includes(i.channel))
        .map((installation) =>
          this.installed.has(installation.channel)
            ? {
                installation,
                health: "healthy" as const,
                vestraInstalled: true,
                repairable: false,
                detail: "installed (not deep-verified)",
              }
            : {
                installation,
                health: "not-installed" as const,
                vestraInstalled: false,
                repairable: true,
                detail: "not installed",
              },
        ),
      stale: [],
    };
  }

  async check(args?: { channels?: DiscordChannel[] }): Promise<CheckSummary> {
    this.calls.push({ method: "check", args });
    if (this.checkGate !== null) await this.checkGate;
    if (this.failCheck !== null) throw new Error(this.failCheck);
    const wanted = args?.channels ?? this.installations.map((i) => i.channel);
    return {
      statuses: this.installations
        .filter((i) => wanted.includes(i.channel))
        .map((installation) => {
          if (!this.installed.has(installation.channel)) {
            return {
              installation,
              health: "not-installed" as const,
              vestraInstalled: false,
              repairable: true,
              detail: "not installed",
            };
          }
          if (this.drifted.has(installation.channel)) {
            return {
              installation,
              health: "drifted" as const,
              vestraInstalled: true,
              repairable: true,
              detail: "asar drifted (hook or bundle mismatch)",
              code: "verification-failed" as const,
            };
          }
          return {
            installation,
            health: "healthy" as const,
            vestraInstalled: true,
            repairable: false,
            detail: "healthy",
          };
        }),
      stale: [],
    };
  }

  async runStatus(): Promise<RunStatusMap> {
    this.calls.push({ method: "runStatus", args: undefined });
    if (this.failRunStatus) throw new Error("run status unavailable");
    const out: RunStatusMap = {};
    for (const { channel } of this.installations) {
      const recovery = this.recovery[channel];
      out[channel] = {
        run: this.run[channel] ?? { kind: "not-started" },
        ...(recovery ? { recovery } : {}),
      };
    }
    return out;
  }

  async discordRunning(args: { channels: DiscordChannel[] }): Promise<boolean> {
    this.calls.push({ method: "discordRunning", args });
    return this.running.has(args.channels[0] as DiscordChannel);
  }

  async restartDiscord(args: {
    channels: DiscordChannel[];
  }): Promise<OperationSummary> {
    this.calls.push({ method: "restartDiscord", args });
    const channel = args.channels[0] as DiscordChannel;
    this.installed.add(channel);
    delete this.recovery[channel];
    return {
      ok: true,
      results: [
        { asarPath: `/fake/${channel}/app.asar`, channel, ok: true, action: "repaired" },
      ],
    };
  }

  async maintenanceStatus(): Promise<MaintenanceStatus> {
    return this.maintenance;
  }

  async setMaintenance(enabled: boolean): Promise<MaintenanceStatus> {
    this.calls.push({ method: "setMaintenance", args: enabled });
    this.maintenance = { ...this.maintenance, enabled };
    return this.maintenance;
  }

  async install(args: {
    channels: DiscordChannel[];
  }): Promise<OperationSummary> {
    this.calls.push({ method: "install", args });
    const channel = args.channels[0] as DiscordChannel;
    this.emit({ operation: "install", phase: "discovering" });
    this.emit({ operation: "install", phase: "staging", total: 1 });
    this.emit({
      operation: "install",
      phase: "patching",
      installation: this.installations.find((i) => i.channel === channel),
      index: 0,
      total: 1,
    });
    if (this.installGate !== null) await this.installGate;
    this.emit({ operation: "install", phase: "verifying", total: 1 });
    if (this.failNext?.method === "install") {
      const { code, detail } = this.failNext;
      this.failNext = null;
      return {
        ok: false,
        results: [
          {
            asarPath: `/fake/${channel}/app.asar`,
            channel,
            ok: false,
            action: "failed",
            detail,
            code: code as "verification-failed",
          },
        ],
      };
    }
    this.installed.add(channel);
    this.drifted.delete(channel);
    this.emit({ operation: "install", phase: "complete", total: 1 });
    return {
      ok: true,
      results: [
        {
          asarPath: `/fake/${channel}/app.asar`,
          channel,
          ok: true,
          action: "installed",
        },
      ],
    };
  }

  async repair(args: {
    channels: DiscordChannel[];
  }): Promise<OperationSummary> {
    this.calls.push({ method: "repair", args });
    if (this.failNext?.method === "repair") {
      const { code, detail } = this.failNext;
      this.failNext = null;
      const channel = args.channels[0] as DiscordChannel;
      return {
        ok: false,
        results: [
          {
            asarPath: `/fake/${channel}/app.asar`,
            channel,
            ok: false,
            action: "failed",
            detail,
            code: code as "verification-failed",
          },
        ],
      };
    }
    for (const channel of args.channels) {
      this.installed.add(channel);
      this.drifted.delete(channel);
    }
    return {
      ok: true,
      results: args.channels.map((channel) => ({
        asarPath: `/fake/${channel}/app.asar`,
        channel,
        ok: true,
        action: "repaired",
      })),
    };
  }

  async uninstall(args: {
    channels: DiscordChannel[];
  }): Promise<OperationSummary> {
    this.calls.push({ method: "uninstall", args });
    for (const channel of args.channels) {
      this.installed.delete(channel);
      this.drifted.delete(channel);
    }
    return {
      ok: true,
      results: args.channels.map((channel) => ({
        asarPath: `/fake/${channel}/app.asar`,
        channel,
        ok: true,
        action: "uninstalled",
      })),
    };
  }

  onProgress(listener: (e: InstallerProgressEvent) => void): () => void {
    this.progressListeners.push(listener);
    return () => undefined;
  }

  isDevelopmentBuild(): boolean {
    return this.devMode;
  }
}

// happy-dom classes are nominally distinct from DOM lib types; bridge with
// happy-dom's own exported types plus casts at the react-dom/DOM boundary.
import type { Element as HappyElement, Node as HappyNode } from "happy-dom";

let container: HappyElement;
let root: { render(node: unknown): void; unmount(): void } | null = null;
let fake: FakeApi;

function text(): string {
  return container.textContent ?? "";
}

function byTestId(id: string): HappyElement | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

function statusOf(channel: DiscordChannel): string {
  return byTestId(`row-status-${channel}`)?.textContent ?? "";
}

function callsOf(method: string): RecordedCall[] {
  return fake.calls.filter((c) => c.method === method);
}

async function settle(ticks = 20): Promise<void> {
  await act(async () => {
    for (let i = 0; i < ticks; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function mount(): Promise<void> {
  root = createRoot(container as unknown as Element);
  await act(async () => {
    root?.render(React.createElement(App));
  });
  await settle();
}

function click(el: HappyElement | null): Promise<void> {
  assert.ok(el !== null, "expected element to click");
  return act(async () => {
    el.dispatchEvent(new happyWindow.MouseEvent("click", { bubbles: true }));
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function key(el: HappyElement | null, name: string): Promise<void> {
  assert.ok(el !== null, "expected element for key press");
  return act(async () => {
    el.dispatchEvent(
      new happyWindow.KeyboardEvent("keydown", { key: name, bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function focused(): unknown {
  return happyWindow.document.activeElement;
}

beforeEach(() => {
  fake = new FakeApi();
  (happyWindow as unknown as Record<string, unknown>)["vestraManager"] = fake;
  container = happyWindow.document.createElement(
    "div",
  ) as unknown as HappyElement;
  (container as unknown as { id: string }).id = "root";
  happyWindow.document.body.appendChild(container as unknown as HappyNode);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  fake.checkGate = null;
});

describe("manager renderer", () => {
  test("title bar has window controls and no window material picker", async () => {
    await mount();
    assert.equal(container.querySelectorAll("select").length, 0);
    assert.doesNotMatch(text(), /Window finish|Mica|Acrylic/);
    assert.ok(container.querySelector('[aria-label="Minimize window"]'));
    assert.ok(container.querySelector('[aria-label="Maximize window"]'));
    assert.ok(container.querySelector('[aria-label="Close window"]'));
    assert.equal(
      happyWindow.document.documentElement.dataset["windowMaterial"],
      undefined,
    );
  });

  test("1+2. boots with mocked service; Stable + Canary rows render", async () => {
    await mount();
    assert.ok(byTestId("install-card-stable"), "stable row renders");
    assert.ok(byTestId("install-card-canary"), "canary row renders");
    assert.match(text(), /Discord Stable/);
    assert.match(text(), /Discord Canary/);
    assert.equal(byTestId("version-canary")?.textContent, "1.0.1156");
  });

  test("the long operation hint paragraph is gone", async () => {
    await mount();
    assert.doesNotMatch(text(), /Install and Repair close/);
    assert.equal(container.querySelector(".vs-operation-hint"), null);
  });

  test("3. production default: Stable carries the Recommended badge", async () => {
    await mount();
    assert.equal(byTestId("badge-stable")?.textContent, "Recommended");
    assert.equal(byTestId("badge-canary"), null);
  });

  test("4. development mode: Stable carries the Development target badge", async () => {
    fake.devMode = true;
    await mount();
    assert.equal(byTestId("badge-stable")?.textContent, "Development target");
    assert.equal(byTestId("badge-canary"), null);
  });

  test("5. a single installation renders its row", async () => {
    fake.installations = [installEntry("ptb", "1.0.900")];
    await mount();
    assert.ok(byTestId("install-card-ptb"), "ptb row renders");
    assert.equal(statusOf("ptb"), "Not installed");
  });

  test("6. not-installed row shows Not installed and Install Vestra only", async () => {
    await mount();
    assert.equal(statusOf("canary"), "Not installed");
    assert.equal(byTestId("install-canary")?.textContent, "Install Vestra");
    assert.equal(byTestId("row-menu-canary"), null, "nothing to repair or remove");
  });

  test("7. shallow installed shows Checking…, never active", async () => {
    fake.installed.add("canary");
    fake.run.canary = { kind: "active", at: Date.now() };
    let release!: () => void;
    fake.checkGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mount();
    await settle(5);
    assert.equal(statusOf("canary"), "Checking…");
    assert.ok(!text().includes("Vestra active"), "never shallow-active");
    release();
    await settle();
  });

  test("8. active row shows exact copy and no primary button", async () => {
    const at = Date.now();
    fake.installed.add("canary");
    fake.run.canary = { kind: "active", at };
    await mount();
    assert.equal(
      statusOf("canary"),
      `Vestra active · started ${formatStartedAt(at, new Date())}`,
    );
    for (const id of ["install", "repair", "retry", "restart"])
      assert.equal(byTestId(`${id}-canary`), null, `no ${id} button`);
    assert.ok(byTestId("row-menu-canary"), "overflow menu offered");
  });

  test("installed with no start records reads neutral, not active or failed", async () => {
    fake.installed.add("canary");
    await mount();
    assert.equal(statusOf("canary"), "Installed · will start next time Discord opens");
    assert.equal(byTestId("repair-canary"), null);
    assert.doesNotMatch(text(), /didn't start|Vestra active/);
  });

  test("a failing run-status bridge falls back to the neutral copy", async () => {
    fake.installed.add("canary");
    fake.failRunStatus = true;
    await mount();
    assert.equal(statusOf("canary"), "Installed · will start next time Discord opens");
    assert.equal(byTestId("error-panel"), null);
  });

  test("awaiting login reads neutral", async () => {
    fake.installed.add("canary");
    fake.run.canary = { kind: "awaiting-login" };
    await mount();
    assert.equal(statusOf("canary"), "Installed · starts after you log in to Discord");
  });

  test("didn't start shows the plain reason and a Repair button", async () => {
    fake.installed.add("canary");
    fake.run.canary = { kind: "failed", at: Date.now(), reason: "subframe" };
    await mount();
    assert.equal(
      statusOf("canary"),
      "Installed, but didn't start — Discord's window wasn't recognized",
    );
    assert.equal(byTestId("repair-canary")?.textContent, "Repair");
    await click(byTestId("repair-canary"));
    assert.equal(byTestId("confirm-dialog"), null, "Discord closed: no warning");
    assert.equal(callsOf("repair").length, 1);
    assert.match(text(), /Vestra repaired successfully/);
  });

  test("9. deep check drift becomes Needs repair with Repair", async () => {
    fake.installed.add("canary");
    fake.drifted.add("canary");
    await mount();
    assert.equal(statusOf("canary"), "Needs repair");
    assert.equal(byTestId("repair-canary")?.textContent, "Repair");
    await click(byTestId("row-menu-canary"));
    const items = Array.from(container.querySelectorAll('[role="menuitem"]'));
    assert.deepEqual(
      items.map((item) => item.textContent),
      ["Uninstall"],
      "the menu does not repeat the primary Repair",
    );
    assert.equal(container.querySelectorAll('[data-testid="repair-canary"]').length, 1);
  });

  test("check failure shows Couldn't check; Try again re-runs the check only", async () => {
    fake.installed.add("canary");
    fake.failCheck = "check backend down";
    await mount();
    assert.equal(statusOf("canary"), "Couldn't check");
    assert.equal(byTestId("retry-canary")?.textContent, "Try again");
    fake.failCheck = null;
    const checksBefore = callsOf("check").length;
    await click(byTestId("retry-canary"));
    assert.equal(callsOf("check").length, checksBefore + 1);
    assert.equal(callsOf("repair").length, 0, "Try again never kills Discord");
    assert.equal(statusOf("canary"), "Installed · will start next time Discord opens");
  });

  test("waiting for exit shows Restart Discord, which restarts only that Discord", async () => {
    fake.recovery.canary = {
      phase: "waiting-for-exit",
      version: "1.0.1156",
      at: Date.now(),
      attempts: 0,
    };
    fake.running.add("canary");
    await mount();
    assert.equal(statusOf("canary"), "Waiting for Discord restart");
    assert.equal(byTestId("restart-canary")?.textContent, "Restart Discord");
    assert.equal(byTestId("install-canary"), null);
    assert.equal(callsOf("restartDiscord").length, 0, "never restarts on its own");
    fake.run.canary = { kind: "active", at: Date.now() };
    await click(byTestId("restart-canary"));
    const restarts = callsOf("restartDiscord");
    assert.equal(restarts.length, 1);
    assert.deepEqual((restarts[0]?.args as { channels: string[] }).channels, ["canary"]);
    assert.equal(callsOf("install").length + callsOf("repair").length, 0);
    assert.match(statusOf("canary"), /^Vestra active · started /);
  });

  test("10+11. Install sends one channel, then verifies and refreshes run status", async () => {
    await mount();
    const runBefore = callsOf("runStatus").length;
    await click(byTestId("install-canary"));
    const installs = callsOf("install");
    assert.equal(installs.length, 1);
    assert.deepEqual((installs[0]?.args as { channels: string[] }).channels, [
      "canary",
    ]);
    assert.ok(callsOf("check").length >= 2, "deep check runs after install");
    assert.ok(callsOf("runStatus").length > runBefore, "run status refetched");
    assert.match(text(), /Vestra installed successfully/);
    assert.equal(statusOf("canary"), "Installed · will start next time Discord opens");
  });

  test("Install warns only when that Discord is running", async () => {
    fake.running.add("canary");
    await mount();
    await click(byTestId("install-canary"));
    const dialog = byTestId("confirm-dialog");
    assert.ok(dialog, "running Discord needs confirmation");
    assert.match(dialog.textContent ?? "", /Discord will restart\. Calls and streams will disconnect\./);
    assert.equal(callsOf("install").length, 0, "nothing runs before confirm");
    await click(byTestId("confirm-continue"));
    assert.equal(callsOf("install").length, 1);
    assert.equal(byTestId("confirm-dialog"), null);
  });

  test("progress replaces the row's buttons inline while an operation runs", async () => {
    let release!: () => void;
    fake.installGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mount();
    // The gated install is still running when the click's act settles.
    await click(byTestId("install-canary"));
    const row = byTestId("install-card-canary");
    const progress = row?.querySelector('[data-testid="progress-panel"]');
    assert.ok(progress, "progress sits inside the row");
    assert.match(progress.textContent ?? "", /Patching Discord Canary/);
    assert.equal(byTestId("install-canary"), null, "button replaced by progress");
    const stableButton = byTestId("install-stable") as unknown as HTMLButtonElement;
    assert.equal(stableButton.disabled, true, "other rows wait");
    release();
    await settle();
    assert.equal(byTestId("progress-panel"), null);
  });

  test("12. healthy Repair from the overflow menu still reinstalls Vestra", async () => {
    fake.installed.add("canary");
    fake.run.canary = { kind: "active", at: Date.now() };
    await mount();
    const before = callsOf("repair").length;
    await click(byTestId("row-menu-canary"));
    await click(byTestId("repair-canary"));
    assert.equal(callsOf("repair").length, before + 1, "repair called even when healthy");
    assert.match(text(), /Vestra repaired successfully/);
  });

  test("13. drifted repair only touches the selected channel", async () => {
    fake.installed.add("stable");
    fake.installed.add("canary");
    fake.drifted.add("canary");
    await mount();
    await click(byTestId("repair-canary"));
    const repairs = callsOf("repair");
    assert.equal(repairs.length, 1);
    assert.deepEqual((repairs[0]?.args as { channels: string[] }).channels, [
      "canary",
    ]);
    assert.match(text(), /repaired successfully/);
  });

  test("overflow menu is keyboard accessible and returns focus", async () => {
    fake.installed.add("canary");
    await mount();
    const button = byTestId("row-menu-canary");
    assert.ok(button);
    assert.equal(button.getAttribute("aria-haspopup"), "menu");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(button.getAttribute("aria-label"), "More actions for Discord Canary");
    await click(button);
    assert.equal(button.getAttribute("aria-expanded"), "true");
    const menu = container.querySelector('[role="menu"]');
    assert.ok(menu);
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    assert.deepEqual(items.map((i) => i.textContent), ["Repair", "Uninstall"]);
    assert.equal(focused(), items[0], "first item focused on open");
    await key(items[0] ?? null, "ArrowDown");
    assert.equal(focused(), items[1]);
    await key(items[1] ?? null, "ArrowDown");
    assert.equal(focused(), items[0], "wraps around");
    await key(items[0] ?? null, "Escape");
    assert.equal(container.querySelector('[role="menu"]'), null, "Escape closes");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(focused(), button, "focus returns to the menu button");
  });

  test("14+15. Uninstall lives in the menu, needs confirmation, sends no purge flag", async () => {
    fake.installed.add("canary");
    await mount();
    await click(byTestId("row-menu-canary"));
    await click(byTestId("uninstall-canary"));
    assert.ok(byTestId("confirm-dialog"), "confirmation required");
    assert.match(byTestId("confirm-dialog")?.textContent ?? "", /Remove Vestra from Discord Canary\?/);
    assert.equal(callsOf("uninstall").length, 0, "no uninstall before confirm");
    await click(byTestId("confirm-cancel"));
    assert.equal(byTestId("confirm-dialog"), null);
    assert.equal(callsOf("uninstall").length, 0);
    await click(byTestId("row-menu-canary"));
    await click(byTestId("uninstall-canary"));
    await key(byTestId("confirm-dialog"), "Escape");
    assert.equal(byTestId("confirm-dialog"), null, "Escape cancels");
    await click(byTestId("row-menu-canary"));
    await click(byTestId("uninstall-canary"));
    await click(byTestId("confirm-uninstall"));
    const uninstalls = callsOf("uninstall");
    assert.equal(uninstalls.length, 1);
    const args = uninstalls[0]?.args as { channels: string[]; purge?: boolean };
    assert.deepEqual(args.channels, ["canary"]);
    assert.equal(
      args.purge,
      false,
      "uninstall uses purge=false (main also forces false)",
    );
    assert.equal(statusOf("canary"), "Not installed");
  });

  test("16. progress events update the UI", async () => {
    await mount();
    await click(byTestId("install-canary"));
    const phases = fake.emitted.map((e) => e.phase);
    assert.deepEqual(phases, [
      "discovering",
      "staging",
      "patching",
      "verifying",
      "complete",
    ]);
    assert.ok(fake.emitted.every((e) => e.operation === "install"));
  });

  test("17. failure renders friendly error with details behind disclosure", async () => {
    fake.failNext = {
      method: "install",
      code: "permission-denied",
      detail: "EACCES: permission denied",
    };
    await mount();
    await click(byTestId("install-canary"));
    assert.ok(byTestId("error-panel"), "error panel renders");
    assert.match(text(), /couldn't modify this Discord installation/);
    assert.ok(!text().includes("EACCES"), "raw detail hidden initially");
    await click(byTestId("show-details"));
    assert.match(text(), /EACCES/);
  });

  test("18. refresh reruns discovery, status and run status", async () => {
    await mount();
    const discoveredBefore = callsOf("discover").length;
    const runBefore = callsOf("runStatus").length;
    await click(byTestId("refresh-button"));
    assert.ok(callsOf("discover").length > discoveredBefore, "discover reruns");
    assert.ok(callsOf("runStatus").length > runBefore, "run status reruns");
    assert.ok(byTestId("install-card-stable"));
  });

  test("update card is hidden when there is nothing to act on", async () => {
    await mount();
    assert.equal(container.querySelector(".vs-update-card"), null);
  });

  test("update card shows for an available update", async () => {
    fake.update = { ...fake.update, phase: "available", version: "0.1.0-alpha.4" };
    await mount();
    const card = container.querySelector(".vs-update-card");
    assert.ok(card);
    assert.match(card.textContent ?? "", /Download update/);
  });

  test("a handoff error shows with Dismiss even when no update is pending", async () => {
    fake.update = { ...fake.update, handoffError: "Vestra couldn't finish updating." };
    await mount();
    assert.match(text(), /Vestra couldn't finish updating\./);
    const dismiss = Array.from(container.querySelectorAll(".vs-update-card button")).find(
      (b) => b.textContent === "Dismiss",
    );
    await click(dismiss ?? null);
    assert.equal(container.querySelector(".vs-update-card"), null);
  });

  test("footer toggle names the behaviour and shows the last re-install", async () => {
    const at = new Date(2026, 10, 18, 9, 0).getTime();
    fake.installed.add("canary");
    fake.recovery.canary = { phase: "patched", version: "1.0.1156", at, attempts: 0 };
    await mount();
    const toggle = container.querySelector(
      'input[aria-label="Keep Vestra installed after Discord updates"]',
    ) as unknown as HTMLInputElement | null;
    assert.ok(toggle, "toggle present");
    assert.equal(toggle.checked, true);
    assert.match(text(), /Keep Vestra installed after Discord updates/);
    assert.match(
      text(),
      new RegExp(`Last re-installed into 1\\.0\\.1156 · ${formatShortDate(at, new Date())}`),
    );
  });

  test("footer has no re-install line without a patched record", async () => {
    await mount();
    assert.doesNotMatch(text(), /Last re-installed/);
  });

  test("discover failure shows discovery error, NOT the empty-list message", async () => {
    fake.failDiscover = "preload bridge unreachable";
    await mount();
    assert.ok(byTestId("discovery-error"), "discovery error shown");
    assert.match(text(), /Discord discovery failed/);
    assert.match(text(), /preload bridge unreachable/);
    assert.equal(byTestId("install-list-empty"), null);
    assert.equal(byTestId("install-list"), null);
    const before = callsOf("discover").length;
    fake.failDiscover = null;
    await click(byTestId("discovery-retry"));
    assert.ok(callsOf("discover").length > before, "retry reruns discovery");
    assert.equal(byTestId("discovery-error"), null);
    assert.ok(byTestId("install-card-stable"), "rows render after retry");
  });

  test("successful empty discover keeps the empty-list message", async () => {
    fake.installations = [];
    await mount();
    assert.ok(byTestId("install-list-empty"), "empty message shown");
    assert.match(text(), /No Discord installations detected/);
    assert.equal(byTestId("discovery-error"), null);
  });

  test("status failure does not erase discovered rows", async () => {
    fake.failStatus = "status backend down";
    await mount();
    assert.ok(byTestId("install-card-stable"), "stable row persists");
    assert.ok(byTestId("install-card-canary"), "canary row persists");
    assert.equal(byTestId("discovery-error"), null);
  });

  test("21. renderer tests never touch a real Discord install", async () => {
    await mount();
    const html = happyWindow.document.documentElement.outerHTML;
    assert.ok(!html.includes("LOCALAPPDATA"), "no real paths leak");
    assert.ok(!html.includes("AppData"), "no real paths leak");
    for (const installation of fake.installations) {
      assert.match(installation.asarPath, /^\/fake\//);
    }
  });
});
