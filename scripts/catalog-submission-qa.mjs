import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { catalogSubmissionConsent } from "../src/lib/catalog-submission-contract.mjs";
import { createAlaminSubmissionPackage, safeAlaminFileName } from "../src/lib/alamin-submission-file.mjs";

const root = process.cwd();
const outputRoot = path.join(root, "outputs", "file-submission-workflow-2026-09-26");
await mkdir(outputRoot, { recursive: true });

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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Owner Editor QA server did not start.");
}

function payload(photo) {
  return {
    contractVersion: 1,
    fullName: "Лейла Тестова",
    specialization: "Консультант по профессиональному развитию",
    country: "Россия",
    city: "Казань",
    workMode: "both",
    experienceYears: 6,
    profileSummary: "Помогает выбрать следующий профессиональный шаг без спешки.",
    about: "Разбирает профессиональные переходы и помогает составить реалистичный план действий.",
    categories: ["Карьера", "Развитие"],
    helpTopics: [{ title: "Смена профессии", description: "Оценка вариантов и рисков." }, { title: "План развития", description: "Понятная последовательность шагов." }],
    workOffers: [
      { title: "Индивидуальная консультация", mode: "online", durationMinutes: 60, price: 5000, currency: "RUB" },
      { title: "Разбор ситуации", mode: "both", durationMinutes: null, price: null, currency: null },
    ],
    contacts: { email: "qa@example.invalid", telegram: "@alamin_qa" },
    portfolio: [{ title: "Пример методики", description: "Синтетический QA-материал.", url: "https://example.com/qa" }],
    profileCrop: { positionX: 0, positionY: 50, zoom: 5 },
    avatar: { positionX: 100, positionY: 50, zoom: 5 },
    photo: { originalName: "qa-portrait.png", contentType: "image/png", size: photo.length },
    consent: true,
    consentText: catalogSubmissionConsent,
  };
}

function packageBuffer(photo, id = randomUUID(), mutate = null) {
  const value = createAlaminSubmissionPackage({
    packageId: id,
    createdAt: new Date().toISOString(),
    payload: payload(photo),
    attachment: { filename: "qa-portrait.png", mediaType: "image/png", data: photo.toString("base64") },
  });
  if (mutate) mutate(value);
  return { id, value, buffer: Buffer.from(`${JSON.stringify(value)}\n`, "utf8") };
}

