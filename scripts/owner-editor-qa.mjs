import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const output = path.join(root, "outputs");
const temporary = await mkdtemp(path.join(os.tmpdir(), "al-amin-owner-editor-qa-"));
const catalogPath = path.join(temporary, "specialists.json");
const assetRoot = path.join(temporary, "assets");
const backupRoot = path.join(temporary, "backups");
const photoPath = path.join(temporary, "portrait.png");
const screenshotPath = path.join(output, "owner-editor-qa.png");
const browserCandidates = process.platform === "win32"
  ? ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const browser = process.env.BROWSER_PATH || browserCandidates.find(existsSync);
if (!browser) throw new Error("Headless Chromium browser not found.");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const editorPort = await freePort();
const browserPort = await freePort();
await mkdir(output, { recursive: true });
await writeFile(catalogPath, '{"version":1,"specialists":[]}\n', "utf8");
await sharp({ create: { width: 320, height: 400, channels: 3, background: { r: 203, g: 223, b: 214 } } }).png().toFile(photoPath);

const editor = spawn(process.execPath, ["scripts/owner-editor.mjs"], {
  cwd: root,
  env: { ...process.env, OWNER_EDITOR_PORT: String(editorPort), OWNER_EDITOR_CATALOG_PATH: catalogPath, OWNER_EDITOR_ASSET_ROOT: assetRoot, OWNER_EDITOR_BACKUP_ROOT: backupRoot },
  stdio: "ignore",
  windowsHide: true,
});

