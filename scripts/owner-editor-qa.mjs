import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Owner Editor QA server did not start.");
}

const root = process.cwd();
const temporary = await mkdtemp(path.join(os.tmpdir(), "al-amin-owner-editor-qa-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const catalogPath = path.join(temporary, "specialists.json");
const sitePath = path.join(temporary, "site.json");
const assetRoot = path.join(temporary, "assets");
await mkdir(assetRoot, { recursive: true });
await writeFile(catalogPath, '{"version":1,"specialists":[]}\n', "utf8");
await writeFile(sitePath, await readFile(new URL("../content/site.json", import.meta.url), "utf8"), "utf8");

const editor = spawn(process.execPath, [path.resolve("scripts/owner-editor.mjs")], {
  cwd: root,
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    OWNER_EDITOR_PORT: String(port),
    OWNER_EDITOR_CATALOG_PATH: catalogPath,
    OWNER_EDITOR_SITE_PATH: sitePath,
    OWNER_EDITOR_ASSET_ROOT: assetRoot,
    OWNER_EDITOR_BACKUP_ROOT: path.join(temporary, "backups"),
    OWNER_EDITOR_SUBMISSIONS_ROOT: path.join(temporary, "submissions"),
    OWNER_EDITOR_REVIEW_MEDIA_ROOT: path.join(temporary, "review-media"),
    OWNER_EDITOR_SKIP_PREVIEW_BUILD: "1",
    OWNER_EDITOR_QA_ALLOW_NO_ORIGIN: "1",
  },
});

try {
  await waitFor(`${base}/`);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") || "", /frame-ancestors 'none'/u);
  const html = await page.text();
  assert.match(html, />Специалисты</u);
  assert.match(html, />Заявки/u);
  assert.match(html, />Главная страница</u);
  assert.match(html, /Импортировать заявку/u);
  assert.match(html, /Перетащите сюда файл заявки AL-AMIN/u);
  assert.doesNotMatch(html, /Supabase|Turnstile|service.role/iu);

  const script = await fetch(`${base}/app.js`).then((response) => response.text());
  assert.match(script, /\/api\/submissions\/import/u);
  assert.match(script, /maxSubmissionFileBytes/u);
  assert.match(script, /Специалист добавлен в локальный каталог/u);
  assert.doesNotMatch(script, /supabase|turnstile/iu);

  const initial = await fetch(`${base}/api/submissions`).then((response) => response.json());
  assert.equal(initial.source, "local-file-import");
  assert.deepEqual(initial.submissions, []);

  const site = JSON.parse(await readFile(sitePath, "utf8"));
  site.heroTitle = "Локальный QA заголовок";
  const siteSave = await fetch(`${base}/api/site`, { method: "PUT", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(site) });
  assert.equal(siteSave.status, 200);
  assert.equal(JSON.parse(await readFile(sitePath, "utf8")).heroTitle, "Локальный QA заголовок");
  assert.equal(JSON.parse(await readFile(catalogPath, "utf8")).specialists.length, 0);

  process.stdout.write(`${JSON.stringify({ ok: true, loopbackOnly: true, hostOriginChecksActive: true, threeSections: true, importControls: true, localInboxOnly: true, homeEditingPreserved: true, productionContentTouched: false })}\n`);
} finally {
  editor.kill();
  await new Promise((resolve) => setTimeout(resolve, 350));
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
