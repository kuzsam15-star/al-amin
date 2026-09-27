import {
  catalogSubmissionConsent,
  catalogSubmissionContractVersion,
  catalogSubmissionLimits,
  validateCatalogSubmissionPayload,
} from "./catalog-submission-contract.mjs";

export const alaminSubmissionMarker = "AL-AMIN-CATALOG-SUBMISSION";
export const alaminSubmissionFileVersion = 1;
export const alaminSubmissionConsentVersion = 1;
export const alaminSubmissionFileLimits = Object.freeze({
  packageBytes: 24 * 1024 * 1024,
  totalImageBytes: 16 * 1024 * 1024,
  attachments: 4,
  imagePixels: 40_000_000,
});

const allowedTopLevel = new Set(["marker", "version", "packageId", "createdAt", "payload", "consent", "attachments"]);
const allowedPayload = new Set([
  "contractVersion", "fullName", "specialization", "country", "city", "workMode", "experienceYears",
  "profileSummary", "about", "taxonomyVersion", "categoryIds", "categories", "missingCategoryRequest",
  "helpTopics", "workOffers", "contacts", "portfolio", "profileCrop", "avatar", "photo",
]);
const allowedConsent = new Set(["accepted", "version", "text"]);
const allowedAttachment = new Set(["id", "role", "filename", "mediaType", "encoding", "data"]);
const allowedPhoto = new Set(["originalName", "contentType", "size"]);
const allowedAvatar = new Set(["positionX", "positionY", "zoom"]);
const allowedProfileCrop = new Set(["positionX", "positionY", "zoom"]);
const allowedHelpTopic = new Set(["title", "description"]);
const allowedWorkOffer = new Set(["title", "mode", "durationMinutes", "price", "currency"]);
const allowedPortfolio = new Set(["title", "description", "url"]);
const allowedContacts = new Set(["phone", "email", "telegram", "whatsapp", "website"]);
const forbiddenPayloadKeys = new Set([
  "id", "slug", "status", "published", "featured", "sortOrder", "trust", "verified", "verifiedFacts",
  "verificationDate", "verificationSummary", "mediaPath", "src", "path", "ownerId", "command", "code",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknown(value, allowed, path, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key}: поле не поддерживается`);
  }
}

function rejectForbiddenKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenKeys(item, `${path}.${index}`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenPayloadKeys.has(key)) errors.push(`${path}.${key}: поле управляется только владельцем каталога`);
    rejectForbiddenKeys(entry, `${path}.${key}`, errors);
  }
}

function decodedBase64Bytes(value) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding;
}

export function safeAlaminFileName(fullName, extension = ".alamin") {
  const clean = String(fullName || "специалиста")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80) || "специалиста";
  return `Заявка-${clean.replace(/\s+/gu, "-")}${extension}`;
}

export function createAlaminSubmissionPackage({ packageId, createdAt, payload, attachment }) {
  const cleanPayload = { ...payload };
  delete cleanPayload.consent;
  delete cleanPayload.consentText;
  return {
    marker: alaminSubmissionMarker,
    version: alaminSubmissionFileVersion,
    packageId,
    createdAt,
    payload: cleanPayload,
    consent: {
      accepted: true,
      version: alaminSubmissionConsentVersion,
      text: catalogSubmissionConsent,
    },
    attachments: [{
      id: "profile-photo",
      role: "profile-photo",
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      encoding: "base64",
      data: attachment.data,
    }],
  };
}

export function validateAlaminSubmissionPackage(value) {
  const errors = [];
  if (!isRecord(value)) return { errors: ["Файл заявки должен содержать JSON-объект."], data: null, attachmentBytes: 0 };
  rejectUnknown(value, allowedTopLevel, "package", errors);
  if (value.marker !== alaminSubmissionMarker) errors.push("marker: это не файл заявки AL-AMIN");
  if (value.version !== alaminSubmissionFileVersion) errors.push("version: версия файла заявки не поддерживается");
  if (typeof value.packageId !== "string" || !uuidPattern.test(value.packageId)) errors.push("packageId: некорректный идентификатор пакета");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) errors.push("createdAt: некорректная дата формирования");

  if (!isRecord(value.payload)) errors.push("payload: ожидается объект анкеты");
  else {
    rejectUnknown(value.payload, allowedPayload, "payload", errors);
    rejectForbiddenKeys(value.payload, "payload", errors);
    rejectUnknown(value.payload.photo, allowedPhoto, "payload.photo", errors);
    rejectUnknown(value.payload.avatar, allowedAvatar, "payload.avatar", errors);
    rejectUnknown(value.payload.profileCrop, allowedProfileCrop, "payload.profileCrop", errors);
    rejectUnknown(value.payload.contacts, allowedContacts, "payload.contacts", errors);
    for (const [field, allowed] of [["helpTopics", allowedHelpTopic], ["workOffers", allowedWorkOffer], ["portfolio", allowedPortfolio]]) {
      if (Array.isArray(value.payload[field])) value.payload[field].forEach((entry, index) => rejectUnknown(entry, allowed, `payload.${field}.${index}`, errors));
    }
  }

  if (!isRecord(value.consent)) errors.push("consent: отсутствуют сведения о согласии");
  else {
    rejectUnknown(value.consent, allowedConsent, "consent", errors);
    if (value.consent.accepted !== true || value.consent.version !== alaminSubmissionConsentVersion || value.consent.text !== catalogSubmissionConsent) {
      errors.push("consent: требуется актуальное согласие");
    }
  }

  if (!Array.isArray(value.attachments)) errors.push("attachments: ожидается массив");
  else if (value.attachments.length !== 1 || value.attachments.length > alaminSubmissionFileLimits.attachments) errors.push("attachments: файл должен содержать одну фотографию профиля");

  let attachmentBytes = 0;
  const attachment = Array.isArray(value.attachments) ? value.attachments[0] : null;
  if (isRecord(attachment)) {
    rejectUnknown(attachment, allowedAttachment, "attachments.0", errors);
    if (attachment.id !== "profile-photo" || attachment.role !== "profile-photo") errors.push("attachments.0: неизвестная роль вложения");
    if (attachment.encoding !== "base64") errors.push("attachments.0.encoding: поддерживается только base64");
    if (!imageTypes.has(attachment.mediaType)) errors.push("attachments.0.mediaType: разрешены JPEG, PNG и WebP");
    if (typeof attachment.filename !== "string" || !attachment.filename || attachment.filename.length > 180 || /[\\/\u0000]/u.test(attachment.filename)) errors.push("attachments.0.filename: небезопасное имя файла");
    const decoded = decodedBase64Bytes(attachment.data);
    if (decoded === null) errors.push("attachments.0.data: некорректные данные base64");
    else attachmentBytes = decoded;
    if (attachmentBytes > catalogSubmissionLimits.photoBytes) errors.push("attachments.0: фотография должна быть не больше 8 МиБ");
    if (attachmentBytes > alaminSubmissionFileLimits.totalImageBytes) errors.push("attachments: общий размер изображений превышает 16 МиБ");
  }

  let payloadData = null;
  if (isRecord(value.payload) && isRecord(value.consent)) {
    const validation = validateCatalogSubmissionPayload({
      ...value.payload,
      consent: value.consent.accepted,
      consentText: value.consent.text,
    });
    errors.push(...validation.errors);
    payloadData = validation.data;
  }
  if (payloadData?.photo) {
    if (payloadData.photo.size !== attachmentBytes) errors.push("photo.size: заявленный размер не совпадает с вложением");
    if (payloadData.photo.contentType !== attachment?.mediaType) errors.push("photo.contentType: заявленный формат не совпадает с вложением");
  }

  return {
    errors: [...new Set(errors)],
    data: errors.length ? null : {
      packageId: value.packageId,
      createdAt: new Date(value.createdAt).toISOString(),
      payload: payloadData,
      consent: value.consent,
      attachment,
    },
    attachmentBytes,
  };
}

export function base64DecodedByteLength(value) {
  return decodedBase64Bytes(value);
}

export const alaminSubmissionFormatDocumentation = Object.freeze({
  marker: alaminSubmissionMarker,
  version: alaminSubmissionFileVersion,
  extension: ".alamin",
  compatibleExtension: ".alamin.json",
  encoding: "UTF-8 JSON; image attachment encoded as base64",
  payloadContractVersion: catalogSubmissionContractVersion,
});
