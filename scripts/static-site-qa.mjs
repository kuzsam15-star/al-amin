import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const browserCandidates = process.platform === "win32"
  ? ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const browser = process.env.BROWSER_PATH || browserCandidates.find(existsSync);
if (!browser) throw new Error("Headless Chromium browser not found.");
const configuredBasePath = process.env.STATIC_BASE_PATH ?? "";
const basePath = configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/$/u, "");
const previewOrigin = "http://127.0.0.1:4174";
const previewUrl = (pathname) => `${previewOrigin}${basePath}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
const specialistPathPrefix = `${basePath}/specialists/`;

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

async function waitFor(check, message, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { if (await check()) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "al-amin-static-qa-"));
const output = path.resolve("outputs");
await mkdir(output, { recursive: true });
const browserPort = await freePort();
const browserProcess = spawn(browser, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${browserPort}`,
  `--user-data-dir=${path.join(temporary, "browser")}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

let socket;
try {
  await waitFor(() => fetch(previewUrl("/")).then((response) => response.ok), "Static preview did not start.");
  let endpoint;
  await waitFor(async () => {
    const targets = await fetch(`http://127.0.0.1:${browserPort}/json/list`).then((response) => response.json());
    endpoint = targets.find((item) => item.type === "page" && !String(item.url).startsWith("chrome-extension:"))?.webSocketDebuggerUrl;
    return Boolean(endpoint);
  }, "Could not connect to Chromium DevTools.");
  socket = new WebSocket(endpoint);
  socket.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", async (event) => {
    const raw = typeof event.data === "string"
      ? event.data
      : event.data instanceof ArrayBuffer
        ? Buffer.from(event.data).toString("utf8")
        : ArrayBuffer.isView(event.data)
          ? Buffer.from(event.data.buffer, event.data.byteOffset, event.data.byteLength).toString("utf8")
          : Buffer.from(await event.data.arrayBuffer()).toString("utf8");
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  });
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
  async function captureElement(selector, filename, padding = 24) {
    const bounds = JSON.parse(await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return JSON.stringify({ x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height });
    })()`));
    if (!bounds) throw new Error(`Capture target not found: ${selector}`);
    const x = Math.max(0, Math.floor(bounds.x - padding));
    const y = Math.max(0, Math.floor(bounds.y - padding));
    const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip: { x, y, width: Math.ceil(bounds.width + padding * 2), height: Math.ceil(bounds.height + padding * 2), scale: 1 } });
    await writeFile(path.join(output, filename), Buffer.from(screenshot.data, "base64"));
  }
  async function open(url, width, height, mobile) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
    await send("Page.navigate", { url });
    const expectedPath = new URL(url).pathname.replace(/\/+$/u, "") || "/";
    await waitFor(() => evaluate('document.readyState === "complete"'), `Page did not finish: ${url}`);
    const actualPath = await evaluate('location.pathname !== "/" && location.pathname.endsWith("/") ? location.pathname.slice(0, -1) : location.pathname');
    assert.equal(actualPath, expectedPath);
  }
  await send("Page.enable");

  const results = {};
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000, mobile: false }, { name: "tablet", width: 1024, height: 900, mobile: false }, { name: "mobile", width: 390, height: 844, mobile: true }]) {
    await open(previewUrl("/"), viewport.width, viewport.height, viewport.mobile);
    await waitFor(() => evaluate('Array.from(document.querySelectorAll(\'a[aria-label^="Открыть профиль:"] img\')).some((image) => image.complete && image.naturalWidth > 0)'), "Home specialist image did not load.");
    const home = await evaluate(`(() => {
      const profileLinks = [...document.querySelectorAll('a[aria-label^="Открыть профиль:"]')].filter((link) => link.getAttribute("href")?.includes("/specialists/"));
      const croppedImages = [...document.querySelectorAll('a[aria-label^="Открыть профиль:"] img')];
      return {
        profileHref: profileLinks[0]?.getAttribute("href") || "",
        specialistLinks: profileLinks.length,
        mainSections: document.querySelectorAll("main > section").length,
        hasExtraHomeCards: Boolean(document.querySelector(".public-specialist-card")),
        headerVerificationLink: Boolean(document.querySelector('header a[href="/verification"]')),
        forbiddenCopy: document.body.textContent.includes("Честные границы проверки") || document.querySelector("main")?.textContent.includes("Как мы отбираем"),
        trustMark: [...document.querySelectorAll("span")].some((element) => element.textContent.trim() === "Проверено AILVI"),
        footerLinks: [...document.querySelectorAll(".civic-footer nav a")].map((link) => link.textContent.trim()),
        footerHasOldCaption: document.querySelector(".civic-footer")?.textContent.includes("Каталог рекомендованных специалистов") || false,
        imageReady: croppedImages.some((image) => image.complete && image.naturalWidth > 0),
        avatarCropApplied: croppedImages.some((image) => image.style.objectPosition && image.style.transform),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
      };
    })()`);
    assert.ok(home.profileHref.startsWith(specialistPathPrefix));
    assert.ok(home.specialistLinks >= 1);
    assert.equal(home.mainSections, 1);
    assert.equal(home.hasExtraHomeCards, false);
    assert.equal(home.headerVerificationLink, false);
    assert.equal(home.forbiddenCopy, false);
    assert.equal(home.trustMark, true);
    assert.deepEqual(home.footerLinks, ["Правила", "Контакты"]);
    assert.equal(home.footerHasOldCaption, false);
    assert.equal(home.imageReady, true);
    assert.equal(home.avatarCropApplied, true);
    assert.ok(home.scrollWidth <= home.innerWidth);

    await open(previewUrl("/rules/"), viewport.width, viewport.height, viewport.mobile);
    const rules = await evaluate(`(() => ({ heading: document.querySelector("h1")?.textContent.trim() || "", footerLinks: [...document.querySelectorAll(".civic-footer nav a")].map((link) => link.textContent.trim()), scrollWidth: document.documentElement.scrollWidth, innerWidth }))()`);
    assert.ok(rules.heading.length > 0);
    assert.deepEqual(rules.footerLinks, ["Правила", "Контакты"]);
    assert.ok(rules.scrollWidth <= rules.innerWidth);

    await open(previewUrl("/contacts/"), viewport.width, viewport.height, viewport.mobile);
    const contactsPage = await evaluate(`(() => ({ heading: document.querySelector("h1")?.textContent.trim() || "", email: document.querySelector('.owner-contacts a[href^="mailto:"]')?.textContent.trim() || "", visibleContactLinks: document.querySelectorAll(".owner-contacts a").length, scrollWidth: document.documentElement.scrollWidth, innerWidth }))()`);
    assert.equal(contactsPage.heading, "Контакты");
    assert.ok(contactsPage.email.includes("al-amin@ailvi.ru"));
    assert.equal(contactsPage.visibleContactLinks, 1);
    assert.ok(contactsPage.scrollWidth <= contactsPage.innerWidth);

    await open(previewUrl("/specialists/"), viewport.width, viewport.height, viewport.mobile);
    await waitFor(() => evaluate('Boolean(document.querySelector(".public-specialist-photo img")?.complete && document.querySelector(".public-specialist-photo img")?.naturalWidth)'), "Catalog specialist image did not load.");
    const catalog = await evaluate(`(() => {
      const card = document.querySelector(".public-specialist-card");
      const link = card?.querySelector('a[href*="/specialists/"]');
      const image = card?.querySelector(".public-specialist-photo img");
      const cardBox = card?.getBoundingClientRect();
      const linkBox = link?.getBoundingClientRect();
      return { href: link?.getAttribute("href") || "", cardClickable: Boolean(cardBox && linkBox && linkBox.width >= cardBox.width - 2 && linkBox.height >= cardBox.height - 2), trustMark: card?.querySelector(".public-trust-mark")?.textContent.trim() || "", imageReady: Boolean(image?.complete && image?.naturalWidth), avatarCropApplied: Boolean(image?.style.objectPosition && image?.style.transform), scrollWidth: document.documentElement.scrollWidth, innerWidth };
    })()`);
    assert.ok(catalog.href.startsWith(specialistPathPrefix));
    assert.equal(catalog.cardClickable, true);
    assert.equal(catalog.trustMark, "Проверено AILVI");
    assert.equal(catalog.imageReady, true);
    assert.equal(catalog.avatarCropApplied, true);
    assert.ok(catalog.scrollWidth <= catalog.innerWidth);

    await open(`${previewOrigin}${catalog.href.replace(/\/+$/u, "")}/`, viewport.width, viewport.height, viewport.mobile);
    await waitFor(() => evaluate('Boolean(document.querySelector("main section img")?.complete && document.querySelector("main section img")?.naturalWidth)'), "Profile image did not load.");
    const profile = await evaluate(`(() => {
      const text = document.body.textContent.replace(/\\s/gu, " ");
      const largeImage = document.querySelector("main section img");
      const style = largeImage ? getComputedStyle(largeImage) : null;
      const compactContacts = [...document.querySelectorAll(".direct-contacts.is-compact a")];
      const contactRailLinks = [...document.querySelectorAll(".direct-contacts:not(.is-compact) a")];
      const compactBoxes = compactContacts.map((link) => link.getBoundingClientRect());
      const compactStyles = compactContacts.map((link) => getComputedStyle(link));
      const hrefs = compactContacts.map((link) => link.getAttribute("href") || "");
      const offerDetails = document.querySelector("[data-work-offer-details]");
      const offerRow = offerDetails?.parentElement;
      const offerTitle = offerRow?.querySelector(":scope > strong");
      const offerPrice = offerDetails?.querySelector('[data-work-offer-part="price"]');
      const contactRail = document.querySelector(".direct-contacts:not(.is-compact)");
      const contactRailCard = contactRail?.closest("article");
      const contactRailBoxes = contactRailLinks.map((link) => link.getBoundingClientRect());
      const contactRailWidths = contactRailBoxes.map((box) => box.width);
      const contactRailStyles = contactRailLinks.map((link) => getComputedStyle(link));
      const compactReferenceStyle = compactContacts[0] ? getComputedStyle(compactContacts[0]) : null;
      return {
        contacts: text.includes("Контакты"),
        ruble: text.includes("₽"),
        localizedAmount: text.includes("5 000 ₽"),
        rawRub: /\\d+\\s+RUB/u.test(text),
        experienceHeading: text.includes("15 лет профессиональной практики"),
        experienceDeclared: text.includes("Опыт указан специалистом."),
        experienceTechnicalLabel: text.includes("Сведения специалиста"),
        experienceVerificationClaim: text.includes("Сведения об опыте входят в зафиксированный объём проверки."),
        compactContactLabels: compactContacts.map((link) => link.textContent.trim()),
        compactContactsOutlined: compactStyles.every((entry) => entry.backgroundColor === "rgb(255, 255, 255)" && Number.parseFloat(entry.borderTopWidth) >= 1 && entry.color === "rgb(21, 81, 60)"),
        compactContactTargets: compactBoxes.every((box) => box.width >= 44 && box.height >= 44),
        compactContactsHaveNoValues: compactContacts.every((link) => !link.querySelector("small")),
        contactProtocols: {
          phone: hrefs.some((href) => href.startsWith("tel:")),
          telegram: hrefs.some((href) => href.startsWith("https://t.me/")),
          email: hrefs.some((href) => href.startsWith("mailto:")),
          website: hrefs.some((href) => href.startsWith("https://") && !href.startsWith("https://t.me/")),
        },
        contactRailIntact: contactRailLinks.length === compactContacts.length && contactRailLinks.every((link) => Boolean(link.querySelector("small"))),
        contactRailWidths,
        contactRailLeftAligned: contactRailBoxes.length > 0 && Math.max(...contactRailBoxes.map((box) => box.left)) - Math.min(...contactRailBoxes.map((box) => box.left)) <= 1,
        contactGeometryMatchesHero: Boolean(compactReferenceStyle) && contactRailStyles.every((entry) => entry.paddingLeft === compactReferenceStyle.paddingLeft && entry.paddingRight === compactReferenceStyle.paddingRight && entry.columnGap === compactReferenceStyle.columnGap),
        contactRailWidth: contactRail?.getBoundingClientRect().width || 0,
        contactRailCardWidth: contactRailCard?.getBoundingClientRect().width || 0,
        contactRailTargets: contactRailBoxes.every((box) => box.width >= 44 && box.height >= 44),
        contactRailNoOverflow: contactRailLinks.every((link) => link.scrollWidth <= link.clientWidth + 1 && getComputedStyle(link.querySelector("small")).textOverflow === "ellipsis"),
        compactContactRows: new Set(compactBoxes.map((box) => Math.round(box.top))).size,
        offerDetailsText: offerDetails?.getAttribute("aria-label")?.replace(/\\s/gu, " ").trim() || "",
        offerDetailsColor: offerDetails ? getComputedStyle(offerDetails).color : "",
        offerDetailsWeight: offerDetails ? Number.parseInt(getComputedStyle(offerDetails).fontWeight, 10) : 0,
        offerPriceWeight: offerPrice ? Number.parseInt(getComputedStyle(offerPrice).fontWeight, 10) : 0,
        offerTitleColor: offerTitle ? getComputedStyle(offerTitle).color : "",
        offerTitleWeight: offerTitle ? Number.parseInt(getComputedStyle(offerTitle).fontWeight, 10) : 0,
        imageReady: Boolean(largeImage?.complete && largeImage?.naturalWidth),
        largeObjectPosition: style?.objectPosition || "",
        largeTransform: style?.transform || "",
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
      };
    })()`);
    if (!profile.contacts || !profile.ruble || profile.rawRub || !profile.imageReady) {
      const currentUrl = await evaluate("location.href");
      process.stderr.write(JSON.stringify({ currentUrl, profile }) + "\n");
    }
    assert.equal(profile.contacts, true);
    assert.equal(profile.ruble, true);
    assert.equal(profile.localizedAmount, true);
    assert.equal(profile.rawRub, false);
    assert.equal(profile.experienceHeading, true);
    assert.equal(profile.experienceDeclared, true);
    assert.equal(profile.experienceTechnicalLabel, false);
    assert.equal(profile.experienceVerificationClaim, false);
    assert.deepEqual(profile.compactContactLabels, ["Позвонить", "Telegram", "Email", "Сайт"]);
    assert.equal(profile.compactContactsOutlined, true);
    assert.equal(profile.compactContactTargets, true);
    assert.equal(profile.compactContactsHaveNoValues, true);
    assert.deepEqual(profile.contactProtocols, { phone: true, telegram: true, email: true, website: true });
    assert.equal(profile.contactRailIntact, true);
    assert.equal(profile.contactRailLeftAligned, true);
    assert.equal(profile.contactGeometryMatchesHero, true);
    assert.equal(profile.contactRailTargets, true);
    assert.equal(profile.contactRailNoOverflow, true);
    if (!viewport.mobile) {
      assert.ok(profile.contactRailWidth <= 280);
      assert.ok(profile.contactRailWidth < profile.contactRailCardWidth - 16);
      assert.ok(profile.contactRailWidths.every((width) => width < profile.contactRailCardWidth - 32));
    }
    if (viewport.mobile) assert.ok(profile.compactContactRows >= 2);
    assert.equal(profile.offerDetailsText, "Онлайн · 60 мин. · 5 000 ₽");
    assert.equal(profile.offerDetailsColor, "rgb(21, 81, 60)");
    assert.ok(profile.offerDetailsWeight >= 600);
    assert.ok(profile.offerPriceWeight >= 700);
    assert.equal(profile.offerTitleColor, "rgb(23, 32, 28)");
    assert.ok(profile.offerTitleWeight >= 700);
    assert.equal(profile.imageReady, true);
    assert.equal(profile.largeObjectPosition, "50% 50%");
    assert.equal(profile.largeTransform, "none");
    assert.ok(profile.scrollWidth <= profile.innerWidth);
    if (viewport.name === "desktop") {
      await captureElement(".direct-contacts.is-compact", "public-profile-top-contacts.png", 22);
      await captureElement("[data-contact-rail-card]", "public-profile-sidebar-contacts.png", 22);
      const full = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true });
      await writeFile(path.join(output, "public-profile-1440.png"), Buffer.from(full.data, "base64"));
    }

    results[viewport.name] = { home, rules, contactsPage, catalog, profile };
  }
  process.stdout.write(JSON.stringify({ ok: true, ...results }) + "\n");
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browserProcess.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
}
