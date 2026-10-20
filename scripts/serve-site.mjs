import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../site/dist",
);
const port = Number(process.env.VESTRA_SITE_PORT || 4180);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    let relative = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    )
      .replace(/^\/Vestra(?=\/|$)/, "")
      .replace(/^\/+/, "");
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const content = await fs.readFile(filename);
    response.writeHead(200, {
      "Content-Type":
        types[path.extname(filename)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(await fs.readFile(path.join(root, "404.html")));
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Vestra website: http://127.0.0.1:${port}/Vestra/`),
);