const browserProcess = spawn(browser, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${browserPort}`,
  `--user-data-dir=${path.join(temporary, "browser")}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

async function waitFor(check, message, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { if (await check()) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function websocketEndpoint() {
  let endpoint;
  await waitFor(async () => {
    const targets = await fetch(`http://127.0.0.1:${browserPort}/json/list`).then((response) => response.json());
    endpoint = targets.find((item) => item.type === "page")?.webSocketDebuggerUrl;
    return Boolean(endpoint);
  }, "Could not connect to Chromium DevTools.");
  return endpoint;
}

let socket;
try {
  await waitFor(() => fetch(`http://127.0.0.1:${editorPort}/`).then((response) => response.ok), "Owner editor did not start.");
  socket = new WebSocket(await websocketEndpoint());
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = async (event) => {
    const raw = typeof event.data === "string" ? event.data : Buffer.from(await event.data.arrayBuffer()).toString("utf8");
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
    return result.result.value;
  };
  const waitForBrowser = (expression, message) => waitFor(() => evaluate(`Boolean(${expression})`), message);

  await send("Page.enable");
  await send("DOM.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 1000 });
  await send("Page.navigate", { url: `http://127.0.0.1:${editorPort}/` });
  await waitForBrowser('document.readyState === "complete" && document.querySelector("#add")', "Editor UI did not load.");
  const technicalTextVisible = await evaluate('document.body.innerText.includes("JSON") || document.body.innerText.includes("Slug") || document.body.innerText.includes("Trust") || document.body.innerText.includes("Опубликован") || document.body.innerText.includes("Порядок")');
  assert.equal(technicalTextVisible, false);

  await evaluate(`(() => {
    const set = (selector, value) => { const input = document.querySelector(selector); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); };
    document.querySelector("#add").click();
    set('[name="fullName"]', "Тестовый Специалист");
    set('[name="specialization"]', "Карьерный консультант");
    set('[name="country"]', "Россия");
    set('[name="city"]', "Казань");
    set('[name="workMode"]', "both");
    set('[name="experienceYears"]', "7");
    set('[name="profileSummary"]', "Помогает спокойно определить следующий профессиональный шаг.");
    set('[name="about"]', "Работает с профессиональными переходами и помогает принимать решения с опорой на факты и личный контекст.");
    set("#category-input", "Карьера"); document.querySelector("#add-category").click();
    document.querySelector("#add-help-topic").click();
    set("[data-help-title]", "Смена профессии"); set("[data-help-description]", "Помогает оценить варианты и составить реалистичный план перехода.");
    document.querySelector("#add-work-offer").click(); document.querySelector("#add-work-offer").click();
    const offers = document.querySelectorAll("#work-offers .repeater-card");
    const setIn = (root, selector, value) => { const input = root.querySelector(selector); input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); };
    setIn(offers[0], "[data-offer-title]", "Индивидуальная консультация"); setIn(offers[0], "[data-offer-duration]", "60"); setIn(offers[0], "[data-offer-mode]", "online"); setIn(offers[0], "[data-offer-price]", "5000"); setIn(offers[0], "[data-offer-currency]", "RUB");
    setIn(offers[1], "[data-offer-title]", "Разбор карьерной ситуации"); setIn(offers[1], "[data-offer-mode]", "both");
    document.querySelector("#add-portfolio-item").click();
    set("[data-portfolio-title]", "Методика карьерного выбора"); set("[data-portfolio-description]", "Пример структуры работы с профессиональными решениями."); set("[data-portfolio-url]", "example.com/method");
    set('[name="phone"]', "+7 900 000-00-00"); set('[name="email"]', "test@example.com"); set('[name="telegram"]', "https://t.me/test_editor"); set('[name="whatsapp"]', "+7 900 000-00-00"); set('[name="website"]', "example.com");
    document.querySelector('[name="featured"]').checked = true;
    document.querySelector('[name="publishConsent"]').checked = true;
    return true;
  })()`);

  const documentNode = await send("DOM.getDocument", { depth: -1 });
  const fileNode = await send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#photo-file" });
  await send("DOM.setFileInputFiles", { nodeId: fileNode.nodeId, files: [photoPath] });
  await evaluate('document.querySelector("#photo-file").dispatchEvent(new Event("change", { bubbles: true }))');
  await waitForBrowser('document.querySelector("#errors").textContent.includes("Фотография готова")', "Photo upload did not finish.");

  await evaluate('document.querySelector("#preview").click()');
  await waitForBrowser('document.querySelector("#preview-dialog").open && document.querySelector("#preview-content").innerText.includes("Тестовый Специалист") && document.querySelector("#preview-content").innerText.includes("Методика карьерного выбора") && document.querySelector("#preview-content").innerText.includes("test@example.com")', "Preview did not open with profile details.");
  await evaluate('document.querySelector("#close-preview").click(); document.querySelector("#form").requestSubmit()');
  await waitForBrowser('document.querySelector("#errors").textContent.includes("Специалист сохранён")', "Initial save did not finish.");

  let stored = await fetch(`http://127.0.0.1:${editorPort}/api/catalog`).then((response) => response.json());
  assert.equal(stored.specialists.length, 1);
  const initialSlug = stored.specialists[0].slug;
  assert.match(initialSlug, /^testovyy-spetsialist(?:-\d+)?$/u);
  assert.equal(stored.specialists[0].published, true);
  assert.equal(stored.specialists[0].featured, true);
  assert.equal(stored.specialists[0].trust.recommendedByAlAmin, false);
  assert.deepEqual(stored.specialists[0].trust.verifiedFacts, []);
  assert.equal(stored.specialists[0].photo.alt, "Фото: Тестовый Специалист");
  assert.equal(stored.specialists[0].helpTopics.length, 1);
  assert.equal(stored.specialists[0].workOffers.length, 2);
  assert.equal(stored.specialists[0].workOffers[0].currency, "RUB");
  assert.equal(stored.specialists[0].workOffers[1].currency, null);
  assert.equal(stored.specialists[0].contacts.telegram, "@test_editor");
  assert.equal(stored.specialists[0].contacts.website, "https://example.com");
  assert.equal(stored.specialists[0].portfolio[0].url, "https://example.com/method");
  assert.equal(existsSync(path.join(assetRoot, initialSlug, "profile.webp")), true);

  await send("Page.reload");
  await waitForBrowser('document.querySelector("#form") && !document.querySelector("#form").hidden && document.querySelector("#work-offers").children.length === 2', "Saved specialist did not reopen.");
  const reopened = await evaluate('JSON.stringify({name:document.querySelector("[name=fullName]").value,help:document.querySelector("#help-topics").children.length,offers:document.querySelector("#work-offers").children.length,featured:document.querySelector("[name=featured]").checked})');
  assert.deepEqual(JSON.parse(reopened), { name: "Тестовый Специалист", help: 1, offers: 2, featured: true });

  await evaluate(`(() => { const set = (selector, value) => { const input = document.querySelector(selector); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }; set('[name="fullName"]', "Тестовый Специалист Обновлённый"); set('[name="city"]', "Москва"); document.querySelector("#form").requestSubmit(); return true; })()`);
  await waitForBrowser('document.querySelector("#errors").textContent.includes("Специалист сохранён")', "Edited specialist did not save.");
  stored = await fetch(`http://127.0.0.1:${editorPort}/api/catalog`).then((response) => response.json());
  assert.equal(stored.specialists[0].fullName, "Тестовый Специалист Обновлённый");
  assert.equal(stored.specialists[0].city, "Москва");
  assert.equal(stored.specialists[0].slug, initialSlug);
  assert.equal(stored.specialists[0].photo.alt, "Фото: Тестовый Специалист Обновлённый");

  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await evaluate('window.confirm = () => true; document.querySelector("#remove").click()');
  await waitFor(async () => (await fetch(`http://127.0.0.1:${editorPort}/api/catalog`).then((response) => response.json())).specialists.length === 0, "Test specialist was not removed.");
  const finalCatalog = JSON.parse(await readFile(catalogPath, "utf8"));
  assert.deepEqual(finalCatalog, { version: 1, specialists: [] });
  process.stdout.write(JSON.stringify({ ok: true, screenshot: screenshotPath, saved: true, reopened: true, edited: true, photo: true, helpTopics: 1, workOffers: 2, contacts: true, featured: true, preview: true, removed: true, productionContentTouched: false }) + "\n");
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browserProcess.kill();
  editor.kill();
  await new Promise((resolve) => setTimeout(resolve, 800));
  try {
    await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  } catch (error) {
    if (error?.code !== "EBUSY") throw error;
    process.stderr.write(`Temporary browser profile is still locked and will be removed by the system: ${temporary}\n`);
  }
}
