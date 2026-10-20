// Runs only in the disposable Electron fixture created by smoke-electron.mjs.
const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const assert = require("node:assert/strict");
const splashSource = require("node:fs").readFileSync(
  path.join(__dirname, "splash-source.js"),
  "utf8",
);
const presets = require("./theme-fixture.json");
const utilityNames = [
  "ImageZoom",
  "QuickMessageCopy",
  "CleanLinkCopy",
  "FullTimestamps",
  "CodeBlockCopy",
  "FocusMode",
];

const motion = process.env.VESTRA_TEST_MOTION;
app.setPath("userData", path.join(__dirname, `user-data-${motion}`));
app.setPath("appData", path.join(__dirname, "app-data"));
app.setPath("sessionData", path.join(__dirname, `session-data-${motion}`));
const timer = setTimeout(() => {
  console.error("Electron smoke timed out");
  app.exit(1);
}, 60000);

// Simulate only the host identity; use real Electron sessions, frames, IPC,
// context isolation, sandbox, CSP, bundle execution and DOM for everything else.
const executable = process.execPath;
try {
  process.execPath = path.join(__dirname, "Discord.exe");
  require(path.join(__dirname, "main-hook.cjs"));
} finally {
  process.execPath = executable;
}

app
  .whenReady()
  .then(async () => {
    const ses = session.fromPartition(`vestra-smoke-${Date.now()}`);
    const image =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#a89dc9"/></svg>',
      );
    const html = `<!doctype html><html class="visual-refresh theme-dark"><head><title>Disposable Discord fixture</title><style>
  body{margin:0}.visual-refresh.theme-dark,.visual-refresh .theme-dark{--background-base-low:#242424;--background-base-lower:#202020;--background-base-lowest:#141414;--background-surface-high:#303030;--input-background-default:#343434}
  .custom-theme-background{--background-gradient-chat:linear-gradient(#534261,#534261);--background-gradient-app-frame:linear-gradient(#46374e,#46374e)}
  #fixture-chat{background:var(--background-gradient-chat,var(--background-base-low))}#fixture-side{background:var(--background-base-lower)}#fixture-rail{background:var(--background-gradient-app-frame,var(--background-base-lowest))}#fixture-popout{background:var(--background-surface-high)}#fixture-input{background:var(--input-background-default)}
  .chat_fixture{background:#0e1317}.custom-user-profile-theme .chat_fixture{background:#4b2442}
  </style></head><body><main id="app-mount" class="custom-theme-background"><div id="fixture-chat" class="chat_fixture">Chat</div><div id="fixture-fallback" class="chat_fixture">Legacy surface</div><div class="sidebarList_test" id="fixture-side">Channels</div><div id="fixture-rail">Servers</div><div class="theme-dark"><div id="fixture-popout">Popout</div><input id="fixture-input"/></div><div class="custom-user-profile-theme"><div class="chat_fixture" id="fixture-profile">Profile</div></div>
  <li id="chat-messages-123-456"><time datetime="2026-10-20T03:15:32Z"><span>Today</span></time><div id="message-content-456"><b id="fixture-message">Hello fixture</b><a id="fixture-link" href="https://example.test/watch?v=abc&utm_source=discord#part">Link</a><pre><code>const hello = 1;</code></pre></div><img id="fixture-image" width="320" height="240" src="${image}"/></li></main></body></html>`;
    await ses.protocol.handle(
      "https",
      () =>
        new Response(html, {
          headers: {
            "Content-Type": "text/html",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'",
          },
        }),
    );
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: true,
      },
    });
    win.webContents.on("preload-error", (_event, _file, error) =>
      console.error("Preload error:", error),
    );
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) console.error("Renderer:", message);
    });
    const evaluate = (source) => win.webContents.executeJavaScript(source);
    const page = (fn, ...args) =>
      evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (source, label) => {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        if (await evaluate(source)) return;
        await pause(50);
      }
      assert.fail(label);
    };
    try {
      await win.loadURL("https://discord.com/channels/789/123");
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        ready = await evaluate(
          "Boolean(window.Vestra && window.Vestra.started)",
        );
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(
        ready,
        true,
        "runtime booted inside sandbox with strict CSP",
      );
      const result = await evaluate(`(async () => {
      const v = window.Vestra;
      const localTheme = v.Settings.getThemes().some(theme => theme.sourceFile === 'Folder.theme.css');
      await v.Plugins.enable('ReducedMotion');
      const reduced = v.Styles.has('plugin-reduced-motion');
      await v.Plugins.disable('ReducedMotion');
      v.Settings.setThemes([{id:'smoke',name:'Smoke',author:'Test',css:':root{--vestra-smoke:1}',enabled:true}]);
      const theme = v.Styles.has('theme-smoke');
      v.Settings.setCustomCss({enabled:true,css:':root{--vestra-quick-smoke:1}'});
      const quick = v.Styles.has('quickcss');
      v.UI.openSettings();
      return {native:v.Native.isAvailable(),plugins:v.Plugins.list().length,sdk:v.Styles.has('ExamplePlugin'),localPlugin:v.Styles.has('LocalFolderFixture'),localTheme,reduced,stopped:!v.Styles.has('plugin-reduced-motion'),theme,quick};
    })()`);
      assert.deepEqual(result, {
        native: true,
        plugins: 11,
        sdk: true,
        localPlugin: true,
        localTheme: true,
        reduced: true,
        stopped: true,
        theme: true,
        quick: true,
      });
      const exportName = `Export-${motion}.theme.css`;
      const exported = await page(
        (name) =>
          window.Vestra.Native.writeThemeFile(name, ":root{--export-test:1}"),
        exportName,
      );
      assert.equal(exported, exportName);
      assert.equal(
        await page(
          (name) =>
            window.Vestra.Native.readThemeFiles().then((files) =>
              files.some(
                (file) =>
                  file.filename === name &&
                  file.source.includes("--export-test"),
              ),
            ),
          exportName,
        ),
        true,
        "native folder bridge writes and reads a real CSS file",
      );
      await waitFor(
        "document.getElementById('vestra-splash') === null",
        "bootstrap splash exits",
      );
      // Sample Chromium's actual animation at a fixed playback position. Wall-clock
      // sleeps can miss its entire lifetime on a busy hosted Windows runner.
      const reveal = await evaluate(`new Promise((resolve,reject) => {
      const splash = ${splashSource};
      const el = document.getElementById('vestra-splash');
      const mountedAt = performance.now();
      const visible = getComputedStyle(el).opacity === '1';
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Splash never completed')); },5000);
      const observer = new MutationObserver(() => {
        if (!el.classList.contains('vs-done')) return;
        observer.disconnect(); clearTimeout(timeout);
        const animation = el.getAnimations().find(item => item.animationName === 'vs-unveil');
        if (!animation && !reduced) { reject(new Error('Radial reveal animation missing: '+getComputedStyle(el).animationName)); return; }
        if (animation) { animation.pause(); animation.currentTime = 450; }
        const style = getComputedStyle(el);
        resolve({visible,reduced,opacity:style.opacity,lifetime:performance.now()-mountedAt,mask:style.maskImage,progress:parseFloat(style.getPropertyValue('--vs-reveal'))});
      });
      observer.observe(el,{attributes:true,attributeFilter:['class']});
      splash.set(100,'Ready');
    })`);
      assert.equal(
        reveal.visible,
        true,
        "fast completion stays visible before dismissal",
      );
      assert.equal(
        reveal.reduced,
        motion === "reduced",
        "fixture uses its requested motion preference",
      );
      assert.ok(
        reveal.lifetime >= 1000,
        "minimum visual lifetime is preserved without blocking startup",
      );
      if (reveal.reduced)
        assert.equal(
          reveal.opacity,
          "0",
          "reduced motion dismisses without a reveal animation",
        );
      else
        assert.ok(
          reveal.mask.includes("radial-gradient") &&
            reveal.progress > 0 &&
            reveal.progress < 125,
          "the radial transparency actually interpolates in Chromium",
        );
      console.log(
        "Electron motion preference:",
        reveal.reduced ? "reduced" : "full",
      );
      await waitFor(
        "document.getElementById('vestra-splash') === null",
        "reveal cleans up even when its animation is paused",
      );
      assert.equal(
        await evaluate("Boolean(document.querySelector('[aria-modal=true]'))"),
        true,
      );
      assert.equal(
        await evaluate("document.getElementById('vestra-splash') === null"),
        true,
      );
      await evaluate(
        "document.querySelector('nav[aria-label=\"Vestra settings pages\"] button[aria-label=QuickCSS]').click()",
      );
      await waitFor(
        "Boolean(document.querySelector('.cm-content'))",
        "the CSS editor mounts under the real host CSP",
      );
      await evaluate("document.querySelector('.cm-content').focus()");
      win.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "A",
        modifiers: ["control"],
      });
      win.webContents.sendInputEvent({
        type: "keyUp",
        keyCode: "A",
        modifiers: ["control"],
      });
      await win.webContents.insertText(
        Array.from(
          { length: 80 },
          (_, index) => `/* editor line ${index + 1} */`,
        ).join("\n"),
      );
      await waitFor(
        "window.Vestra.Settings.getCustomCss().css.includes('editor line 80')",
        "editor typing saves through the settings store",
      );
      win.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "End",
        modifiers: ["control"],
      });
      win.webContents.sendInputEvent({
        type: "keyUp",
        keyCode: "End",
        modifiers: ["control"],
      });
      await waitFor(
        "document.querySelector('.cm-scroller').scrollTop>0",
        "the editor follows the cursor down a long file",
      );
      await evaluate(
        "window.Vestra.Settings.setCustomCss({enabled:false,css:''});document.querySelector('nav[aria-label=\"Vestra settings pages\"] button[aria-label=Plugins]').click()",
      );
      await waitFor(
        "Boolean(document.querySelector('[data-vestra-plugin=FocusMode]'))",
        "plugin page mounts",
      );
      await evaluate(
        "document.querySelector('[data-vestra-plugin=FocusMode] .vs-plugin-footer button').click()",
      );
      await waitFor(
        "Boolean(document.querySelector('[aria-label=\"Change Focus shortcut\"]'))",
        "plugin settings mount",
      );
      await evaluate(
        "(() => {const button=document.querySelector('[aria-label=\"Change Focus shortcut\"]');button.focus();button.click();})()",
      );
      await waitFor(
        "document.querySelector('[aria-label=\"Change Focus shortcut\"]').getAttribute('data-vestra-keybind-recording')==='true'",
        "keybind recorder is active",
      );
      await evaluate(
        "document.querySelector('[aria-label=\"Change Focus shortcut\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'v',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))",
      );
      assert.equal(
        await evaluate("Boolean(document.querySelector('[aria-modal=true]'))"),
        true,
        "recording the overlay combo does not close settings",
      );
      await waitFor(
        "document.querySelector('[role=alert]')?.textContent.includes('Open Vestra')",
        "conflicting overlay shortcut is rejected",
      );
      await evaluate(
        "document.querySelector('[aria-label=\"Change Focus shortcut\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'g',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))",
      );
      assert.equal(
        await evaluate(
          "window.Vestra.Settings.getPluginSetting('FocusMode','shortcut')",
        ),
        "Ctrl+Alt+G",
        "the keybind recorder persists a usable combo",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('[data-vestra-plugin=FocusMode] button')).find(button=>button.textContent==='Reset defaults').click()",
      );
      assert.equal(
        await evaluate(
          "window.Vestra.Settings.getPluginSetting('FocusMode','shortcut')",
        ),
        undefined,
        "reset restores schema defaults",
      );
      await evaluate(
        "document.querySelector('nav[aria-label=\"Vestra settings pages\"] button[aria-label=Overview]').click()",
      );

      for (const preset of presets) {
        const colors = await page((preset) => {
          window.Vestra.Settings.setThemes([
            {
              id: "palette",
              name: preset.name,
              author: "Vestra",
              css: preset.css,
              enabled: true,
            },
          ]);
          return [
            "fixture-chat",
            "fixture-side",
            "fixture-rail",
            "fixture-popout",
            "fixture-input",
          ].map(
            (id) =>
              getComputedStyle(document.getElementById(id)).backgroundColor,
          );
        }, preset);
        const rgb = (hex) =>
          `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
        assert.equal(
          colors[0],
          rgb(preset.colors[1]),
          `${preset.name} changes the actual chat surface`,
        );
        assert.equal(
          colors[2],
          rgb(preset.colors[0]),
          `${preset.name} changes the actual server rail`,
        );
        assert.ok(
          colors[1] !== "rgb(32, 32, 32)" &&
            colors[3] !== "rgb(48, 48, 48)" &&
            colors[4] !== "rgb(52, 52, 52)",
          "nested scopes, sidebars, popouts and composer update",
        );
        assert.equal(
          await evaluate(
            "getComputedStyle(document.getElementById('fixture-chat')).backgroundImage",
          ),
          "none",
          "native custom-background layers cannot cover the active palette",
        );
        assert.equal(
          await evaluate(
            "getComputedStyle(document.getElementById('fixture-fallback')).backgroundColor",
          ),
          rgb(preset.colors[1]),
          "the chat surface also replaces a host-local background",
        );
        assert.equal(
          await evaluate(
            "getComputedStyle(document.getElementById('fixture-profile')).backgroundColor",
          ),
          "rgb(75, 36, 66)",
          "custom profile backgrounds keep their own styling",
        );
      }
      await evaluate("window.Vestra.Settings.setThemes([])");
      assert.equal(
        await evaluate(
          "getComputedStyle(document.getElementById('fixture-fallback')).backgroundColor",
        ),
        "rgb(14, 19, 23)",
        "disabling themes restores the native surface",
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.getElementById('fixture-rail')).backgroundImage",
        ),
        "linear-gradient(rgb(70, 55, 78), rgb(70, 55, 78))",
        "disabling themes restores the native custom background",
      );

      await page(async (names) => {
        window.__fixtureCopies = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            async writeText(text) {
              window.__fixtureCopies.push(text);
            },
          },
        });
        for (const name of names) {
          await window.Vestra.Plugins.enable(name);
          if (!window.Vestra.Plugins.isStarted(name))
            throw new Error(name + " did not start");
        }
      }, utilityNames);
      const copied = await page(async () => {
        const click = (id, shiftKey = false) =>
          document
            .getElementById(id)
            .dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                altKey: true,
                shiftKey,
              }),
            );
        click("fixture-message");
        click("fixture-message", true);
        click("fixture-link");
        document.querySelector("[data-vestra-code-copy]").click();
        await Promise.resolve();
        return window.__fixtureCopies;
      });
      assert.deepEqual(copied, [
        "Hello fixtureLink\nconst hello = 1;",
        "https://discord.com/channels/789/123/456",
        "https://example.test/watch?v=abc#part",
        "const hello = 1;",
      ]);
      // React-like replacement of a code block's children must recreate our button.
      await evaluate(
        "document.querySelector('pre').innerHTML='<code>new code</code>'",
      );
      await waitFor(
        "document.querySelectorAll('[data-vestra-code-copy]').length === 1",
        "copy button survives host content replacement",
      );
      assert.equal(
        await evaluate(
          "document.querySelectorAll('[data-vestra-code-copy]').length",
        ),
        1,
      );
      await evaluate(
        "document.querySelector('time').setAttribute('datetime','2026-11-21T11:22:44Z')",
      );
      await waitFor(
        "document.querySelector('time').getAttribute('data-vestra-time').includes('44')",
        "reused timestamps update",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('time').getAttribute('data-vestra-time').includes('44')",
        ),
        true,
      );
      await evaluate(
        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))",
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.getElementById('fixture-side')).display",
        ),
        "none",
      );
      await evaluate(
        "window.Vestra.Settings.setPluginSetting('FocusMode','shortcut','Ctrl+Alt+G');document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))",
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.getElementById('fixture-side')).display",
        ),
        "none",
        "the previous focus shortcut no longer toggles the layout",
      );
      await evaluate(
        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'g',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))",
      );
      assert.notEqual(
        await evaluate(
          "getComputedStyle(document.getElementById('fixture-side')).display",
        ),
        "none",
        "a reassigned focus shortcut changes the actual layout",
      );
      const zoom = await page(() => {
        const img = document.getElementById("fixture-image");
        const rect = img.getBoundingClientRect();
        img.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            altKey: true,
            clientX: rect.x + 100,
            clientY: rect.y + 100,
          }),
        );
        const lens = document.querySelector("[data-vestra-image-lens]");
        const before = lens.style.backgroundSize;
        img.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            altKey: true,
            deltaY: -100,
          }),
        );
        const visible = lens.style.display === "block",
          changed = before !== lens.style.backgroundSize;
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
        return { visible, changed, hidden: lens.style.display === "none" };
      });
      assert.deepEqual(zoom, { visible: true, changed: true, hidden: true });
      await page(async (names) => {
        for (const name of names) await window.Vestra.Plugins.disable(name);
      }, utilityNames);
      assert.equal(
        await evaluate(
          "document.querySelector('[data-vestra-code-copy],[data-vestra-time],[data-vestra-image-lens]') === null && !document.documentElement.hasAttribute('data-vestra-focus')",
        ),
        true,
        "all plugin DOM, observers and global state clean up",
      );
      await evaluate(
        "document.getElementById('fixture-message').dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true}))",
      );
      assert.equal(
        await evaluate("window.__fixtureCopies.length"),
        4,
        "disabled clipboard shortcuts are removed",
      );
      await evaluate(
        "window.Vestra.Settings.setPluginSetting('ReducedMotion','__vestraToggleShortcut','Ctrl+Alt+T');document.dispatchEvent(new KeyboardEvent('keydown',{key:'t',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))",
      );
      await waitFor(
        "window.Vestra.Plugins.isStarted('ReducedMotion')",
        "a per-plugin shortcut starts its plugin",
      );
      await evaluate(
        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'t',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))",
      );
      await waitFor(
        "!window.Vestra.Plugins.isStarted('ReducedMotion')",
        "the same shortcut disables its plugin",
      );

      await evaluate("window.Vestra.UI.closeSettings()");
      await waitFor(
        "document.querySelector('[aria-modal=true]') === null",
        "settings close",
      );
      const point = await evaluate(
        "(() => {const r=document.querySelector('.vs-settings-launcher').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
      );
      win.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(point.x),
        y: Math.round(point.y),
      });
      await pause(30);
      win.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        modifiers: ["leftButtonDown"],
        x: Math.round(point.x),
        y: Math.round(point.y),
      });
      await pause(30);
      win.webContents.sendInputEvent({
        type: "mouseMove",
        x: 650,
        y: 110,
        modifiers: ["leftButtonDown"],
      });
      await pause(30);
      win.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        x: 650,
        y: 110,
      });
      await waitFor(
        "window.Vestra.Settings.getPluginSetting('Vestra','launcherPosition')?.x > .7",
        "drag position is saved",
      );
      const moved = await evaluate(
        "({position:window.Vestra.Settings.getPluginSetting('Vestra','launcherPosition'),open:document.querySelector('.vs-settings-launcher').getAttribute('aria-expanded')})",
      );
      assert.ok(
        moved.position.x > 0.7 && moved.position.y < 0.3,
        "real mouse dragging persists the launcher position",
      );
      assert.equal(moved.open, "false", "dragging does not open settings");
      await win.loadURL("https://discord.com/channels/789/123");
      await waitFor(
        "Boolean(window.Vestra?.started && document.querySelector('.vs-settings-launcher')) && document.getElementById('vestra-splash') === null",
        "runtime and launcher restore after navigation",
      );
      assert.deepEqual(
        await evaluate(
          "window.Vestra.Settings.getPluginSetting('Vestra','launcherPosition')",
        ),
        moved.position,
        "position survives a full reload",
      );
      const launcher = await evaluate(
        "(() => {const r=document.querySelector('.vs-settings-launcher').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
      );
      await evaluate(
        "(() => {const button=document.querySelector('.vs-settings-launcher');const animate=button.animate.bind(button);button.animate=(...args)=>{const animation=animate(...args);window.__fixturePressAnimation=animation;return animation;};})()",
      );
      win.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        modifiers: ["leftButtonDown"],
        x: Math.round(launcher.x),
        y: Math.round(launcher.y),
      });
      win.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        x: Math.round(launcher.x),
        y: Math.round(launcher.y),
      });
      if (!reveal.reduced) {
        await waitFor(
          "Boolean(window.__fixturePressAnimation)",
          "launcher creates an actual Web Animation",
        );
        assert.equal(
          await evaluate(
            "window.__fixturePressAnimation.effect.getKeyframes().some(frame => frame.transform.includes('scale'))",
          ),
          true,
          "button plays a press and rebound animation",
        );
      } else
        assert.equal(
          await evaluate("Boolean(window.__fixturePressAnimation)"),
          false,
          "reduced motion skips the launcher animation",
        );
      await waitFor(
        "Boolean(document.querySelector('[aria-modal=true]'))",
        "normal click opens settings",
      );
      assert.equal(
        await evaluate("Boolean(document.querySelector('[aria-modal=true]'))"),
        true,
        "normal click opens settings after dragging and reloading",
      );
      await evaluate("window.Vestra.UI.closeSettings()");
      await waitFor(
        "document.querySelector('[aria-modal=true]') === null",
        "settings close before context menu",
      );
      await evaluate(
        "document.querySelector('.vs-settings-launcher').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:200}))",
      );
      await waitFor(
        "Boolean(document.querySelector('.vs-launcher-menu [role=menuitem]'))",
        "launcher offers a hide action",
      );
      await evaluate(
        "document.querySelector('.vs-launcher-menu [role=menuitem]').click()",
      );
      if (motion === "full")
        assert.equal(
          await evaluate(
            "getComputedStyle(document.querySelector('.vs-settings-launcher')).animationName",
          ),
          "vs-launcher-vanish",
          "hide plays the rotating exit animation",
        );
      await waitFor(
        "document.querySelector('.vs-settings-launcher') === null",
        "hidden launcher is removed",
      );
      await evaluate(
        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'v',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))",
      );
      await waitFor(
        "Boolean(document.querySelector('[aria-modal=true]'))",
        "the Vestra shortcut still works with a hidden launcher",
      );
      await evaluate(
        "window.Vestra.Settings.setPluginSetting('Vestra','launcherHidden',false)",
      );
      await waitFor(
        "Boolean(document.querySelector('.vs-settings-launcher'))",
        "the hidden launcher can be restored",
      );
      await win.loadURL("https://example.test/app");
      assert.equal(await evaluate("typeof window.VestraNative"), "undefined");
      assert.equal(
        await evaluate("document.getElementById('vestra-splash') === null"),
        true,
      );
      console.log(
        "PASS Electron sandbox + CSP + IPC + 11 plugins + local files + theme surfaces + editor input/scroll + settings recorder/conflicts + custom shortcuts + actions/cleanup + splash + dragging/persistence + launcher hide/restore + overlay + external-page exclusion",
      );
      clearTimeout(timer);
      win.destroy();
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
