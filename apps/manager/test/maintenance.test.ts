import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { withInstallLock } from "@vestra/installer";
import type { InstallerService } from "@vestra/installer";

test("foreground and background operations cannot mutate archives concurrently", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-lock-test-"));
  try {
    await withInstallLock(home, () => withInstallLock(home, async () => {}));
    await withInstallLock(home, async () => {});
    await assert.rejects(
      () =>
        withInstallLock(home, async () => {
          throw new Error("fixture failure");
        }),
      /fixture failure/,
    );
    await withInstallLock(home, async () => {});
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

import { composeNotice } from "../src/shared/flows.js";
import { MaintenanceController, trackAfterOperation } from "../src/main/maintenance.js";

test("a failing keep-installed step becomes a warning on a successful operation", async () => {
  const failing = {
    async track() {
      throw new Error("registry denied");
    },
  };
  const result = await trackAfterOperation(failing, "install", "stable", {
    ok: true,
    results: [],
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.warning,
    "Installed. Keep Vestra installed couldn't be turned on: registry denied",
  );
});

async function stagingFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vestra-stage-test-"));
  const home = path.join(root, "home");
  const localAppData = path.join(root, "local");
  const app = path.join(root, "app");
  await fs.mkdir(path.join(app, "resources"), { recursive: true });
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(app, "resources", "app.asar"), "asar-1");
  await fs.writeFile(path.join(app, "Vestra.exe"), "exe");
  await fs.writeFile(path.join(root, "bundle.js"), "bundle");
  const service = {
    context: { homeDir: home, bundlePath: path.join(root, "bundle.js") },
  } as unknown as InstallerService;
  return { root, home, localAppData, app, service };
}
const onWindows = process.platform === "win32" ? test : test.skip;

onWindows("a failed registration keeps the previous maintenance config", async () => {
  const f = await stagingFixture();
  try {
    const before = JSON.stringify({ enabled: true, channels: ["ptb"] });
    await fs.writeFile(path.join(f.home, "maintenance.json"), before);
    const controller = new MaintenanceController(
      f.service,
      {
        packaged: true,
        executable: path.join(f.app, "Vestra.exe"),
        localAppData: f.localAppData,
      },
      {
        exec: async () => {
          throw new Error("reg add failed");
        },
        launch: async () => {},
      },
    );
    await assert.rejects(() => controller.track("stable", true), /reg add failed/);
    assert.equal(
      await fs.readFile(path.join(f.home, "maintenance.json"), "utf8"),
      before,
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

onWindows("staging a new runtime removes older copies", async () => {
  const f = await stagingFixture();
  try {
    const parent = path.join(f.localAppData, "Vestra", "maintenance");
    await fs.mkdir(path.join(parent, "oldhash0000000000"), { recursive: true });
    await fs.writeFile(path.join(parent, "oldhash0000000000", "x"), "x");
    const controller = new MaintenanceController(
      f.service,
      {
        packaged: true,
        executable: path.join(f.app, "Vestra.exe"),
        localAppData: f.localAppData,
      },
      { exec: async () => ({}), launch: async () => {} },
    );
    await controller.track("stable", true);
    const left = await fs.readdir(parent);
    assert.equal(left.length, 1);
    assert.notEqual(left[0], "oldhash0000000000");
    const saved = JSON.parse(
      await fs.readFile(path.join(f.home, "maintenance.json"), "utf8"),
    );
    assert.deepEqual(saved.channels, ["stable"]);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("track warnings combine with an existing warning and read naturally in the notice", async () => {
  const failing = {
    async track() {
      throw new Error("denied");
    },
  };
  const result = await trackAfterOperation(failing, "install", "stable", {
    ok: true,
    results: [],
    warning: "Discord didn't reopen. Open it manually.",
  });
  assert.equal(
    result.warning,
    "Discord didn't reopen. Open it manually. Installed. Keep Vestra installed couldn't be turned on: denied",
  );
  assert.equal(
    composeNotice("Vestra installed successfully.", result.warning),
    "Vestra installed successfully. Discord didn't reopen. Open it manually. Keep Vestra installed couldn't be turned on: denied",
  );
  assert.equal(
    composeNotice(
      "Vestra installed successfully.",
      "Installed. Keep Vestra installed couldn't be turned on: x",
    ),
    "Vestra installed successfully. Keep Vestra installed couldn't be turned on: x",
  );
  assert.equal(composeNotice("Done."), "Done.");
});

onWindows("old runtimes survive a failed registration and go after a successful one", async () => {
  const f = await stagingFixture();
  try {
    const parent = path.join(f.localAppData, "Vestra", "maintenance");
    const old = path.join(parent, "oldhash0000000000");
    await fs.mkdir(old, { recursive: true });
    const host = {
      packaged: true,
      executable: path.join(f.app, "Vestra.exe"),
      localAppData: f.localAppData,
    };
    const failing = new MaintenanceController(f.service, host, {
      exec: async () => {
        throw new Error("reg add failed");
      },
      launch: async () => {},
    });
    await assert.rejects(() => failing.track("stable", true), /reg add failed/);
    await fs.access(old);
    const ok = new MaintenanceController(f.service, host, {
      exec: async () => ({}),
      launch: async () => {},
    });
    await ok.track("stable", true);
    await assert.rejects(() => fs.access(old));
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

function recordingController(f: Awaited<ReturnType<typeof stagingFixture>>) {
  const calls: string[] = [];
  const controller = new MaintenanceController(
    f.service,
    {
      packaged: true,
      executable: path.join(f.app, "Vestra.exe"),
      localAppData: f.localAppData,
    },
    {
      exec: async (_file, args) => {
        calls.push(`reg:${args[0]}`);
        return {};
      },
      launch: async (executable, args) => {
        calls.push(`launch:${path.basename(path.dirname(executable))}:${args.join(" ")}`);
      },
    },
  );
  return { controller, calls };
}

onWindows("a Manager update moves recovery onto this build's runtime at boot", async () => {
  const f = await stagingFixture();
  try {
    const parent = path.join(f.localAppData, "Vestra", "maintenance");
    const previous = path.join(parent, "prevhash00000000");
    await fs.mkdir(previous, { recursive: true });
    await fs.writeFile(
      path.join(f.home, "maintenance.json"),
      JSON.stringify({
        enabled: true,
        channels: ["stable"],
        runtime: path.join(previous, "Vestra.exe"),
      }),
    );
    const { controller, calls } = recordingController(f);
    assert.equal(await controller.refreshRuntime(), true);
    const saved = JSON.parse(await fs.readFile(path.join(f.home, "maintenance.json"), "utf8"));
    const name = path.basename(path.dirname(saved.runtime));
    assert.notEqual(name, "prevhash00000000");
    assert.deepEqual(saved.channels, ["stable"]);
    assert.deepEqual(calls, ["reg:add", `launch:${name}:--maintain`]);
    await fs.access(previous); // the running recovery hands over before it goes
    calls.length = 0;
    assert.equal(await controller.refreshRuntime(), false, "same runtime: nothing to do");
    assert.deepEqual(calls, []);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

onWindows("boot leaves recovery alone when it is off or already on this runtime", async () => {
  const f = await stagingFixture();
  try {
    const { controller, calls } = recordingController(f);
    await fs.writeFile(
      path.join(f.home, "maintenance.json"),
      JSON.stringify({ enabled: false, channels: ["stable"], runtime: "C:/x/old/Vestra.exe" }),
    );
    assert.equal(await controller.refreshRuntime(), false);
    await fs.writeFile(
      path.join(f.home, "maintenance.json"),
      JSON.stringify({ enabled: true, channels: [] }),
    );
    assert.equal(await controller.refreshRuntime(), false);
    assert.deepEqual(calls, []);
    await controller.track("stable", true);
    calls.length = 0;
    assert.equal(await controller.refreshRuntime(), false);
    assert.deepEqual(calls, []);
    const unpackaged = new MaintenanceController(
      f.service,
      { packaged: false, executable: path.join(f.app, "Vestra.exe"), localAppData: f.localAppData },
      { exec: async () => calls.push("reg"), launch: async () => {} },
    );
    await fs.writeFile(
      path.join(f.home, "maintenance.json"),
      JSON.stringify({ enabled: true, channels: ["stable"], runtime: "C:/x/old/Vestra.exe" }),
    );
    assert.equal(await unpackaged.refreshRuntime(), false);
    assert.deepEqual(calls, []);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

onWindows("pruning keeps the runtime recovery is still running from", async () => {
  const f = await stagingFixture();
  try {
    const parent = path.join(f.localAppData, "Vestra", "maintenance");
    const previous = path.join(parent, "prevhash00000000");
    const older = path.join(parent, "oldhash000000000");
    await fs.mkdir(previous, { recursive: true });
    await fs.mkdir(older, { recursive: true });
    await fs.writeFile(
      path.join(f.home, "maintenance.json"),
      JSON.stringify({ enabled: true, channels: ["ptb"], runtime: path.join(previous, "Vestra.exe") }),
    );
    const { controller } = recordingController(f);
    await controller.track("stable", true);
    const left = (await fs.readdir(parent)).sort();
    assert.equal(left.length, 2);
    assert.ok(left.includes("prevhash00000000"));
    assert.equal(left.includes("oldhash000000000"), false);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
