import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { validateContent, validateSpecialistsDocument } from "../src/lib/static-content-contract.mjs";

const root = process.cwd();
const host = "127.0.0.1";
const port = Number(process.env.OWNER_EDITOR_PORT ?? 4173);
const catalogPath = path.join(root, "content", "specialists.json");
const sitePath = path.join(root, "content", "site.json");
const uiRoot = path.join(root, "tools", "owner-editor");
const backupRoot = path.join(root, ".local-editor", "backups");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

async function body(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Файл или запрос слишком большой.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function atomicSave(file, value) {
  await mkdir(backupRoot, { recursive: true });
  const current = await readFile(file, "utf8");
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  await writeFile(path.join(backupRoot, `${stamp}-specialists.json`), current, "utf8");
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname === "/api/catalog" && request.method === "GET") {
      return json(response, 200, JSON.parse(await readFile(catalogPath, "utf8")));
    }
    if (url.pathname === "/api/catalog" && request.method === "PUT") {
      const candidate = JSON.parse((await body(request, 2 * 1024 * 1024)).toString("utf8"));
      const result = validateSpecialistsDocument(candidate);
      if (result.errors.length) return json(response, 422, { errors: result.errors });
      const site = JSON.parse(await readFile(sitePath, "utf8"));
      const full = validateContent(site, result.data);
      if (full.errors.length) return json(response, 422, { errors: full.errors });
      await atomicSave(catalogPath, result.data);
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/photo" && request.method === "POST") {
      const slug = url.searchParams.get("slug") ?? "";
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) return json(response, 422, { errors: ["Сначала задайте корректный slug."] });
      const input = await body(request, 12 * 1024 * 1024);
      const directory = path.join(root, "public", "images", "specialists", slug);
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, "profile.webp");
      await sharp(input).rotate().resize({ width: 1200, height: 1440, fit: "cover", position: "attention", withoutEnlargement: true }).webp({ quality: 84 }).toFile(destination);
      return json(response, 200, { src: `/images/specialists/${slug}/profile.webp` });
    }
    const fileName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!["index.html", "app.js", "styles.css"].includes(fileName)) throw new Error("not found");
    const file = path.join(uiRoot, fileName);
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end(await readFile(file));
  } catch (error) {
    json(response, 500, { errors: [error instanceof Error ? error.message : "Неизвестная ошибка"] });
  }
}).listen(port, host, () => console.log(`AL-AMIN owner editor: http://${host}:${port}`));
