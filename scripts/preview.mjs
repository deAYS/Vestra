// Local interactive preview. No Discord discovery, injection or account access.
import { build } from "esbuild";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = [
  ["/vestra.js", "packages/core/src/index.ts", "Vestra"],
  ["/splash.js", "packages/injector/src/splash.ts", "VestraSplash"],
];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vestra · Development preview</title><style>
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 50% 40%,#30213a55,transparent 60%),#0D0C11;color:#E4DDED;font:14px "Segoe UI",system-ui}.preview-top{height:72px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #FFFFFF07;padding:0 30px}.preview-top>span{font-size:12px;color:#8F829F}.preview-top b{color:#C5BAF8;margin-right:12px;font-size:20px;letter-spacing:-.06em}.preview-top button{font:11px "Segoe UI",sans-serif;color:#B9ACCB;background:#FFFFFF03;border:1px solid #FFFFFF0D;padding:9px 13px;border-radius:8px;margin-left:8px;cursor:pointer}main{display:grid;place-content:center;justify-items:center;min-height:calc(100vh - 72px);text-align:center}main img{width:110px;height:110px;opacity:.7}h1{font-weight:500;font-size:32px;letter-spacing:-.04em;margin:15px 0 10px}main p{color:#6D607D;font-size:12px;margin:0}.preview-note{position:fixed;right:25px;bottom:18px;color:#62556F;font-size:10px}
</style></head><body><header class="preview-top"><span><b>vestra</b> Development preview</span><div><button id="settings">Open Vestra settings</button><button id="splash">Preview startup</button></div></header><main><img src="/brand.svg" alt="Vestra"/><h1>Your space. A little more you.</h1><p>A local playground for your next favorite look.</p></main><span class="preview-note">Local preview · disconnected from Discord</span><script src="/vestra.js"></script><script src="/splash.js"></script><script>
window.Vestra = window.Vestra.Vestra;
window.Vestra.start().then(() => window.Vestra.UI.openSettings());
document.getElementById('settings').onclick = () => window.Vestra.UI.openSettings();
document.getElementById('splash').onclick = () => {
  window.Vestra.UI.closeSettings();
  const splash = VestraSplash.showSplash();
  splash.set(12,'Loading Vestra runtime…');
  setTimeout(() => splash.set(42,'Native bridge connected'), 900);
  setTimeout(() => splash.set(68,'Starting plugins and themes…'), 1900);
  setTimeout(() => splash.set(100,'Ready. Your Discord. Your rules.'), 3400);
};
</script></body></html>`;
const port = Number(process.env.VESTRA_PREVIEW_PORT || 4173);
createServer(async (request, response) => {
  response.setHeader("Cache-Control","no-store");
  try {
    if (request.url === "/brand.svg") { response.setHeader("Content-Type","image/svg+xml"); response.end(await fs.readFile(path.join(root,"assets/vestra-logo/logo-icon.svg"))); return; }
    const entry = entries.find(([url])=>url===request.url);
    if (entry) {
      const result=await build({absWorkingDir:root,entryPoints:[entry[1]],bundle:true,platform:"browser",format:"iife",globalName:entry[2],define:{"process.env.NODE_ENV":'"development"'},write:false});
      response.setHeader("Content-Type","application/javascript; charset=utf-8");response.end(result.outputFiles[0].text);return;
    }
    response.setHeader("Content-Type","text/html; charset=utf-8");response.end(html);
  } catch(error) {response.statusCode=500;response.end(String(error));}
}).listen(port, "127.0.0.1", () => console.log(`Vestra preview: http://127.0.0.1:${port}`));
