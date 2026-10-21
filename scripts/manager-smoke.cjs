const { app, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

app.setPath("userData", path.join(__dirname, "session"));
app.on("window-all-closed", () => {});
const channel = "vestra-manager:window-action";
const installation = {
  channel: "stable",
  version: "1.0.9264",
  rootDir: "/fixture/stable",
  appDir: "/fixture/stable/app",
  asarPath: "/fixture/stable/app.asar",
  isActive: true,
};
const summary = {
  statuses: [
    {
      installation,
      health: "healthy",
      vestraInstalled: true,
      repairable: true,
    },
  ],
  stale: [],
};
// Fixture handlers never discover, modify or restart a real Discord installation.
for (const [name, result] of Object.entries({
  discover: [installation],
  status: summary,
  check: summary,
  "maintenance-status": {
    available: true,
    enabled: true,
    channels: ["stable"],
  },
  repair: {
    ok: true,
    results: [
      {
        channel: "stable",
        asarPath: installation.asarPath,
        ok: true,
        action: "repaired",
      },
    ],
  },
}))
  ipcMain.handle("vestra-manager:" + name, () => result);

app
  .whenReady()
  .then(async () => {
    const timer = setTimeout(() => {
      console.error("Manager smoke timed out");
      app.exit(1);
    }, 20000);
    try {
      const { createHash } = require("node:crypto");
      const { ManagerUpdates } = await import(
        pathToFileURL(path.join(__dirname, "manager/main/updates.mjs")).href
      );
      const bytes = Buffer.from("Fixture update package. Never executed.");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const updateHome = path.join(__dirname, "update-home");
      const service = {
        context: { homeDir: updateHome },
        status: async () => ({
          statuses: [
            summary.statuses[0],
            { installation: { channel: "canary" }, vestraInstalled: false },
          ],
          stale: [],
        }),
      };
      const tracked = [];
      const repaired = [];
      let handedOff;
      let quitRequested = false;
      const updater = new ManagerUpdates(
        service,
        { track: async (channel) => tracked.push(channel) },
        {
          version: "0.1.0-alpha.3",
          supported: true,
          request: async (url) => {
            if (url.includes("api.github.com"))
              return new Response(
                JSON.stringify([
                  {
                    tag_name: "v0.1.0-alpha.4",
                    draft: false,
                    prerelease: true,
                    assets: ["Setup", "Portable"].map((kind) => ({
                      name: `Vestra-0.1.0-alpha.4-x64-${kind}.exe`,
                      size: bytes.length,
                      digest: `sha256:${hash}`,
                      browser_download_url: `https://github.com/deAYS/Vestra/releases/download/v0.1.0-alpha.4/Vestra-0.1.0-alpha.4-x64-${kind}.exe`,
                    })),
                  },
                ]),
              );
            return new Response(bytes);
          },
          handoff: async (options) => {
            handedOff = options;
          },
          quit: () => {
            quitRequested = true;
          },
        },
      );
      updater.register();
      await updater.check();
      const { createManagerWindow } = await import(
        pathToFileURL(path.join(__dirname, "manager/main/window.mjs")).href
      );
      const listeners = ipcMain.listenerCount(channel);
      const win = createManagerWindow(false);
      win.webContents.setBackgroundThrottling(false);
      win.webContents.on("preload-error", (_event, _file, error) =>
        console.error(error),
      );
      win.webContents.on("console-message", (_event, level, message) => {
        if (level >= 2) console.error(message);
      });
      const evaluate = (source) => win.webContents.executeJavaScript(source);
      const wait = async (predicate, label) => {
        const deadline = Date.now() + 6000;
        while (Date.now() < deadline) {
          if (await predicate()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("Timed out: " + label);
      };
      await wait(
        () =>
          evaluate(
            "Boolean(document.querySelector('[data-testid=repair-stable]'))",
          ).catch(() => false),
        "Manager UI ready",
      );
      assert.equal(win.getNormalBounds().width, 960);
      await wait(
        () =>
          evaluate(
            "document.querySelector('.vs-update-card')?.textContent.includes('Download update')",
          ),
        "update available card",
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('h1')).userSelect",
        ),
        "none",
        "ordinary Manager copy is not selectable",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('.vs-update-card button')).find(b=>b.textContent==='Download update').click()",
      );
      await wait(
        () =>
          evaluate(
            "document.querySelector('.vs-update-card')?.textContent.includes('Verified')",
          ),
        "verified update download",
      );
      if (process.env.VESTRA_UPDATE_SCREENSHOT) {
        await evaluate(
          "document.querySelector('.vs-update-card').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
        );
        await fs.writeFile(
          process.env.VESTRA_UPDATE_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG(),
        );
      }
      assert.equal(
        handedOff,
        undefined,
        "downloading never installs or disconnects Discord",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('.vs-update-card button')).find(b=>b.textContent==='Install update…').click()",
      );
      await wait(
        () =>
          evaluate(
            "Boolean(document.querySelector('[aria-label=\"Install Vestra update\"]'))",
          ),
        "restart confirmation",
      );
      assert.equal(
        handedOff,
        undefined,
        "opening confirmation does not install",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('.vs-update-confirm button')).find(b=>b.textContent==='Install and restart').click()",
      );
      await wait(
        () => Boolean(handedOff) && quitRequested,
        "explicit confirmed handoff",
      );
      const pending = JSON.parse(
        await fs.readFile(
          path.join(updateHome, "updates/pending.json"),
          "utf8",
        ),
      );
      assert.deepEqual(
        pending.channels,
        ["stable"],
        "only installations already using Vestra are updated",
      );
      let failFinish = true;
      const finished = new ManagerUpdates(
        service,
        { track: async (channel) => tracked.push(channel) },
        {
          version: "0.1.0-alpha.4",
          supported: true,
          lifecycle: {
            run: async (kind, channel) => {
              if (failFinish) throw new Error("Fixture Discord busy. Retry.");
              repaired.push([kind, channel]);
              return { ok: true, results: [] };
            },
          },
        },
      );
      await finished.finish();
      assert.equal(
        finished.snapshot().phase,
        "ready",
        "an interrupted handoff waits for user confirmation",
      );
      assert.equal(repaired.length, 0);
      await finished.install();
      assert.equal(
        finished.snapshot().phase,
        "ready",
        "a failed Discord update stays retryable",
      );
      assert.equal(
        await fs.stat(path.join(updateHome, "updates/pending.json")).then(
          () => true,
          () => false,
        ),
        true,
        "failed updates retain their handoff",
      );
      failFinish = false;
      await finished.install();
      assert.deepEqual(repaired, [["repair", "stable"]]);
      assert.deepEqual(tracked, ["stable"]);
      assert.equal(finished.snapshot().phase, "current");
      assert.equal(
        await fs.stat(path.join(updateHome, "updates/pending.json")).then(
          () => true,
          () => false,
        ),
        false,
        "successful updates consume their handoff",
      );
      await fs.writeFile(path.join(updateHome, "updates/pending.json"), "null");
      await finished.finish();
      assert.equal(
        finished.snapshot().phase,
        "error",
        "malformed saved state does not crash Manager or touch Discord",
      );
      await fs.rm(path.join(updateHome, "updates/pending.json"));
      assert.equal(await evaluate("typeof require"), "undefined");
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('.vs-titlebar')).getPropertyValue('-webkit-app-region')",
        ),
        "drag",
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('.vs-window-controls')).getPropertyValue('-webkit-app-region')",
        ),
        "no-drag",
      );
      assert.equal(
        await evaluate("getComputedStyle(document.body).overflow"),
        "hidden",
      );
      await evaluate(
        "window.__states=[];window.vestraManager.onWindowState(state=>window.__states.push(state.maximized));void 0",
      );
      await wait(
        () => evaluate("window.__states.length>0"),
        "initial window state",
      );
      assert.equal(await evaluate("window.__states[0]"), false);
      const supportsMaterials = await evaluate(
        "!document.querySelector('[aria-label=\"Window finish\"]').disabled",
      );
      for (const material of supportsMaterials
        ? ["mica", "acrylic", "solid"]
        : ["solid"]) {
        await evaluate(
          `window.vestraManager.setWindowMaterial(${JSON.stringify(material)})`,
        );
        await wait(
          () =>
            evaluate(
              `document.documentElement.dataset.windowMaterial===${JSON.stringify(material)}`,
            ),
          "window finish " + material,
        );
        assert.equal(
          JSON.parse(
            await fs.readFile(
              path.join(__dirname, "session/window-appearance.json"),
              "utf8",
            ),
          ).material,
          material,
          "window finish is saved outside Discord storage",
        );
      }
      await evaluate(
        "window.vestraManager.setWindowMaterial('not-a-material')",
      );
      assert.equal(
        await evaluate("document.documentElement.dataset.windowMaterial"),
        "solid",
        "invalid window materials are ignored",
      );
      ipcMain.emit(
        "vestra-manager:window-material",
        {
          sender: win.webContents,
          senderFrame: { url: win.webContents.getURL() },
        },
        "acrylic",
      );
      assert.equal(
        JSON.parse(
          await fs.readFile(
            path.join(__dirname, "session/window-appearance.json"),
            "utf8",
          ),
        ).material,
        "solid",
        "untrusted frames cannot change material preferences",
      );
      ipcMain.emit(
        channel,
        {
          sender: win.webContents,
          senderFrame: { url: win.webContents.getURL() },
        },
        "close",
      );
      assert.equal(
        win.isDestroyed(),
        false,
        "a matching URL in an untrusted frame cannot close the window",
      );
      await evaluate(
        "document.querySelector('[data-testid=repair-stable]').click()",
      );
      await wait(
        () =>
          evaluate("Boolean(document.querySelector('[data-testid=notice]'))"),
        "fixture repair result",
      );
      assert.ok(
        await evaluate(
          "document.querySelector('[data-testid=notice]').textContent.includes('All set')",
        ),
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('[data-testid=notice-dismiss]')).backgroundColor",
        ),
        "rgba(0, 0, 0, 0)",
      );
      if (process.env.VESTRA_MANAGER_SCREENSHOT) {
        await wait(
          () =>
            evaluate(
              "Boolean(document.querySelector('[data-testid=repair-stable]'))",
            ),
          "refreshed fixture card",
        );
        await evaluate(
          "Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))",
        );
        const image = await win.webContents.capturePage();
        await fs.writeFile(
          process.env.VESTRA_MANAGER_SCREENSHOT,
          image.toPNG(),
        );
      }
      await evaluate(
        "document.querySelector('[data-testid=notice-dismiss]').click()",
      );
      await wait(
        () => evaluate("!document.querySelector('[data-testid=notice]')"),
        "notification closes",
      );
      await evaluate(
        "document.querySelector('[aria-label=\"Minimize window\"]').click()",
      );
      await wait(() => win.isMinimized(), "minimize");
      win.restore();
      await evaluate(
        "document.querySelector('[aria-label=\"Maximize window\"]').click()",
      );
      await wait(() => win.isMaximized(), "maximize");
      await wait(
        () =>
          evaluate(
            "Boolean(document.querySelector('[aria-label=\"Restore window\"]'))",
          ),
        "restore icon follows native state",
      );
      await evaluate(
        "document.querySelector('[aria-label=\"Restore window\"]').click()",
      );
      await wait(() => !win.isMaximized(), "restore");
      void evaluate(
        "document.querySelector('[aria-label=\"Close window\"]').click()",
      ).catch(() => {});
      await wait(() => win.isDestroyed(), "close");
      assert.equal(
        ipcMain.listenerCount(channel),
        listeners,
        "closed windows release their action listener",
      );
      const reopened = createManagerWindow(false);
      await wait(
        () =>
          reopened.webContents
            .executeJavaScript(
              "document.documentElement.dataset.windowMaterial==='solid'",
            )
            .catch(() => false),
        "saved material restores in a new window",
      );
      reopened.destroy();
      clearTimeout(timer);
      console.log(
        "PASS Manager custom chrome + trusted IPC + minimize/maximize/restore/close + native materials/persistence + result notification",
      );
      app.exit(0);
    } catch (error) {
      console.error(error);
      clearTimeout(timer);
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
