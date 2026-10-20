// Runs only in the disposable Electron fixture created by smoke-electron.mjs.
const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const assert = require("node:assert/strict");
const presets = require("./theme-fixture.json");
const utilityNames = ["ImageZoom", "QuickMessageCopy", "CleanLinkCopy", "FullTimestamps", "CodeBlockCopy", "FocusMode"];

app.setPath("userData", path.join(__dirname, "user-data"));
app.setPath("appData", path.join(__dirname, "app-data"));
app.setPath("sessionData", path.join(__dirname, "session-data"));
const timer = setTimeout(() => { console.error("Electron smoke timed out"); app.exit(1); }, 25000);

// Simulate only the host identity; use real Electron sessions, frames, IPC,
// context isolation, sandbox, CSP, bundle execution and DOM for everything else.
const executable = process.execPath;
try {
  process.execPath = path.join(__dirname, "Discord.exe");
  require(path.join(__dirname, "main-hook.cjs"));
} finally { process.execPath = executable; }

app.whenReady().then(async () => {
  const ses = session.fromPartition(`vestra-smoke-${Date.now()}`);
  const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#a89dc9"/></svg>');
  const html = `<!doctype html><html class="visual-refresh theme-dark"><head><title>Disposable Discord fixture</title><style>
  body{margin:0}.visual-refresh.theme-dark,.visual-refresh .theme-dark{--background-base-low:#242424;--background-base-lower:#202020;--background-base-lowest:#141414;--background-surface-high:#303030;--input-background-default:#343434}
  #fixture-chat{background:var(--background-base-low)}#fixture-side{background:var(--background-base-lower)}#fixture-rail{background:var(--background-base-lowest)}#fixture-popout{background:var(--background-surface-high)}#fixture-input{background:var(--input-background-default)}
  </style></head><body><main id="app-mount"><div id="fixture-chat">Chat</div><div class="sidebarList_test" id="fixture-side">Channels</div><div id="fixture-rail">Servers</div><div class="theme-dark"><div id="fixture-popout">Popout</div><input id="fixture-input"/></div>
  <li id="chat-messages-123-456"><time datetime="2026-10-20T03:15:32Z"><span>Today</span></time><div id="message-content-456"><b id="fixture-message">Hello fixture</b><a id="fixture-link" href="https://example.test/watch?v=abc&utm_source=discord#part">Link</a><pre><code>const hello = 1;</code></pre></div><img id="fixture-image" width="320" height="240" src="${image}"/></li></main></body></html>`;
  await ses.protocol.handle("https", () => new Response(html, { headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'" } }));
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.on("preload-error", (_event, _file, error) => console.error("Preload error:", error));
  win.webContents.on("console-message", (_event, level, message) => { if (level >= 2) console.error("Renderer:", message); });
  const evaluate = source => win.webContents.executeJavaScript(source);
  const page = (fn, ...args) => evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    await win.loadURL("https://discord.com/channels/789/123");
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = await evaluate("Boolean(window.Vestra && window.Vestra.started)");
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, "runtime booted inside sandbox with strict CSP");
    const result = await evaluate(`(async () => {
      const v = window.Vestra;
      await v.Plugins.enable('ReducedMotion');
      const reduced = v.Styles.has('plugin-reduced-motion');
      await v.Plugins.disable('ReducedMotion');
      v.Settings.setThemes([{id:'smoke',name:'Smoke',author:'Test',css:':root{--vestra-smoke:1}',enabled:true}]);
      const theme = v.Styles.has('theme-smoke');
      v.Settings.setCustomCss({enabled:true,css:':root{--vestra-quick-smoke:1}'});
      const quick = v.Styles.has('quickcss');
      v.UI.openSettings();
      return {native:v.Native.isAvailable(),plugins:v.Plugins.list().length,sdk:v.Styles.has('ExamplePlugin'),reduced,stopped:!v.Styles.has('plugin-reduced-motion'),theme,quick};
    })()`);
    assert.deepEqual(result, { native: true, plugins: 10, sdk: true, reduced: true, stopped: true, theme: true, quick: true });
    // A fast successful bootstrap still paints the splash, then reveals the client.
    assert.equal(await evaluate("Boolean(document.getElementById('vestra-splash'))"), true);
    await pause(1400);
    const reveal = await evaluate("(() => {const el=document.getElementById('vestra-splash'); const style=getComputedStyle(el); return {closing:el.classList.contains('vs-done'),mask:style.maskImage,progress:parseFloat(style.getPropertyValue('--vs-reveal'))}})()");
    assert.equal(reveal.closing, true, 'fast startup reaches the reveal animation');
    assert.ok(reveal.mask.includes('radial-gradient') && reveal.progress > 0 && reveal.progress < 125, 'the radial transparency actually interpolates in Chromium');
    await pause(900);
    assert.equal(await evaluate("Boolean(document.querySelector('[aria-modal=true]'))"), true);
    assert.equal(await evaluate("document.getElementById('vestra-splash') === null"), true);

    for (const preset of presets) {
      const colors = await page(preset => {
        window.Vestra.Settings.setThemes([{ id:'palette',name:preset.name,author:'Vestra',css:preset.css,enabled:true }]);
        return ['fixture-chat','fixture-side','fixture-rail','fixture-popout','fixture-input'].map(id => getComputedStyle(document.getElementById(id)).backgroundColor);
      }, preset);
      const rgb = hex => `rgb(${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)})`;
      assert.equal(colors[0], rgb(preset.colors[1]), `${preset.name} changes the actual chat surface`);
      assert.equal(colors[2], rgb(preset.colors[0]), `${preset.name} changes the actual server rail`);
      assert.ok(colors[1] !== 'rgb(32, 32, 32)' && colors[3] !== 'rgb(48, 48, 48)' && colors[4] !== 'rgb(52, 52, 52)', 'nested scopes, sidebars, popouts and composer update');
    }
    await evaluate("window.Vestra.Settings.setThemes([])");
    assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-chat')).backgroundColor"), 'rgb(36, 36, 36)', 'disabling themes restores the host palette');

    await page(async names => {
      window.__fixtureCopies = [];
      Object.defineProperty(navigator, 'clipboard', { configurable:true,value:{ async writeText(text) { window.__fixtureCopies.push(text); } } });
      for (const name of names) { await window.Vestra.Plugins.enable(name); if (!window.Vestra.Plugins.isStarted(name)) throw new Error(name + ' did not start'); }
    }, utilityNames);
    const copied = await page(async () => {
      const click = (id, shiftKey = false) => document.getElementById(id).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,altKey:true,shiftKey}));
      click('fixture-message'); click('fixture-message',true); click('fixture-link');
      document.querySelector('[data-vestra-code-copy]').click();
      await Promise.resolve(); return window.__fixtureCopies;
    });
    assert.deepEqual(copied, ['Hello fixtureLink\nconst hello = 1;','https://discord.com/channels/789/123/456','https://example.test/watch?v=abc#part','const hello = 1;']);
    // React-like replacement of a code block's children must recreate our button.
    await evaluate("document.querySelector('pre').innerHTML='<code>new code</code>'");
    await pause(100);
    assert.equal(await evaluate("document.querySelectorAll('[data-vestra-code-copy]').length"), 1);
    await evaluate("document.querySelector('time').setAttribute('datetime','2026-11-21T11:22:44Z')");
    await pause(50);
    assert.equal(await evaluate("document.querySelector('time').getAttribute('data-vestra-time').includes('44')"), true);
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',ctrlKey:true,altKey:true,bubbles:true,cancelable:true}))");
    assert.equal(await evaluate("getComputedStyle(document.getElementById('fixture-side')).display"), 'none');
    const zoom = await page(() => {
      const img = document.getElementById('fixture-image'); const rect = img.getBoundingClientRect();
      img.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,altKey:true,clientX:rect.x+100,clientY:rect.y+100}));
      const lens = document.querySelector('[data-vestra-image-lens]');
      const before = lens.style.backgroundSize;
      img.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,altKey:true,deltaY:-100}));
      const visible = lens.style.display === 'block', changed = before !== lens.style.backgroundSize;
      document.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt'}));
      return { visible,changed,hidden:lens.style.display === 'none' };
    });
    assert.deepEqual(zoom, { visible:true,changed:true,hidden:true });
    await page(async names => { for (const name of names) await window.Vestra.Plugins.disable(name); }, utilityNames);
    assert.equal(await evaluate("document.querySelector('[data-vestra-code-copy],[data-vestra-time],[data-vestra-image-lens]') === null && !document.documentElement.hasAttribute('data-vestra-focus')"), true, 'all plugin DOM, observers and global state clean up');
    await evaluate("document.getElementById('fixture-message').dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true}))");
    assert.equal(await evaluate("window.__fixtureCopies.length"), 4, 'disabled clipboard shortcuts are removed');

    await evaluate("window.Vestra.UI.closeSettings()");
    await pause(220);
    const point = await evaluate("(() => {const r=document.querySelector('.vs-settings-launcher').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x),y:Math.round(point.y)});
    await pause(30);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,modifiers:['leftButtonDown'],x:Math.round(point.x),y:Math.round(point.y)});
    await pause(30);
    win.webContents.sendInputEvent({type:'mouseMove',x:650,y:110,modifiers:['leftButtonDown']});
    await pause(30);
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:650,y:110});
    await pause(100);
    const moved = await evaluate("({position:window.Vestra.Settings.getPluginSetting('Vestra','launcherPosition'),open:document.querySelector('.vs-settings-launcher').getAttribute('aria-expanded')})");
    assert.ok(moved.position.x > .7 && moved.position.y < .3, 'real mouse dragging persists the launcher position');
    assert.equal(moved.open, 'false', 'dragging does not open settings');
    await win.loadURL("https://discord.com/channels/789/123");
    await pause(2400);
    assert.deepEqual(await evaluate("window.Vestra.Settings.getPluginSetting('Vestra','launcherPosition')"), moved.position, 'position survives a full reload');
    const launcher = await evaluate("(() => {const r=document.querySelector('.vs-settings-launcher').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,modifiers:['leftButtonDown'],x:Math.round(launcher.x),y:Math.round(launcher.y)});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(launcher.x),y:Math.round(launcher.y)});
    await pause(60);
    assert.equal(await evaluate("document.querySelector('.vs-settings-launcher').getAnimations().length > 0"), true, 'button plays a press and rebound animation');
    await pause(600);
    assert.equal(await evaluate("Boolean(document.querySelector('[aria-modal=true]'))"), true, 'normal click opens settings after dragging and reloading');
    await win.loadURL("https://example.test/app");
    assert.equal(await evaluate("typeof window.VestraNative"), "undefined");
    assert.equal(await evaluate("document.getElementById('vestra-splash') === null"), true);
    console.log("PASS Electron sandbox + CSP + IPC + 10 plugins + modern theme surfaces + plugin actions/cleanup + splash + real pointer dragging/persistence + launcher animation + overlay + external-page exclusion");
    clearTimeout(timer);
    win.destroy();
    app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timer); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
