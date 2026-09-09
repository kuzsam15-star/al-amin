import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("out");
const port = Number(process.env.PORT ?? 4174);
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2" };

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes("..")) throw new Error("invalid path");
    let file = path.join(root, decoded);
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = path.join(file, "index.html");
    else if (!info) file = path.join(root, decoded, "index.html");
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Static AL-AMIN: http://127.0.0.1:${port}`));
