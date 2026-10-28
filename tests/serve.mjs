// Serves dist/ under /astronomy/, as on kacyluker.com, for the site tests
// (playwright.config.mjs starts it). Usage: node tests/serve.mjs [port]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.argv[2] ?? 8790);
const ROOT = "dist";
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!path.startsWith("/astronomy/")) {
    res.writeHead(404).end();
    return;
  }
  let file = join(ROOT, normalize(path.slice("/astronomy/".length)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Serving ${ROOT}/ at http://localhost:${PORT}/astronomy/`));
