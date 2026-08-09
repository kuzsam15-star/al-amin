const { chromium } = require("C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fs = require("node:fs/promises");
const path = require("node:path");

const base = process.env.CIVIC_QA_BASE || "http://192.168.10.155:3000";
const outputDir = path.resolve(process.cwd(), "outputs");

const screenshots = [
  { path: "/", name: "civic-home-desktop-1440.png", width: 1440, height: 1000 },
  { path: "/", name: "civic-home-tablet-1024.png", width: 1024, height: 900 },
  { path: "/", name: "civic-home-mobile-390.png", width: 390, height: 844 },
  { path: "/", name: "civic-home-mobile-375.png", width: 375, height: 812 },
  { path: "/specialists", name: "civic-catalog-desktop.png", width: 1440, height: 1000 },
  { path: "/specialists", name: "civic-catalog-mobile-390.png", width: 390, height: 844 },
  { path: "/specialists/profile-ff7e1f53", name: "civic-profile-desktop.png", width: 1440, height: 1000 },
  { path: "/specialists/profile-ff7e1f53", name: "civic-profile-mobile-390.png", width: 390, height: 844 },
  { path: "/login", name: "civic-auth-desktop.png", width: 1440, height: 1000 },
  { path: "/apply", name: "civic-apply-auth-guard.png", width: 1024, height: 900 },
  { path: "/cabinet", name: "civic-cabinet-auth-guard.png", width: 1024, height: 900 },
  { path: "/admin", name: "civic-admin-auth-guard.png", width: 1024, height: 900 },
  { path: "/verification", name: "civic-verification-desktop.png", width: 1024, height: 900 },
];

async function openCivic(page, target = "/") {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(500);
  if (target !== "/") {
    await page.goto(`${base}${target}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(500);
  }
}

(async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const failures = [];
  const consoleErrors = [];
  const results = [];

  for (const shot of process.env.CIVIC_QA_SHOTS === "0" ? [] : screenshots) {
    process.stdout.write(`screenshot ${shot.path} ${shot.width}x${shot.height}\n`);
    const context = await browser.newContext({ viewport: { width: shot.width, height: shot.height } });
    const page = await context.newPage();
    page.on("requestfailed", (request) => failures.push({ page: shot.path, url: request.url(), error: request.failure()?.errorText }));
    page.on("response", (response) => {
      if (response.status() >= 400) failures.push({ page: shot.path, url: response.url(), status: response.status() });
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push({ page: shot.path, text: message.text() });
    });
    page.on("pageerror", (error) => consoleErrors.push({ page: shot.path, text: error.message }));

    await openCivic(page, shot.path);
    if (shot.path.startsWith("/specialists/") && !shot.path.endsWith("/specialists")) {
      await page.evaluate(async () => {
        const step = Math.max(320, Math.floor(window.innerHeight * 0.7));
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 45));
        }
        window.scrollTo(0, 0);
      });
      await page.locator(".gallery-grid img").evaluateAll(async (images) => {
        await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
      });
      await page.waitForTimeout(500);
    }
    const metrics = await page.evaluate(() => ({
      pathname: location.pathname,
      search: location.search,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      civic: Boolean(document.querySelector(".civic-preview-mode")),
      civicHeaders: document.querySelectorAll(".civic-header").length,
      legacyHeaders: document.querySelectorAll(".site-header").length,
    }));
    await page.screenshot({ path: path.join(outputDir, shot.name), fullPage: true });
    results.push({ ...shot, ...metrics, overflow: metrics.scrollWidth > metrics.clientWidth });
    await context.close();
  }

  const interactionContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const interactionPage = await interactionContext.newPage();
  interactionPage.setDefaultTimeout(8000);
  process.stdout.write("interactions desktop\n");
  await openCivic(interactionPage);
  const liveRegion = interactionPage.locator('[aria-live="polite"]');
  const centerBefore = await liveRegion.textContent();
  await interactionPage.getByRole("button", { name: "Следующий специалист" }).click();
  await interactionPage.waitForTimeout(220);
  const centerAfterNext = await liveRegion.textContent();
  const carousel = interactionPage.getByRole("region", { name: "Проверенные специалисты" });
  await carousel.focus();
  await interactionPage.keyboard.press("ArrowLeft");
  await interactionPage.waitForTimeout(220);
  const centerAfterKeyboard = await liveRegion.textContent();
  const box = await carousel.boundingBox();
  if (box) {
    await interactionPage.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.45);
    await interactionPage.mouse.down();
    await interactionPage.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45, { steps: 8 });
    await interactionPage.mouse.up();
    await interactionPage.waitForTimeout(220);
  }
  const centerAfterDrag = await liveRegion.textContent();

  await interactionPage.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await interactionPage.waitForTimeout(500);
  const centerProfileCard = interactionPage.locator('a[href^="/specialists/"]').first();
  await Promise.all([
    interactionPage.waitForURL(/\/specialists\//, { timeout: 8000 }),
    centerProfileCard.click(),
  ]);
  const centerProfilePath = new URL(interactionPage.url()).pathname;
  const centerProfileCivic = await interactionPage.locator(".civic-preview-mode").count();

  await interactionPage.goto(`${base}/specialists`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await interactionPage.waitForTimeout(500);
  const catalogCivic = await interactionPage.locator(".civic-preview-mode").count();
  const firstProfileHref = await interactionPage.locator('a[href^="/specialists/"]').first().getAttribute("href");
  if (firstProfileHref) {
    await interactionPage.goto(`${base}${firstProfileHref}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await interactionPage.waitForTimeout(500);
  }
  const profileCivic = await interactionPage.locator(".civic-preview-mode").count();
  await interactionContext.close();

  const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const mobilePage = await mobileContext.newPage();
  mobilePage.setDefaultTimeout(8000);
  process.stdout.write("interactions mobile\n");
  await openCivic(mobilePage, "/specialists");
  const mobileMetrics = await mobilePage.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  const mobileMenuButton = mobilePage.locator(".civic-menu-button");
  await mobileMenuButton.click();
  const menuExpanded = await mobileMenuButton.getAttribute("aria-expanded");
  await mobilePage.keyboard.press("Escape");
  const menuClosed = await mobileMenuButton.getAttribute("aria-expanded");
  await mobilePage.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await mobilePage.waitForTimeout(500);
  const mobileCarousel = mobilePage.getByRole("region", { name: "Проверенные специалисты" });
  const mobileLive = mobilePage.locator('[aria-live="polite"]');
  const mobileBefore = await mobileLive.textContent();
  const mobileBox = await mobileCarousel.boundingBox();
  if (mobileBox) {
    await mobilePage.touchscreen.tap(mobileBox.x + mobileBox.width / 2, mobileBox.y + mobileBox.height / 2);
    await mobilePage.evaluate(({ x, y, width }) => {
      const target = document.elementFromPoint(x, y);
      if (!target) return;
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "touch", clientX: x + width * 0.25, clientY: y }));
      target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "touch", clientX: x - width * 0.25, clientY: y }));
      target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "touch", clientX: x - width * 0.25, clientY: y }));
    }, { x: mobileBox.x + mobileBox.width / 2, y: mobileBox.y + mobileBox.height / 2, width: mobileBox.width });
    await mobilePage.waitForTimeout(220);
  }
  const mobileAfter = await mobileLive.textContent();
  await mobileContext.close();

  await browser.close();
  const report = {
    base,
    screenshots: results,
    interactions: {
      centerBefore,
      centerAfterNext,
      centerAfterKeyboard,
      centerAfterDrag,
      centerProfilePath,
      centerProfileCivic: Boolean(centerProfileCivic),
      catalogCivic: Boolean(catalogCivic),
      profileCivic: Boolean(profileCivic),
      firstProfileHref,
      mobileMenuExpanded: menuExpanded,
      mobileMenuClosed: menuClosed,
      mobileBefore,
      mobileAfter,
      mobileOverflow: mobileMetrics.scrollWidth > mobileMetrics.clientWidth,
    },
    failures,
    consoleErrors,
  };
  await fs.writeFile(path.join(outputDir, "civic-preview-qa-report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
