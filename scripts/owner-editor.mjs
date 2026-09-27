import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { validateContent, validateSiteDocument, validateSpecialistsDocument } from "../src/lib/static-content-contract.mjs";
import { catalogSubmissionToSpecialistDraft } from "../src/lib/catalog-submission-contract.mjs";
import { alaminSubmissionFileLimits, validateAlaminSubmissionPackage } from "../src/lib/alamin-submission-file.mjs";
import { defaultAvatarCrop, defaultProfileCrop, photoCropExtractRect } from "../src/lib/photo-crop.mjs";

const root = process.cwd();
const host = "127.0.0.1";
const port = Number(process.env.OWNER_EDITOR_PORT ?? 4173);
const previewUrl = process.env.STATIC_PREVIEW_URL ?? "http://127.0.0.1:4174/";
const publicSiteUrl = process.env.OWNER_EDITOR_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000/";
const catalogPath = process.env.OWNER_EDITOR_CATALOG_PATH ? path.resolve(process.env.OWNER_EDITOR_CATALOG_PATH) : path.join(root, "content", "specialists.json");
const sitePath = process.env.OWNER_EDITOR_SITE_PATH ? path.resolve(process.env.OWNER_EDITOR_SITE_PATH) : path.join(root, "content", "site.json");
const categoryRegistryPath = path.join(root, "content", "category-registry.json");
const uiRoot = path.join(root, "tools", "owner-editor");
const assetRoot = process.env.OWNER_EDITOR_ASSET_ROOT ? path.resolve(process.env.OWNER_EDITOR_ASSET_ROOT) : path.join(root, "public", "images", "specialists");
const backupRoot = process.env.OWNER_EDITOR_BACKUP_ROOT ? path.resolve(process.env.OWNER_EDITOR_BACKUP_ROOT) : path.join(root, ".local-editor", "backups");
const submissionsRoot = process.env.OWNER_EDITOR_SUBMISSIONS_ROOT ? path.resolve(process.env.OWNER_EDITOR_SUBMISSIONS_ROOT) : path.join(root, ".local-editor", "submissions");
const localInboxPath = process.env.OWNER_EDITOR_SUBMISSIONS_PATH ? path.resolve(process.env.OWNER_EDITOR_SUBMISSIONS_PATH) : path.join(submissionsRoot, "index.json");
const reviewMediaRoot = process.env.OWNER_EDITOR_REVIEW_MEDIA_ROOT ? path.resolve(process.env.OWNER_EDITOR_REVIEW_MEDIA_ROOT) : path.join(root, ".local-editor", "review-media");
const stagingRoot = process.env.OWNER_EDITOR_STAGING_ROOT ? path.resolve(process.env.OWNER_EDITOR_STAGING_ROOT) : path.join(root, ".local-editor", "staging");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
let buildInFlight = null;
let writeQueue = Promise.resolve();

const transliteration = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function serializeWrite(task) {
  const result = writeQueue.then(task, task);
  writeQueue = result.catch(() => {});
  return result;
}

function runStaticBuild() {
  if (process.env.OWNER_EDITOR_FORCE_BUILD_FAILURE === "1") return Promise.reject(new Error("Тестовая ошибка сборки."));
  if (process.env.OWNER_EDITOR_SKIP_PREVIEW_BUILD === "1") return Promise.resolve();
  if (buildInFlight) return buildInFlight;
  buildInFlight = new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe") : "pnpm";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm.cmd build"] : ["build"];
    const child = spawn(command, args, { cwd: root, env: process.env, windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Не удалось собрать локальный сайт.")));
  }).finally(() => { buildInFlight = null; });
  return buildInFlight;
}

async function body(request, limit) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw Object.assign(new Error("Файл или запрос слишком большой."), { statusCode: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Файл или запрос слишком большой."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}

function assertLocalRequest(request, { write = false } = {}) {
  const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!expectedHosts.has(String(request.headers.host ?? "").toLocaleLowerCase("en"))) throw Object.assign(new Error("Owner Editor доступен только через локальный адрес."), { statusCode: 403 });
  if (!write) return;
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const origin = String(request.headers.origin ?? "");
  if (!allowedOrigins.has(origin) && process.env.OWNER_EDITOR_QA_ALLOW_NO_ORIGIN !== "1") throw Object.assign(new Error("Операция отклонена: неверный источник запроса."), { statusCode: 403 });
}

function slugify(input) {
  const transliterated = [...String(input).toLocaleLowerCase("ru")].map((letter) => transliteration[letter] ?? letter).join("");
  return transliterated.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 70);
}

