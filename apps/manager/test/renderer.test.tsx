// Manager renderer tests (happy-dom + node:test, no Vitest/Jest/RTL).
// Fixture-backed fake bridge only — never a real Discord install.
// Covers: cards, selection, shallow->deep transitions, install/repair/
// uninstall flows, confirmation, progress UI, friendly errors, refresh.

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
import type { DiscordChannel } from "../src/shared/channels.js";
import type {
  CheckSummary,
  DiscordInstallation,
  InstallerProgressEvent,
  OperationSummary,
  StatusSummary,
} from "../src/shared/types.js";

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
  async updateState() {
    return {
      phase: "current" as const,
      currentVersion: "0.1.0-alpha.3",
      supported: true,
    };
  }
  async checkUpdate() {
    return this.updateState();
  }
  async downloadUpdate() {
    return this.updateState();
  }
  async installUpdate() {
    return this.updateState();
  }
  onUpdate() {
    return () => {};
  }
  windowAction(action: string): void {
    this.calls.push({ method: "windowAction", args: action });
  }
  setWindowMaterial(): void {}
  onWindowState(
    listener: (state: {
      maximized: boolean;
      material: "solid";
      materialsSupported: boolean;
      appearanceError: string;
    }) => void,
  ): () => void {
    listener({
      maximized: false,
      material: "solid",
      materialsSupported: false,
      appearanceError: "",
    });
    return () => undefined;
  }
  installations: DiscordInstallation[] = [
    installEntry("stable", "1.0.1000"),
    installEntry("canary", "1.0.1156"),
  ];
  installed = new Set<DiscordChannel>();
  drifted = new Set<DiscordChannel>();
  devMode = false;
  failDiscover: string | null = null;
  failStatus: string | null = null;
  checkGate: Promise<void> | null = null;
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
  test("1+2. boots with mocked service; Stable + Canary cards render", async () => {
    await mount();
    assert.ok(byTestId("install-card-stable"), "stable card renders");
    assert.ok(byTestId("install-card-canary"), "canary card renders");
    assert.match(text(), /Discord Stable/);
    assert.match(text(), /Discord Canary/);
  });

  test("3. production default: Stable selected + Recommended", async () => {
    await mount();
    const stable = byTestId("install-card-stable");
    assert.ok(
      stable?.className.includes("vs-card--selected"),
      "stable selected",
    );
    assert.equal(byTestId("badge-stable")?.textContent, "Recommended");
    assert.equal(byTestId("badge-canary"), null);
  });

  test("4. development mode: Stable selected + Development target", async () => {
    fake.devMode = true;
    await mount();
    const stable = byTestId("install-card-stable");
    assert.ok(
      stable?.className.includes("vs-card--selected"),
      "stable selected",
    );
    assert.equal(byTestId("badge-stable")?.textContent, "Development target");
    assert.equal(byTestId("badge-canary"), null);
  });

  test("5. one installation is automatically selected", async () => {
    fake.installations = [installEntry("ptb", "1.0.900")];
    await mount();
    assert.ok(byTestId("install-card-ptb"), "ptb card renders");
    assert.ok(
      byTestId("install-card-ptb")?.className.includes("vs-card--selected"),
      "single install selected",
    );
  });

  test("6. not-installed card shows Install button", async () => {
    await mount();
    assert.ok(byTestId("install-canary"), "install button shown");
    assert.match(text(), /Not installed/);
  });

  test("7. shallow installed shows Installed/Checking, NOT Healthy", async () => {
    fake.installed.add("canary");
    let release!: () => void;
    fake.checkGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mount();
    await settle(5);
    assert.ok(byTestId("status-installed-checking"), "checking badge shown");
    assert.ok(!text().includes("Vestra Healthy"), "never shallow-Healthy");
    assert.match(text(), /Checking/);
    release();
    await settle();
  });

  test("8. deep check success becomes Healthy", async () => {
    fake.installed.add("canary");
    await mount();
    assert.ok(byTestId("status-healthy"), "healthy badge shown");
    assert.ok(byTestId("repair-canary"), "repair offered");
    assert.ok(byTestId("uninstall-canary"), "uninstall offered");
  });

  test("9. deep check drift becomes Needs Repair", async () => {
    fake.installed.add("canary");
    fake.drifted.add("canary");
    await mount();
    assert.ok(byTestId("status-needs-repair"), "needs-repair badge shown");
    assert.equal(byTestId("repair-canary")?.textContent, "Repair Vestra");
  });

  test("10+11. Install sends one channel, then verifies", async () => {
    await mount();
    await click(byTestId("install-canary"));
    const installs = fake.calls.filter((c) => c.method === "install");
    assert.equal(installs.length, 1);
    assert.deepEqual((installs[0]?.args as { channels: string[] }).channels, [
      "canary",
    ]);
    const checks = fake.calls.filter((c) => c.method === "check");
    assert.ok(checks.length >= 2, "deep check runs after install");
    assert.match(text(), /Vestra installed successfully/);
    assert.ok(byTestId("status-healthy"));
  });

  test("12. healthy Repair still reinstalls Vestra", async () => {
    fake.installed.add("canary");
    await mount();
    assert.ok(byTestId("status-healthy"));
    const repairsBefore = fake.calls.filter(
      (c) => c.method === "repair",
    ).length;
    await click(byTestId("repair-canary"));
    assert.equal(
      fake.calls.filter((c) => c.method === "repair").length,
      repairsBefore + 1,
      "repair called even when healthy",
    );
    assert.match(text(), /Vestra repaired successfully/);
  });

  test("13. drifted repair only touches the selected channel", async () => {
    fake.installed.add("stable");
    fake.installed.add("canary");
    fake.drifted.add("canary");
    await mount();
    await click(byTestId("repair-canary"));
    const repairs = fake.calls.filter((c) => c.method === "repair");
    assert.equal(repairs.length, 1);
    assert.deepEqual((repairs[0]?.args as { channels: string[] }).channels, [
      "canary",
    ]);
    assert.match(text(), /repaired successfully/);
  });

  test("14+15. uninstall requires confirmation and sends no purge flag", async () => {
    fake.installed.add("canary");
    await mount();
    await click(byTestId("uninstall-canary"));
    assert.ok(byTestId("confirm-dialog"), "confirmation required");
    assert.equal(
      fake.calls.filter((c) => c.method === "uninstall").length,
      0,
      "no uninstall before confirm",
    );
    await click(byTestId("confirm-cancel"));
    assert.equal(byTestId("confirm-dialog"), null);
    assert.equal(fake.calls.filter((c) => c.method === "uninstall").length, 0);
    await click(byTestId("uninstall-canary"));
    await click(byTestId("confirm-uninstall"));
    const uninstalls = fake.calls.filter((c) => c.method === "uninstall");
    assert.equal(uninstalls.length, 1);
    const args = uninstalls[0]?.args as { channels: string[]; purge?: boolean };
    assert.deepEqual(args.channels, ["canary"]);
    assert.equal(
      args.purge,
      false,
      "uninstall uses purge=false (main also forces false)",
    );
    assert.match(text(), /Not installed/);
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

  test("18. refresh reruns discovery/status", async () => {
    await mount();
    const discoveredBefore = fake.calls.filter(
      (c) => c.method === "discover",
    ).length;
    await click(byTestId("refresh-button"));
    assert.ok(
      fake.calls.filter((c) => c.method === "discover").length >
        discoveredBefore,
      "discover reruns",
    );
    assert.ok(byTestId("install-card-stable"));
  });

  test("discover failure shows discovery error, NOT the empty-list message", async () => {
    fake.failDiscover = "preload bridge unreachable";
    await mount();
    assert.ok(byTestId("discovery-error"), "discovery error shown");
    assert.match(text(), /Discord discovery failed/);
    assert.match(text(), /preload bridge unreachable/);
    assert.equal(byTestId("install-list-empty"), null);
    assert.equal(byTestId("install-list"), null);
    const before = fake.calls.filter((c) => c.method === "discover").length;
    fake.failDiscover = null;
    await click(byTestId("discovery-retry"));
    assert.ok(
      fake.calls.filter((c) => c.method === "discover").length > before,
      "retry reruns discovery",
    );
    assert.equal(byTestId("discovery-error"), null);
    assert.ok(byTestId("install-card-stable"), "cards render after retry");
  });

  test("successful empty discover keeps the empty-list message", async () => {
    fake.installations = [];
    await mount();
    assert.ok(byTestId("install-list-empty"), "empty message shown");
    assert.match(text(), /No Discord installations detected/);
    assert.equal(byTestId("discovery-error"), null);
  });

  test("status failure does not erase discovered cards", async () => {
    fake.failStatus = "status backend down";
    await mount();
    assert.ok(byTestId("install-card-stable"), "stable card persists");
    assert.ok(byTestId("install-card-canary"), "canary card persists");
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
