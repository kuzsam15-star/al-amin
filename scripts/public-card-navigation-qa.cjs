const { chromium } = require("C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const base = process.env.CIVIC_QA_BASE || "http://localhost:3000";
const victorId = "4f0b9d27-ea5c-4079-a18d-99c1e664116b";
const victorPath = "/specialists/profile-ff7e1f53";

async function openHome(page) {
  const currentPath = page.url().startsWith("http") ? new URL(page.url()).pathname : "";
  if (currentPath === "/") {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
  } else {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  }
  await page.locator('a[data-specialist-id]').first().waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(1500);
}

async function centerCard(page) {
  return page.locator('a[data-specialist-kind="real"][data-profile-url]:visible').filter({
    has: page.locator('[class*="cardName"]'),
  }).first();
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const errors = [];
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  desktop.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  desktop.on("pageerror", (error) => errors.push(error.message));

  await openHome(desktop);
  const initialReal = desktop.locator(`a[data-specialist-id="${victorId}"]`);
  const victorContract = await initialReal.evaluate((element) => ({
    href: element.getAttribute("href"),
    profileUrl: element.getAttribute("data-profile-url"),
    kind: element.getAttribute("data-specialist-kind"),
    label: element.getAttribute("aria-label"),
  }));

  await Promise.all([
    desktop.waitForURL((url) => url.pathname === victorPath, { waitUntil: "domcontentloaded", timeout: 15000 }),
    initialReal.click(),
  ]);
  const afterSimpleClickPath = new URL(desktop.url()).pathname;

  await openHome(desktop);
  const dragCard = desktop.locator(`a[data-specialist-id="${victorId}"]`);
  const box = await dragCard.boundingBox();
  if (!box) throw new Error("Victor center card is not visible");
  await desktop.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await desktop.mouse.down();
  await desktop.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 8 });
  await desktop.mouse.up();
  await desktop.waitForTimeout(500);
  const afterDragPath = new URL(desktop.url()).pathname;

  await openHome(desktop);
  const liveRegion = desktop.locator('[aria-live="polite"]');
  const beforeArrow = await liveRegion.textContent();
  await desktop.getByRole("button", { name: "Следующий специалист" }).click();
  await desktop.waitForTimeout(500);
  const afterNextArrow = await liveRegion.textContent();
  await desktop.getByRole("button", { name: "Предыдущий специалист" }).click();
  await desktop.waitForTimeout(500);
  const afterPreviousArrow = await liveRegion.textContent();

  const side = desktop.locator('a[data-specialist-kind="mock"][aria-hidden="false"][aria-label^="Показать в центре"]').first();
  const sideId = await side.getAttribute("data-specialist-id");
  const sideBox = await side.boundingBox();
  if (!sideBox) throw new Error("Desktop side card is not visible");
  const sideX = sideBox.x + sideBox.width / 2 < 720 ? sideBox.x + 12 : sideBox.x + sideBox.width - 12;
  await desktop.mouse.click(sideX, sideBox.y + sideBox.height / 2);
  await desktop.waitForTimeout(500);
  const afterSideClickPath = new URL(desktop.url()).pathname;
  const centeredMock = desktop.locator(`a[data-specialist-id="${sideId}"]`);
  const mockContract = await centeredMock.evaluate((element) => ({
    href: element.getAttribute("href"),
    profileUrl: element.getAttribute("data-profile-url"),
    kind: element.getAttribute("data-specialist-kind"),
    label: element.getAttribute("aria-label"),
  }));
  if (!mockContract.label?.startsWith("Открыть каталог")) {
    throw new Error(`Side card did not become center: ${JSON.stringify({ sideId, mockContract, errors })}`);
  }
  await Promise.all([
    desktop.waitForURL((url) => url.pathname === "/specialists", { waitUntil: "domcontentloaded", timeout: 15000 }),
    centeredMock.click(),
  ]);
  const mockDestination = new URL(desktop.url()).pathname;

  const catalogVictor = desktop.locator(`a.specialist-card-link[data-specialist-id="${victorId}"]`);
  const catalogContract = await catalogVictor.evaluate((element) => ({
    href: element.getAttribute("href"),
    profileUrl: element.getAttribute("data-profile-url"),
  }));
  await Promise.all([
    desktop.waitForURL((url) => url.pathname === victorPath, { waitUntil: "domcontentloaded", timeout: 15000 }),
    catalogVictor.click(),
  ]);
  const catalogDestination = new URL(desktop.url()).pathname;

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await openHome(mobile);
  const mobileSide = mobile.locator('a[data-specialist-kind="mock"][aria-hidden="false"][aria-label^="Показать в центре"]').first();
  const mobileSideId = await mobileSide.getAttribute("data-specialist-id");
  const mobileTapPoint = await mobileSide.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const left = Math.max(1, Math.ceil(rect.left));
    const right = Math.min(innerWidth - 2, Math.floor(rect.right));
    const top = Math.max(1, Math.ceil(rect.top));
    const bottom = Math.min(innerHeight - 2, Math.floor(rect.bottom));
    for (let y = top + 8; y < bottom; y += 8) {
      for (let x = left + 4; x < right; x += 4) {
        if (document.elementFromPoint(x, y)?.closest("a") === element) return { x, y };
      }
    }
    return null;
  });
  if (!mobileTapPoint) throw new Error("Mobile side card has no exposed tappable point");
  await mobile.touchscreen.tap(mobileTapPoint.x, mobileTapPoint.y);
  await mobile.waitForTimeout(500);
  const mobileSidePath = new URL(mobile.url()).pathname;
  const mobileCentered = mobile.locator(`a[data-specialist-id="${mobileSideId}"]`);
  const mobileCenteredVisible = await mobileCentered.getAttribute("aria-label").then((label) => label?.startsWith("Открыть каталог") ?? false);

  await openHome(mobile);
  const mobileReal = mobile.locator(`a[data-specialist-id="${victorId}"]`);
  const mobileBox = await mobileReal.boundingBox();
  if (!mobileBox) throw new Error("Mobile Victor card is not visible");
  await mobile.evaluate(({ x, y, width }) => {
    const target = document.elementFromPoint(x, y);
    if (!target) throw new Error("No swipe target");
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x + width * 0.25, clientY: y }));
    target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x - width * 0.25, clientY: y }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x - width * 0.25, clientY: y }));
  }, { x: mobileBox.x + mobileBox.width / 2, y: mobileBox.y + mobileBox.height / 2, width: mobileBox.width });
  await mobile.waitForTimeout(500);
  const afterSwipePath = new URL(mobile.url()).pathname;

  await browser.close();
  const report = {
    base,
    victorContract,
    afterDragPath,
    afterSimpleClickPath,
    beforeArrow,
    afterNextArrow,
    afterPreviousArrow,
    sideId,
    afterSideClickPath,
    mockContract,
    mockDestination,
    catalogContract,
    catalogDestination,
    mobileSideId,
    mobileSidePath,
    mobileCenteredVisible,
    afterSwipePath,
    errors,
  };
  console.log(JSON.stringify(report, null, 2));

  if (victorContract.href !== victorPath || victorContract.profileUrl !== victorPath || afterSimpleClickPath !== victorPath) process.exitCode = 1;
  if (afterDragPath !== "/" || afterSideClickPath !== "/") process.exitCode = 1;
  if (afterNextArrow === beforeArrow || afterPreviousArrow !== beforeArrow) process.exitCode = 1;
  if (mockContract.profileUrl !== null || mockDestination !== "/specialists") process.exitCode = 1;
  if (catalogContract.profileUrl !== victorPath || catalogDestination !== victorPath) process.exitCode = 1;
  if (mobileSidePath !== "/" || !mobileCenteredVisible || afterSwipePath !== "/") process.exitCode = 1;
  if (errors.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