async function startEditor(temporary, options = {}) {
  await mkdir(temporary, { recursive: true });
  const port = await freePort();
  const catalogPath = path.join(temporary, "specialists.json");
  const sitePath = path.join(temporary, "site.json");
  const assetRoot = path.join(temporary, "public-images", "specialists");
  const submissionsRoot = path.join(temporary, "private-submissions");
  await writeFile(catalogPath, JSON.stringify({ version: 1, specialists: [] }), "utf8");
  await writeFile(sitePath, await readFile(new URL("../content/site.json", import.meta.url), "utf8"), "utf8");
  const child = spawn(process.execPath, [path.resolve("scripts/owner-editor.mjs")], {
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
      OWNER_EDITOR_SUBMISSIONS_ROOT: submissionsRoot,
      OWNER_EDITOR_SUBMISSIONS_PATH: path.join(submissionsRoot, "index.json"),
      OWNER_EDITOR_REVIEW_MEDIA_ROOT: path.join(temporary, "review-media"),
      OWNER_EDITOR_STAGING_ROOT: path.join(temporary, "staging"),
      OWNER_EDITOR_SKIP_PREVIEW_BUILD: options.buildFailure ? "0" : "1",
      OWNER_EDITOR_FORCE_BUILD_FAILURE: options.buildFailure ? "1" : "0",
      OWNER_EDITOR_QA_ALLOW_NO_ORIGIN: "1",
    },
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/submissions`);
  return { child, base, catalogPath, sitePath, assetRoot, submissionsRoot };
}

async function api(editor, pathname, options = {}) {
  return fetch(`${editor.base}${pathname}`, { ...options, headers: { Origin: editor.base, ...(options.headers || {}) } });
}

function approvalDraft(packageValue) {
  const source = packageValue.payload;
  return {
    fullName: "Лейла Тестова Проверена",
    specialization: source.specialization,
    country: source.country,
    city: source.city,
    workMode: source.workMode,
    experienceYears: source.experienceYears,
    profileSummary: "Отредактированное владельцем короткое описание.",
    about: source.about,
    categories: source.categories,
    helpTopics: source.helpTopics,
    workOffers: source.workOffers,
    contacts: source.contacts,
    portfolio: source.portfolio,
    photo: { src: "", alt: "Фото: Лейла Тестова Проверена", profileCrop: { positionX: 0, positionY: 50, zoom: 5 }, avatar: { positionX: 100, positionY: 50, zoom: 5 } },
    featured: false,
    published: true,
  };
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "al-amin-file-workflow-qa-"));
const editor = await startEditor(path.join(temporary, "success"));
let failureEditor = null;

try {
  // A synthetic portrait with a red left half and blue right half makes the baked avatar crop testable.
  const left = await sharp({ create: { width: 450, height: 900, channels: 3, background: { r: 230, g: 50, b: 50 } } }).png().toBuffer();
  const right = await sharp({ create: { width: 450, height: 900, channels: 3, background: { r: 35, g: 80, b: 225 } } }).png().toBuffer();
  const photo = await sharp({ create: { width: 900, height: 900, channels: 3, background: "white" } }).composite([{ input: left, left: 0, top: 0 }, { input: right, left: 450, top: 0 }]).png().toBuffer();
  const fixture = packageBuffer(photo, "6215426d-2cc4-4a2f-98b4-fec9a16ddf72");
  const fixturePath = path.join(outputRoot, safeAlaminFileName(fixture.value.payload.fullName));
  await writeFile(fixturePath, fixture.buffer);

  const imported = await api(editor, "/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: fixture.buffer });
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).id, fixture.id);
  const duplicate = await api(editor, "/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: fixture.buffer });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);

  const changed = packageBuffer(photo, fixture.id, (value) => { value.payload.about += " Изменено."; });
  assert.equal((await api(editor, "/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: changed.buffer })).status, 409);
  let inbox = await fetch(`${editor.base}/api/submissions`).then((response) => response.json());
  assert.equal(inbox.source, "local-file-import");
  assert.equal(inbox.submissions.length, 1);
  assert.deepEqual(inbox.submissions[0].payload.helpTopics, fixture.value.payload.helpTopics);
  assert.deepEqual(inbox.submissions[0].payload.workOffers, fixture.value.payload.workOffers);
  assert.equal(inbox.submissions[0].mediaBytes, photo.length);

  const invalidCases = [
    packageBuffer(photo, randomUUID(), (value) => { value.version = 99; }).buffer,
    packageBuffer(photo, randomUUID(), (value) => { value.attachments[0].filename = "../../escape.png"; }).buffer,
    packageBuffer(photo, randomUUID(), (value) => { value.payload.about = "<script>alert(1)</script>"; }).buffer,
    packageBuffer(photo, randomUUID(), (value) => { value.payload.published = true; }).buffer,
    packageBuffer(photo, randomUUID(), (value) => { value.payload.slug = "viktor-kuznetsov"; }).buffer,
  ];
  for (const invalid of invalidCases) assert.equal((await api(editor, "/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: invalid })).status, 422);
  assert.equal((await api(editor, "/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: Buffer.from("not json") })).status, 422);
  const fakeMime = packageBuffer(photo, randomUUID(), (value) => { value.attachments[0].mediaType = "image/jpeg"; value.payload.photo.contentType = "image/jpeg"; });
  assert.equal((await api(editor, "/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: fakeMime.buffer })).status, 422);
  const corrupt = packageBuffer(Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(100)]));
  assert.equal((await api(editor, "/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: corrupt.buffer })).status, 422);
  const tooLarge = Buffer.alloc(24 * 1024 * 1024 + 1, 0x20);
  assert.equal((await api(editor, "/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: tooLarge })).status, 413);

  const approve = await api(editor, `/api/submissions/${fixture.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approvalDraft(fixture.value)) });
  assert.equal(approve.status, 200);
  const approved = await approve.json();
  assert.equal(approved.status, "added");
  const catalog = JSON.parse(await readFile(editor.catalogPath, "utf8"));
  assert.equal(catalog.specialists.length, 1);
  const specialist = catalog.specialists[0];
  assert.equal(specialist.id, fixture.id);
  assert.equal(specialist.fullName, "Лейла Тестова Проверена");
  assert.equal(specialist.profileSummary, "Отредактированное владельцем короткое описание.");
  assert.equal(specialist.trust.recommendedByAlAmin, false);
  assert.deepEqual(specialist.trust.verifiedFacts, []);
  assert.match(specialist.photo.avatarSrc, /\/avatar\.webp$/u);
  const profilePath = path.join(editor.assetRoot, specialist.slug, "profile.webp");
  const avatarPath = path.join(editor.assetRoot, specialist.slug, "avatar.webp");
  const [profileMeta, avatarMeta] = await Promise.all([sharp(profilePath).metadata(), sharp(avatarPath).metadata()]);
  assert.ok(profileMeta.width <= 1200 && profileMeta.height <= 1440);
  assert.ok(avatarMeta.width <= 480 && avatarMeta.height <= 480 && avatarMeta.width === avatarMeta.height);
  assert.equal(profileMeta.exif, undefined);
  assert.equal(avatarMeta.exif, undefined);
  const [profilePixel, avatarPixel] = await Promise.all([
    sharp(profilePath).resize(1, 1).removeAlpha().raw().toBuffer(),
    sharp(avatarPath).resize(1, 1).removeAlpha().raw().toBuffer(),
  ]);
  assert.ok(profilePixel[0] > profilePixel[2], "The left/red side selected by profile crop must dominate the baked profile image.");
  assert.ok(avatarPixel[2] > avatarPixel[0], "The right/blue side selected by avatar crop must dominate the baked avatar.");
  assert.ok((await stat(avatarPath)).size < (await stat(profilePath)).size);
  const publicFiles = await readdir(path.join(editor.assetRoot, specialist.slug));
  assert.deepEqual(publicFiles.sort(), ["avatar.webp", "profile.webp"]);

  const approveAgain = await api(editor, `/api/submissions/${fixture.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approvalDraft(fixture.value)) });
  assert.equal(approveAgain.status, 200);
  assert.equal((await approveAgain.json()).idempotent, true);
  assert.equal(JSON.parse(await readFile(editor.catalogPath, "utf8")).specialists.length, 1);

  inbox = await fetch(`${editor.base}/api/submissions`).then((response) => response.json());
  assert.equal(inbox.submissions[0].status, "added");
  assert.equal(existsSync(path.join(editor.submissionsRoot, fixture.id, "source.png")), true);

  failureEditor = await startEditor(path.join(temporary, "failure"), { buildFailure: true });
  const failureFixture = packageBuffer(photo);
  assert.equal((await api(failureEditor, "/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: failureFixture.buffer })).status, 201);
  const failedApproval = await api(failureEditor, `/api/submissions/${failureFixture.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approvalDraft(failureFixture.value)) });
  assert.equal(failedApproval.status, 500);
  assert.equal(JSON.parse(await readFile(failureEditor.catalogPath, "utf8")).specialists.length, 0);
  const failedInbox = await fetch(`${failureEditor.base}/api/submissions`).then((response) => response.json());
  assert.equal(failedInbox.submissions[0].status, "new");
  assert.equal(existsSync(path.join(failureEditor.assetRoot, "leyla-testova-proverena")), false);

  const report = {
    ok: true,
    fixture: fixturePath,
    packageBytes: fixture.buffer.length,
    sourcePhotoBytes: photo.length,
    profileBytes: (await stat(profilePath)).size,
    avatarBytes: (await stat(avatarPath)).size,
    import: true,
    duplicateImportPrevented: true,
    conflictingPackagePrevented: true,
    unsafePackagesRejected: true,
    fakeMimeRejected: true,
    corruptImageRejected: true,
    oversizedPackageRejected: true,
    ownerEditPreserved: true,
    approvalIdempotent: true,
    buildFailureRolledBack: true,
    privateOriginalOutsidePublicAssets: true,
    productionCatalogTouched: false,
  };
  await writeFile(path.join(outputRoot, "QA-SUMMARY.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  editor.child.kill();
  failureEditor?.child.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (process.platform === "win32") process.exit(0);
  await rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

// Node's global fetch pool can keep this isolated QA process alive on Windows.
// All child servers and temporary data are already stopped/removed above.
process.exit(0);