function uniqueCatalogSlug(name, id, catalog) {
  const fallback = `specialist-${String(id).replace(/[^a-z0-9]/giu, "").slice(0, 8).toLocaleLowerCase()}`;
  const base = slugify(name) || fallback;
  const existing = catalog.specialists.find((item) => item.id === id);
  if (existing?.slug) return existing.slug;
  const used = new Set(catalog.specialists.map((item) => item.slug));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function photoKind(buffer) {
  if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg", format: "jpeg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { contentType: "image/png", extension: "png", format: "png" };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { contentType: "image/webp", extension: "webp", format: "webp" };
  return null;
}

async function validateImage(buffer, claimedType = null) {
  const kind = photoKind(buffer);
  if (!kind || (claimedType && kind.contentType !== claimedType)) throw Object.assign(new Error("Формат фотографии не соответствует содержимому. Разрешены JPEG, PNG и WebP."), { statusCode: 422 });
  let metadata;
  try { metadata = await sharp(buffer, { failOn: "error", limitInputPixels: alaminSubmissionFileLimits.imagePixels, animated: true }).metadata(); }
  catch { throw Object.assign(new Error("Фотография повреждена или превышает допустимое разрешение."), { statusCode: 422 }); }
  if (metadata.format !== kind.format || !metadata.width || !metadata.height) throw Object.assign(new Error("Не удалось декодировать фотографию."), { statusCode: 422 });
  if (metadata.width * metadata.height > alaminSubmissionFileLimits.imagePixels) throw Object.assign(new Error("Фотография содержит слишком много пикселей."), { statusCode: 422 });
  if ((metadata.pages ?? 1) > 1) throw Object.assign(new Error("Анимированные изображения не поддерживаются."), { statusCode: 422 });
  return { kind, metadata };
}

async function readLocalInbox() {
  try {
    const parsed = JSON.parse(await readFile(localInboxPath, "utf8"));
    return parsed?.version === 1 && Array.isArray(parsed.submissions) ? parsed : { version: 1, submissions: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, submissions: [] };
    throw error;
  }
}

async function saveLocalInbox(value) {
  await mkdir(path.dirname(localInboxPath), { recursive: true });
  const temporary = `${localInboxPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, localInboxPath);
}

function safeSubmissionDirectory(id) {
  if (!/^[0-9a-f-]{36}$/iu.test(id)) throw new Error("Некорректный идентификатор заявки.");
  return path.join(submissionsRoot, id.toLocaleLowerCase("en"));
}

function publicSubmission(row) {
  return { ...row, photoPreviewUrl: `/api/submissions/${row.id}/photo` };
}

async function listSubmissions() {
  const store = await readLocalInbox();
  return store.submissions.map(publicSubmission).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function getSubmission(id) {
  return (await readLocalInbox()).submissions.find((row) => row.id === id) ?? null;
}

async function readSubmissionMedia(submission) {
  const filename = String(submission.mediaFile ?? "");
  if (!/^source\.(?:jpg|png|webp)$/u.test(filename)) throw new Error("Локальный исходник заявки не найден.");
  return readFile(path.join(safeSubmissionDirectory(submission.id), filename));
}

async function setSubmissionStatus(id, status, extra = {}) {
  const store = await readLocalInbox();
  const row = store.submissions.find((entry) => entry.id === id);
  if (!row) throw new Error("Заявка не найдена.");
  Object.assign(row, extra, { status, reviewedAt: new Date().toISOString() });
  await saveLocalInbox(store);
  return row;
}

async function importSubmission(request) {
  const raw = await body(request, alaminSubmissionFileLimits.packageBytes);
  let parsed;
  try { parsed = JSON.parse(raw.toString("utf8")); }
  catch { throw Object.assign(new Error("Не удалось прочитать файл заявки. Выберите исходный .alamin или .alamin.json файл."), { statusCode: 422 }); }
  const validation = validateAlaminSubmissionPackage(parsed);
  if (validation.errors.length) throw Object.assign(new Error(validation.errors[0]), { statusCode: 422, errors: validation.errors });
  const media = Buffer.from(validation.data.attachment.data, "base64");
  const { kind } = await validateImage(media, validation.data.attachment.mediaType);
  const checksum = createHash("sha256").update(raw).digest("hex");
  const store = await readLocalInbox();
  const existing = store.submissions.find((row) => row.id === validation.data.packageId);
  if (existing) {
    if (existing.checksum === checksum) return { statusCode: 200, value: { ok: true, duplicate: true, id: existing.id, status: existing.status, message: "Эта заявка уже импортирована. Открываем существующую запись." } };
    throw Object.assign(new Error("Заявка с таким идентификатором уже импортирована, но содержимое файла отличается. Существующая запись не изменена."), { statusCode: 409 });
  }
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (catalog.specialists.some((item) => item.id === validation.data.packageId)) throw Object.assign(new Error("Идентификатор файла совпадает с уже существующим профилем. Импорт остановлен."), { statusCode: 409 });
  const directory = safeSubmissionDirectory(validation.data.packageId);
  const temporary = `${directory}.${randomUUID()}.tmp`;
  await mkdir(temporary, { recursive: true });
  const mediaFile = `source.${kind.extension}`;
  try {
    await writeFile(path.join(temporary, mediaFile), media);
    await rename(temporary, directory);
    const row = { id: validation.data.packageId, status: "new", createdAt: validation.data.createdAt, importedAt: new Date().toISOString(), reviewedAt: null, payload: validation.data.payload, consent: validation.data.consent, checksum, packageBytes: raw.length, mediaFile, mediaBytes: media.length };
    store.submissions.push(row);
    await saveLocalInbox(store);
    return { statusCode: 201, value: { ok: true, duplicate: false, id: row.id, status: row.status, message: "Заявка импортирована и сохранена только на этом компьютере." } };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function atomicSave(file, value, label) {
  await mkdir(backupRoot, { recursive: true });
  const current = await readFile(file, "utf8");
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  await writeFile(path.join(backupRoot, `${stamp}-${label}.json`), current, "utf8");
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function optimizedWebp(input, { width, height, fit, position, qualities, targetBytes }) {
  let output = null;
  let qualityUsed = qualities[qualities.length - 1];
  for (const quality of qualities) {
    output = await sharp(input).resize({ width, height, fit, position, withoutEnlargement: true }).webp({ quality, effort: 5 }).toBuffer();
    qualityUsed = quality;
    if (output.length <= targetBytes) break;
  }
  return { buffer: output, quality: qualityUsed, overBudget: output.length > targetBytes };
}

async function createPublicImages(source, profileCrop, avatarCrop) {
  await validateImage(source);
  const normalized = await sharp(source, { failOn: "error", limitInputPixels: alaminSubmissionFileLimits.imagePixels }).rotate().toBuffer({ resolveWithObject: true });
  const width = normalized.info.width;
  const height = normalized.info.height;
  const profileRect = photoCropExtractRect(width, height, 5 / 6, profileCrop || defaultProfileCrop);
  const avatarRect = photoCropExtractRect(width, height, 1, avatarCrop || defaultAvatarCrop);
  const profileSource = await sharp(normalized.data).extract(profileRect).toBuffer();
  const avatarSource = await sharp(normalized.data).extract(avatarRect).toBuffer();
  const profile = await optimizedWebp(profileSource, { width: 1200, height: 1440, fit: "fill", position: "centre", qualities: [82, 78, 74], targetBytes: 350 * 1024 });
  const avatar = await optimizedWebp(avatarSource, { width: 480, height: 480, fit: "fill", position: "centre", qualities: [80, 76, 72], targetBytes: 100 * 1024 });
  return { profile, avatar };
}

async function reviewPhotoBuffer(token) {
  if (!token) return null;
  if (!/^[0-9a-f-]{36}$/iu.test(token)) throw new Error("Некорректный идентификатор фотографии.");
  for (const extension of ["jpg", "png", "webp"]) {
    try { return await readFile(path.join(reviewMediaRoot, `${token}.${extension}`)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  throw new Error("Не удалось найти выбранную владельцем фотографию.");
}

async function approveSubmission(id, request) {
  const ownerDraft = JSON.parse((await body(request, 2 * 1024 * 1024)).toString("utf8"));
  const submission = await getSubmission(id);
  if (!submission) throw Object.assign(new Error("Заявка не найдена."), { statusCode: 404 });
  if (submission.status === "rejected") throw Object.assign(new Error("Отклонённую заявку нельзя добавить без нового импорта."), { statusCode: 409 });
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const existing = catalog.specialists.find((item) => item.id === id);
  if (submission.status === "added" || existing) {
    if (existing && submission.status !== "added") await setSubmissionStatus(id, "added", { specialistSlug: existing.slug });
    if (!existing) throw Object.assign(new Error("Заявка отмечена как добавленная, но профиль не найден. Проверьте резервную копию каталога."), { statusCode: 409 });
    const profileUrl = new URL(`specialists/${encodeURIComponent(existing.slug)}/`, publicSiteUrl).href;
    return { ok: true, idempotent: true, status: "added", specialistId: id, slug: existing.slug, profileUrl };
  }
  const draft = { ...catalogSubmissionToSpecialistDraft(submission), ...ownerDraft };
  const slug = uniqueCatalogSlug(draft.fullName, id, catalog);
  const directory = path.join(assetRoot, slug);
  try { await access(directory); throw Object.assign(new Error("Папка для нового профиля уже существует. Каталог не изменён."), { statusCode: 409 }); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const profileCrop = draft.photo?.profileCrop || submission.payload.profileCrop || defaultProfileCrop;
  const avatarCrop = draft.photo?.avatar || submission.payload.avatar || defaultAvatarCrop;
  const specialist = { ...draft, id, slug, photo: { src: `/images/specialists/${slug}/profile.webp`, avatarSrc: `/images/specialists/${slug}/avatar.webp`, alt: draft.photo?.alt || `Фото: ${draft.fullName}`, avatar: avatarCrop }, trust: { recommendedByAlAmin: false, verifiedFacts: [] }, published: true, featured: draft.featured === true, sortOrder: 0 };
  const candidateCatalog = { ...catalog, specialists: [...catalog.specialists, specialist] };
  candidateCatalog.specialists.sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
  candidateCatalog.specialists.forEach((entry) => { entry.sortOrder = 0; });
  const catalogResult = validateSpecialistsDocument(candidateCatalog);
  if (catalogResult.errors.length) throw Object.assign(new Error(catalogResult.errors[0]), { statusCode: 422, errors: catalogResult.errors });
  const site = JSON.parse(await readFile(sitePath, "utf8"));
  const fullResult = validateContent(site, catalogResult.data);
  if (fullResult.errors.length) throw Object.assign(new Error(fullResult.errors[0]), { statusCode: 422, errors: fullResult.errors });
  let source = await readSubmissionMedia(submission);
  const replacement = await reviewPhotoBuffer(ownerDraft.reviewPhotoToken);
  if (replacement) source = replacement;
  const images = await createPublicImages(source, profileCrop, avatarCrop);
  const stageDirectory = path.join(stagingRoot, `${id}-${randomUUID()}`);
  await mkdir(stageDirectory, { recursive: true });
  await writeFile(path.join(stageDirectory, "profile.webp"), images.profile.buffer);
  await writeFile(path.join(stageDirectory, "avatar.webp"), images.avatar.buffer);
  const previousCatalog = await readFile(catalogPath, "utf8");
  let publicDirectoryCreated = false;
  let catalogWritten = false;
  try {
    await mkdir(assetRoot, { recursive: true });
    await rename(stageDirectory, directory);
    publicDirectoryCreated = true;
    await atomicSave(catalogPath, catalogResult.data, "specialists");
    catalogWritten = true;
    await runStaticBuild();
    await setSubmissionStatus(id, "added", { specialistSlug: slug, output: { profileBytes: images.profile.buffer.length, avatarBytes: images.avatar.buffer.length, profileQuality: images.profile.quality, avatarQuality: images.avatar.quality, overBudget: images.profile.overBudget || images.avatar.overBudget } });
  } catch (error) {
    if (catalogWritten) {
      const temporary = `${catalogPath}.${randomUUID()}.rollback.tmp`;
      await writeFile(temporary, previousCatalog, "utf8");
      await rename(temporary, catalogPath);
    }
    if (publicDirectoryCreated) await rm(directory, { recursive: true, force: true });
    await rm(stageDirectory, { recursive: true, force: true });
    throw error;
  }
  const profileUrl = new URL(`specialists/${encodeURIComponent(slug)}/`, publicSiteUrl).href;
  return { ok: true, status: "added", specialistId: id, slug, profileUrl, staticPreviewUrl: new URL(`specialists/${encodeURIComponent(slug)}/`, previewUrl).href, imageOutput: { profileBytes: images.profile.buffer.length, avatarBytes: images.avatar.buffer.length, warning: images.profile.overBudget || images.avatar.overBudget ? "Одно из изображений превышает ориентировочный бюджет размера." : "" } };
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}`);
    assertLocalRequest(request, { write: ["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "GET") });
    if (url.pathname === "/api/submissions/import" && request.method === "POST") {
      const result = await serializeWrite(() => importSubmission(request));
      return json(response, result.statusCode, result.value);
    }
    if (url.pathname === "/api/submissions" && request.method === "GET") return json(response, 200, { source: "local-file-import", submissions: await listSubmissions() });
    const submissionPhotoMatch = url.pathname.match(/^\/api\/submissions\/([0-9a-f-]{36})\/photo$/iu);
    if (submissionPhotoMatch && request.method === "GET") {
      const submission = await getSubmission(submissionPhotoMatch[1]);
      if (!submission) return json(response, 404, { errors: ["Заявка не найдена."] });
      const media = await readSubmissionMedia(submission);
      const { kind } = await validateImage(media);
      response.writeHead(200, { "Content-Type": kind.contentType, "Content-Length": media.length, "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" });
      return response.end(media);
    }
    const submissionRejectMatch = url.pathname.match(/^\/api\/submissions\/([0-9a-f-]{36})\/reject$/iu);
    if (submissionRejectMatch && request.method === "POST") {
      const result = await serializeWrite(async () => {
        const submission = await getSubmission(submissionRejectMatch[1]);
        if (!submission) throw Object.assign(new Error("Заявка не найдена."), { statusCode: 404 });
        if (submission.status === "added") throw Object.assign(new Error("Добавленную в каталог заявку нельзя отклонить."), { statusCode: 409 });
        await setSubmissionStatus(submission.id, "rejected");
        return { ok: true, status: "rejected" };
      });
      return json(response, 200, result);
    }
    const submissionReplacementPhotoMatch = url.pathname.match(/^\/api\/submissions\/([0-9a-f-]{36})\/replacement-photo$/iu);
    if (submissionReplacementPhotoMatch && request.method === "POST") {
      const result = await serializeWrite(async () => {
        const submission = await getSubmission(submissionReplacementPhotoMatch[1]);
        if (!submission || submission.status !== "new") throw Object.assign(new Error("Изменять фотографию можно только у новой заявки."), { statusCode: 409 });
        const input = await body(request, 8 * 1024 * 1024);
        const { kind } = await validateImage(input);
        await mkdir(reviewMediaRoot, { recursive: true });
        const token = randomUUID();
        await writeFile(path.join(reviewMediaRoot, `${token}.${kind.extension}`), input);
        return { ok: true, token, previewUrl: `/api/review-media/${token}.${kind.extension}` };
      });
      return json(response, 200, result);
    }
    const reviewMediaMatch = url.pathname.match(/^\/api\/review-media\/([0-9a-f-]{36})\.(jpg|png|webp)$/iu);
    if (reviewMediaMatch && request.method === "GET") {
      const media = await readFile(path.join(reviewMediaRoot, `${reviewMediaMatch[1]}.${reviewMediaMatch[2].toLocaleLowerCase()}`));
      const { kind } = await validateImage(media);
      response.writeHead(200, { "Content-Type": kind.contentType, "Content-Length": media.length, "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" });
      return response.end(media);
    }
    const submissionApproveMatch = url.pathname.match(/^\/api\/submissions\/([0-9a-f-]{36})\/approve$/iu);
    if (submissionApproveMatch && request.method === "POST") return json(response, 200, await serializeWrite(() => approveSubmission(submissionApproveMatch[1], request)));
    if (url.pathname === "/api/catalog" && request.method === "GET") return json(response, 200, JSON.parse(await readFile(catalogPath, "utf8")));
    if (url.pathname === "/api/category-registry" && request.method === "GET") {
      const source = JSON.parse(await readFile(categoryRegistryPath, "utf8"));
      return json(response, 200, {
        taxonomyVersion: source.taxonomyVersion,
        selectionLimit: source.selectionLimit,
        groups: source.groups.map(({ id, label, sortOrder }) => ({ id, label, sortOrder })),
        categories: source.categories.filter((item) => item.active === true).map(({ id, groupId, label, aliases }) => ({ id, groupId, label, aliases })),
      });
    }
    if (url.pathname === "/api/catalog" && request.method === "PUT") {
      const result = await serializeWrite(async () => {
        const candidate = JSON.parse((await body(request, 2 * 1024 * 1024)).toString("utf8"));
        const checked = validateSpecialistsDocument(candidate);
        if (checked.errors.length) throw Object.assign(new Error(checked.errors[0]), { statusCode: 422, errors: checked.errors });
        const site = JSON.parse(await readFile(sitePath, "utf8"));
        const full = validateContent(site, checked.data);
        if (full.errors.length) throw Object.assign(new Error(full.errors[0]), { statusCode: 422, errors: full.errors });
        await atomicSave(catalogPath, checked.data, "specialists");
        return { ok: true };
      });
      return json(response, 200, result);
    }
    if (url.pathname === "/api/site" && request.method === "GET") return json(response, 200, JSON.parse(await readFile(sitePath, "utf8")));
    if (url.pathname === "/api/site" && request.method === "PUT") {
      const result = await serializeWrite(async () => {
        const candidate = JSON.parse((await body(request, 512 * 1024)).toString("utf8"));
        const checked = validateSiteDocument(candidate);
        if (checked.errors.length) throw Object.assign(new Error(checked.errors[0]), { statusCode: 422, errors: checked.errors });
        await atomicSave(sitePath, checked.data, "site");
        return { ok: true };
      });
      return json(response, 200, result);
    }
    if (url.pathname === "/api/preview-build" && request.method === "POST") { await runStaticBuild(); return json(response, 200, { ok: true, url: previewUrl }); }
    if (url.pathname === "/api/photo" && request.method === "POST") {
      const slug = url.searchParams.get("slug") ?? "";
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) return json(response, 422, { errors: ["Сначала укажите имя специалиста."] });
      const input = await body(request, 8 * 1024 * 1024);
      await validateImage(input);
      const directory = path.join(assetRoot, slug);
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, "profile.webp");
      await sharp(input).rotate().resize({ width: 1200, height: 1440, fit: "cover", position: "attention", withoutEnlargement: true }).webp({ quality: 82 }).toFile(destination);
      return json(response, 200, { src: `/images/specialists/${slug}/profile.webp` });
    }
    const photoMatch = url.pathname.match(/^\/images\/specialists\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(profile|avatar)\.webp$/u);
    if (photoMatch && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return response.end(await readFile(path.join(assetRoot, photoMatch[1], `${photoMatch[2]}.webp`)));
    }
    const fileName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!["index.html", "app.js", "styles.css"].includes(fileName)) throw Object.assign(new Error("not found"), { statusCode: 404 });
    const file = path.join(uiRoot, fileName);
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
    response.end(await readFile(file));
  } catch (error) {
    json(response, Number(error?.statusCode) || 500, { errors: error?.errors ?? [error instanceof Error ? error.message : "Неизвестная ошибка"] });
  }
}).listen(port, host, () => console.log(`AL-AMIN owner editor: http://${host}:${port}`));
