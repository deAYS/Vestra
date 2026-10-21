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
app.setPath("appData", path.join(__dirname, "app-data-" + motion));
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
      const originalSize = win.getSize();
      win.setSize(1280, 1000);
      await evaluate("document.querySelector('button[aria-label=Themes]').click()");
      await waitFor("Boolean(document.querySelector('[aria-label=\"Preview Vestra Midnight\"]')) && document.querySelector('[data-vestra-page=themes]').getAnimations().every(a=>a.playState==='finished')", "theme cards finish entering");
      for (const name of ["Midnight", "Graphite"]) {
        await evaluate(`(() => {const button=document.querySelector('[aria-label="Preview Vestra ${name}"]');button.focus();button.click()})()`);
        await waitFor(`document.querySelector('.vs-theme-peek-panel strong')?.textContent === 'Vestra ${name}' && document.querySelector('.vs-theme-peek-panel').getAnimations().every(a=>a.playState==='finished')`, "theme preview finishes entering").catch(async error => {
          console.error(name, await evaluate("JSON.stringify({panels:[...document.querySelectorAll('.vs-theme-peek-panel')].map(p=>({title:p.querySelector('strong')?.textContent,animations:p.getAnimations().map(a=>a.playState)})),active:document.activeElement?.getAttribute('aria-label')})"));
          throw error;
        });
        const placement = await evaluate(`(() => {const b=document.querySelector('[aria-label="Preview Vestra ${name}"]').getBoundingClientRect();const p=document.querySelector('.vs-theme-peek-panel').getBoundingClientRect();const r=document.querySelector('.vs-settings-root').getBoundingClientRect();return {gap:p.top-b.bottom,gapAbove:b.top-p.bottom,left:p.left,right:p.right,bottom:p.bottom,rootLeft:r.left,rootRight:r.right,rootBottom:r.bottom}})()`);
        assert.ok(Math.min(Math.abs(placement.gap - 10), Math.abs(placement.gapAbove - 10)) < 2, `${name} preview opens beside its button: ${JSON.stringify(placement)}`);
        assert.ok(placement.left >= placement.rootLeft && placement.right <= placement.rootRight + 1 && placement.bottom <= placement.rootBottom + 1, "preview stays inside settings");
      }
      win.setSize(...originalSize);
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
      await evaluate("window.__discordSearch=0;document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='f')window.__discordSearch++},true)");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "F", modifiers: ["control"] });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "F", modifiers: ["control"] });
      await waitFor("document.activeElement?.getAttribute('name') === 'search' && Boolean(document.activeElement.closest('.cm-search'))", "Ctrl+F focuses the editor search");
      await win.webContents.insertText("editor line 42");
      assert.equal(await evaluate("window.__discordSearch"), 0, "Discord search never receives Ctrl+F");
      assert.equal(await evaluate("document.querySelector('.cm-search input').value"), "editor line 42", "search typing stays inside QuickCSS");
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

      await evaluate("document.querySelector('.custom-user-profile-theme').insertAdjacentHTML('beforeend','<div id=fixture-activity class=activity_fixture style=background-color:rgb(12,12,12)>Watching</div>')");
      for (const preset of presets.filter(preset => preset.name !== "Vestra Liquid Glass")) {
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
        assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-activity')).backgroundColor"), colors[3], "profile activity cards follow the theme palette");
        await waitFor("document.querySelector('.vs-settings-launcher')?.getAttribute('data-theme-follow') === 'true'", "the launcher follows an enabled theme");
        await waitFor(`getComputedStyle(document.querySelector('.vs-settings-launcher')).backgroundColor === ${JSON.stringify(colors[3])}`, "the launcher uses the theme floating surface");
      }
      await page(preset => window.Vestra.Settings.setThemes([{ id:"palette", name:preset.name, author:"Vestra", css:preset.css, enabled:true }]), presets[3]);
      await evaluate(
        "document.querySelector('[data-vestra-style=theme-palette]').remove()",
      );
      await waitFor(
        "Boolean(document.querySelector('[data-vestra-style=theme-palette]'))",
        "removed theme CSS recovers",
      );
      await evaluate(
        "(() => {const style=document.createElement('style');style.id='late-native';style.textContent=':root {--background-base-lowest:#999!important}';document.head.appendChild(style)})()",
      );
      await waitFor(
        "document.querySelector('[data-vestra-style=theme-palette]') === document.head.lastChild",
        "theme follows late Discord styles",
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.getElementById('fixture-chat')).backgroundColor",
        ),
        "rgb(16, 31, 28)",
        "Aurora survives native stylesheet insertion",
      );
      await evaluate("document.getElementById('late-native').remove()");
      await evaluate(
        "(() => {const head=document.head.cloneNode(true);head.querySelector('[data-vestra-style=theme-palette]').remove();document.head.replaceWith(head)})()",
      );
      await waitFor(
        "Boolean(document.querySelector('[data-vestra-style=theme-palette]'))",
        "selected theme survives a replaced head",
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.getElementById('fixture-chat')).backgroundColor",
        ),
        "rgb(16, 31, 28)",
        "Aurora is restored after head replacement",
      );
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

      await page(preset => window.Vestra.Settings.setThemes([{ id:"glass", name:preset.name, author:"Vestra", css:preset.css, enabled:true }]), presets.find(preset => preset.name === "Vestra Liquid Glass"));
      const glassSurface = await evaluate(`(() => {const style=getComputedStyle(document.getElementById('fixture-chat'));return {color:style.backgroundColor,blur:style.backdropFilter,wallpaper:getComputedStyle(document.getElementById('app-mount')).backgroundImage}})()`);
      assert.equal(glassSurface.color, "rgba(22, 18, 30, 0.2)", "Glass main surfaces are translucent, not a solid navy palette");
      assert.ok(glassSurface.blur.includes("26px"), "Glass uses actual backdrop blur");
      assert.ok(glassSurface.wallpaper.includes("radial-gradient"), "visible light exists behind the glass panels");
      await evaluate(`document.getElementById('app-mount').insertAdjacentHTML('beforeend','<div id="readability-fixture"><div class="container_home"><div class="tabBody_home"><div class="peopleColumn_home">Friends</div><aside class="nowPlayingColumn_home">Active Now</aside></div></div><section class="shop_home">Shop</section><section class="questHomePage_home">Quests</section><aside class="user-profile-popout" id="plain-profile">Default profile</aside><aside class="user-profile-popout custom-user-profile-theme" id="colored-profile" style="background:rgb(75,36,66)">Colored profile</aside><div class="standardSidebarView_home" role="dialog" id="discord-settings">Voice settings</div><div id="readable-message" class="markup_home" style="color:var(--text-normal)">Chat text</div><pre id="readable-code">Code</pre><span id="role-name" style="color:rgb(255,85,85)">Role color</span></div>')`);
      const surfaces = await evaluate(`['plain-profile','discord-settings'].map(id=>{const s=getComputedStyle(document.getElementById(id));return {color:s.backgroundColor,blur:s.backdropFilter}})`);
      assert.equal(surfaces[0].color, "rgba(24, 21, 32, 0.94)", "default profiles have a readable backing surface");
      assert.equal(surfaces[1].color, "rgba(23, 20, 30, 0.96)", "Discord settings do not show the chat through their controls");
      for (const item of surfaces) assert.ok(item.blur.includes('26px'));
      for (const selector of ['.container_home','.shop_home','.questHomePage_home']) {
        assert.equal(await page(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor,selector),"rgba(22, 18, 30, 0.55)","Home routes get a separate backing panel");
      }
      assert.equal(await evaluate("getComputedStyle(document.getElementById('colored-profile')).backgroundColor"),"rgb(75, 36, 66)","custom profile colors remain intact");
      await evaluate("window.Vestra.UI.openSettings()");
      await waitFor("Boolean(document.querySelector('[aria-label=\"Vestra settings pages\"] button[aria-label=Themes]'))", "settings open for appearance controls");
      await evaluate("document.querySelector('[aria-label=\"Vestra settings pages\"] button[aria-label=Themes]').click()");
      await waitFor("Boolean(document.querySelector('[aria-label=\"Panel opacity\"]'))", "the active theme exposes appearance controls");
      await waitFor("document.querySelector('.vs-appearance-preview iframe')?.contentDocument?.body?.textContent.includes('mira')", "the scriptless preview is ready");
      await evaluate(`(() => {const frame=document.querySelector('.vs-appearance-preview iframe');window.__appearanceDocument=frame.contentDocument;window.__appearanceLoads=0;frame.addEventListener('load',()=>window.__appearanceLoads++);})()`);
      await evaluate(`(() => {const input=document.querySelector('[aria-label="Panel opacity"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'68');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await pause(50);
      assert.equal(await evaluate("window.Vestra.Settings.getThemes()[0].customization"), undefined, "editing is a preview until Apply");
      await page(values => {
        for(const [label,value] of Object.entries(values)) {
          const input=document.querySelector('[aria-label="'+label+'"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
          input.dispatchEvent(new Event('input',{bubbles:true}));
        }
      }, { "Glass blur":14, "Background saturation":75, "Background brightness":90, "Corner radius":16, "Text glow strength":35, "Text glow size":5, "Home panels opacity":60, "Profiles & menus opacity":95, "Settings opacity":98 });
      await evaluate(`(() => {const input=document.querySelector('[aria-label="Text color"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#e8e3ff');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await page(async () => {
        const canvas=document.createElement('canvas');canvas.width=40;canvas.height=40;
        canvas.getContext('2d').fillStyle='#31495c';canvas.getContext('2d').fillRect(0,0,40,40);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const files=new DataTransfer();files.items.add(new File([blob],'wallpaper.png',{type:'image/png'}));
        const input=document.querySelector('[aria-label="Choose background image"]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
      });
      await waitFor("document.querySelector('.vs-appearance-background p')?.textContent.includes('Image saved inside')", "local background is resized and embedded");
      await page(async () => {
        const input=document.querySelector('[aria-label="Panel opacity"]');
        for(let tick=0;tick<24;tick++){
          for(let step=0;step<6;step++){
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(10+(tick*7+step)%80));
            input.dispatchEvent(new Event('input',{bubbles:true}));
          }
          await new Promise(requestAnimationFrame);
        }
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'68');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
      await waitFor("document.querySelector('.vs-appearance-preview iframe')?.contentDocument?.querySelector('[data-vestra-preview-theme]')?.textContent.includes('rgb(22 18 30 / 0.68)')", "the latest rapid slider change reaches the preview");
      assert.equal(await evaluate("document.querySelector('.vs-appearance-preview iframe').contentDocument === window.__appearanceDocument && window.__appearanceLoads === 0"),true,"rapid changes never navigate or replace the preview document");
      assert.equal(await evaluate("document.querySelector('.vs-appearance-advanced').tagName"),"DIV","text and readability controls stay open");
      assert.equal(await evaluate("['Panel opacity','Home panels opacity','Profiles & menus opacity','Settings opacity'].every(label=>document.querySelector('[aria-label=\"'+label+'\"]').min==='0')"),true,"all opacity controls allow the complete range");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.vs-appearance-background p')).fontSize"),"13px","background image help uses readable text");
      const appearanceBounds = win.getBounds();
      for(const width of [1280,960,540]){
        win.setSize(width,800);
        await pause(80);
        assert.equal(await evaluate("(() => {const content=document.querySelector('.vs-settings-content');const card=document.querySelector('.vs-theme-customizer');const preview=document.querySelector('.vs-appearance-preview iframe');return content.scrollWidth<=content.clientWidth+1 && card.scrollWidth<=card.clientWidth+1 && preview.getBoundingClientRect().width>200})()"),true,`appearance fits a ${width}px window without horizontal overflow`);
      }
      win.setBounds(appearanceBounds);
      assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-chat')).backgroundColor"),"rgba(22, 18, 30, 0.2)","dragging stays a preview until Apply");
      await evaluate("Array.from(document.querySelectorAll('.vs-theme-customizer button')).find(button=>button.textContent==='Apply appearance').click()");
      await waitFor("window.Vestra.Settings.getThemes()[0]?.customization?.opacity === 68", "Apply stores the chosen opacity");
      await waitFor("document.querySelector('.vs-theme-customizer footer')?.textContent.includes('Appearance saved')", "saved feedback waits for disk confirmation");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-chat')).backgroundColor"), "rgba(22, 18, 30, 0.68)", "opacity changes the actual main surface");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-chat')).backdropFilter"), "blur(14px)", "blur changes the actual main surface");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-chat')).borderRadius"), "16px", "radius changes the actual main surface");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('app-mount'),'::before').filter"), "saturate(0.75) brightness(0.9)", "saturation and brightness apply to the backdrop only");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-image')).filter"), "none", "chat images are not color-filtered");
      assert.equal(await evaluate("window.Vestra.Settings.getThemes()[0].customization.textColor"),"#e8e3ff","text choice is saved");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('readable-message')).color"),"rgb(232, 227, 255)","text color updates independently from the wallpaper");
      assert.notEqual(await evaluate("getComputedStyle(document.getElementById('readable-message')).textShadow"),"none","glow can be enabled");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('readable-code')).textShadow"),"none","code stays crisp");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('role-name')).color"),"rgb(255, 85, 85)","role colors are preserved");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('discord-settings')).backgroundColor"),"rgba(22, 18, 30, 0.98)","settings opacity has its own readable range");
      assert.ok((await evaluate("window.Vestra.Settings.getThemes()[0].customization.backgroundImage")).startsWith("data:image/webp;base64,"), "saved backgrounds do not depend on temporary files");
      assert.equal(await evaluate("document.querySelector('.vs-appearance-preview iframe').getAttribute('sandbox')"),"allow-same-origin","only origin access is enabled; frame scripts remain blocked");
      await evaluate("window.Vestra.Settings.flush()");
      await win.loadURL("https://discord.com/channels/789/123");
      await waitFor("Boolean(window.Vestra?.started) && document.getElementById('vestra-splash') === null", "customized Glass restores in a new renderer");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-chat')).backgroundColor"), "rgba(22, 18, 30, 0.68)", "appearance survives a renderer restart");
      assert.ok((await evaluate("getComputedStyle(document.getElementById('app-mount'),'::before').backgroundImage")).includes("data:image/webp;base64,"), "the embedded backdrop is restored too");
      await evaluate("window.Vestra.Settings.setThemeCustomization('glass',undefined)");
      assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-chat')).backgroundColor"), "rgba(22, 18, 30, 0.2)", "Restore original returns to the authored Glass theme");
      await evaluate("window.Vestra.Settings.setThemes([])");

      await page(async (names) => {
        document.getElementById('app-mount').insertAdjacentHTML('beforeend','<div id="media-fixture" role="dialog" style="position:absolute;left:180px;top:140px;width:400px;height:300px"><div id="media-viewer" class="mediaViewer_fixture" style="position:fixed;inset:40px;display:grid;place-items:center"><img alt="Sample media" width="200" height="120"><button id="media-toolbar" style="position:fixed;left:24px;top:16px">Media tools</button></div></div><div id="gif-fixture" role="dialog" style="position:fixed;inset:0;pointer-events:none"><section class="expressionPicker_fixture" style="position:absolute;right:16px;bottom:80px;width:300px;height:240px">GIF picker</section></div>');
      }, []);
      for(const preset of presets){
        await page(preset=>window.Vestra.Settings.setThemes([{id:'review',name:preset.name,author:'Vestra',css:preset.css,enabled:true}]),preset);
        const nativeColor=await evaluate("getComputedStyle(document.getElementById('fixture-chat')).backgroundColor");
        await evaluate("window.Vestra.Settings.setThemeCustomization('review',{surfaceOverrides:false,textColor:'#e8e3ff',glowStrength:35})");
        assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-chat')).backgroundColor"),nativeColor,`${preset.name} keeps its palette when only text effects change`);
        assert.equal(await evaluate("getComputedStyle(document.getElementById('media-fixture')).backdropFilter"),'none',`${preset.name} does not create a fixed-position containing block around media`);
        assert.equal(await evaluate("document.getElementById('media-toolbar').getBoundingClientRect().left"),24,`${preset.name} keeps image tools anchored to the viewport`);
        assert.equal(await evaluate("getComputedStyle(document.getElementById('gif-fixture')).backgroundColor"),'rgba(0, 0, 0, 0)',`${preset.name} does not paint a full-screen GIF carrier`);
        await evaluate("window.Vestra.Settings.setThemeCustomization('review',{surfaceOverrides:true,opacity:35})");
        assert.equal(await evaluate("getComputedStyle(document.getElementById('media-fixture')).backdropFilter"),'none',`${preset.name} custom surfaces also preserve media placement`);
        assert.equal(await evaluate("getComputedStyle(document.getElementById('gif-fixture')).backgroundColor"),'rgba(0, 0, 0, 0)',`${preset.name} custom surfaces leave the GIF carrier clear`);
      }
      await evaluate("document.getElementById('media-fixture').remove();document.getElementById('gif-fixture').remove();window.Vestra.Settings.setThemes([])");

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
          document.getElementById(id).dispatchEvent(
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
      assert.match(await evaluate("document.querySelector('time').getAttribute('data-vestra-time-compact')"), /^\d{2}:\d{2}$/, "grouped message gutters only show a short clock");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('time'),'::after').whiteSpace"), "nowrap", "timestamps cannot split the year into another line");
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
      await page(
        (preset) =>
          window.Vestra.Settings.setThemes([
            {
              id: "restart-theme",
              name: preset.name,
              author: "Vestra",
              css: preset.css,
              enabled: true,
            },
          ]),
        presets[3],
      );
      await evaluate(
        "window.Vestra.Settings.flush().then(() => { localStorage.clear(); delete window.localStorage; })",
      );
      await win.loadURL("https://discord.com/channels/789/123");
      await waitFor(
        "Boolean(window.Vestra?.started && document.querySelector('.vs-settings-launcher')) && document.getElementById('vestra-splash') === null",
        "runtime and launcher restore after navigation",
      );
      assert.equal(
        await evaluate(
          "getComputedStyle(document.getElementById('fixture-chat')).backgroundColor",
        ),
        "rgb(16, 31, 28)",
        "selected Aurora survives a new renderer and late native startup CSS",
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
