import { cropZoomRange } from "./photo-crop.mjs";
import {
  categorySelectionLimit,
  categoryTaxonomyVersion,
  resolveLegacyCategories,
  validateCategorySelection,
} from "./category-registry.mjs";

export const catalogSubmissionContractVersion = 2;

export const catalogSubmissionConsent = "Я подтверждаю, что имею право передать эти данные и фотографию, и соглашаюсь на их обработку для рассмотрения заявки и возможную публикацию в каталоге AL-AMIN после проверки владельцем проекта.";

export const catalogSubmissionLimits = Object.freeze({
  photoBytes: 8 * 1024 * 1024,
  categories: categorySelectionLimit,
  helpTopics: 12,
  workOffers: 12,
  portfolio: 12,
});

const workModes = new Set(["online", "offline", "both"]);
const currencies = new Set(["RUB", "USD", "EUR", "KZT", "AED", "TRY", "UZS"]);
const allowedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, path, errors, { required = false, max = 3000 } = {}) {
  if (value == null || value === "") {
    if (required) errors.push(`${path}: обязательное поле`);
    return "";
  }
  if (typeof value !== "string") {
    errors.push(`${path}: ожидается строка`);
    return "";
  }
  const normalized = value.normalize("NFC").trim();
  if (/[<>\u202A-\u202E\u2066-\u2069]/u.test(normalized)) errors.push(`${path}: HTML и управляющие bidi-символы запрещены`);
  if (Array.from(normalized).length > max) errors.push(`${path}: максимум ${max} символов`);
  return normalized;
}

function numberOrNull(value, path, errors, min, max) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    errors.push(`${path}: значение должно быть от ${min} до ${max}`);
    return null;
  }
  return parsed;
}

function urlOrEmpty(value, path, errors) {
  const normalized = text(value, path, errors, { max: 500 });
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:") errors.push(`${path}: разрешён только https URL`);
  } catch {
    errors.push(`${path}: некорректный URL`);
  }
  return normalized;
}

function stringList(value, path, errors, maxItems) {
  if (!Array.isArray(value)) {
    errors.push(`${path}: ожидается массив`);
    return [];
  }
  if (value.length > maxItems) errors.push(`${path}: максимум ${maxItems} элементов`);
  return value.slice(0, maxItems).map((entry, index) => text(entry, `${path}.${index}`, errors, { required: true, max: 120 })).filter(Boolean);
}

export function validateCatalogSubmissionPayload(value, { requirePhoto = true } = {}) {
  const errors = [];
  if (!record(value)) return { errors: ["submission: ожидается объект"], data: null };
  const contractVersion = Number(value.contractVersion);
  if (![1, catalogSubmissionContractVersion].includes(contractVersion)) errors.push("contractVersion: неподдерживаемая версия");

  const workMode = text(value.workMode, "workMode", errors, { required: true, max: 20 });
  if (workMode && !workModes.has(workMode)) errors.push("workMode: некорректный формат работы");
  const missingCategoryRequest = text(value.missingCategoryRequest, "missingCategoryRequest", errors, { max: 500 });
  let taxonomyVersion = categoryTaxonomyVersion;
  let categoryIds = [];
  let categories = [];
  let legacyCategories = [];
  if (contractVersion === 1) {
    const legacy = stringList(value.categories, "categories", errors, catalogSubmissionLimits.categories);
    if (!legacy.length) errors.push("categories: добавьте хотя бы одну категорию");
    const resolved = resolveLegacyCategories(legacy);
    categoryIds = resolved.categoryIds;
    categories = resolved.categories;
    legacyCategories = resolved.unresolved;
  } else {
    taxonomyVersion = text(value.taxonomyVersion, "taxonomyVersion", errors, { required: true, max: 40 });
    const selection = validateCategorySelection(value.categoryIds, taxonomyVersion, { allowEmpty: Boolean(missingCategoryRequest) });
    errors.push(...selection.errors);
    categoryIds = selection.categoryIds;
    categories = selection.categories;
    if (!categoryIds.length && !missingCategoryRequest) errors.push("categoryIds: выберите категорию или опишите, чего не хватает");
  }

  const helpTopics = Array.isArray(value.helpTopics) ? value.helpTopics.slice(0, catalogSubmissionLimits.helpTopics).map((entry, index) => {
    if (!record(entry)) { errors.push(`helpTopics.${index}: ожидается объект`); return null; }
    return {
      title: text(entry.title, `helpTopics.${index}.title`, errors, { required: true, max: 140 }),
      description: text(entry.description, `helpTopics.${index}.description`, errors, { max: 300 }) || undefined,
    };
  }).filter(Boolean) : [];

  const workOffers = Array.isArray(value.workOffers) ? value.workOffers.slice(0, catalogSubmissionLimits.workOffers).map((entry, index) => {
    if (!record(entry)) { errors.push(`workOffers.${index}: ожидается объект`); return null; }
    const mode = text(entry.mode, `workOffers.${index}.mode`, errors, { required: true, max: 20 });
    if (mode && !workModes.has(mode)) errors.push(`workOffers.${index}.mode: некорректный формат`);
    const price = numberOrNull(entry.price, `workOffers.${index}.price`, errors, 0, 1000000000);
    const durationMinutes = numberOrNull(entry.durationMinutes, `workOffers.${index}.durationMinutes`, errors, 1, 1440);
    const currency = text(entry.currency, `workOffers.${index}.currency`, errors, { max: 3 }) || null;
    if (price !== null && (!currency || !currencies.has(currency))) errors.push(`workOffers.${index}.currency: выберите валюту для указанной цены`);
    return {
      title: text(entry.title, `workOffers.${index}.title`, errors, { required: true, max: 160 }),
      mode,
      durationMinutes,
      price,
      currency: price === null ? null : currency,
    };
  }).filter(Boolean) : [];

  const portfolio = Array.isArray(value.portfolio) ? value.portfolio.slice(0, catalogSubmissionLimits.portfolio).map((entry, index) => {
    if (!record(entry)) { errors.push(`portfolio.${index}: ожидается объект`); return null; }
    return {
      title: text(entry.title, `portfolio.${index}.title`, errors, { required: true, max: 160 }),
      description: text(entry.description, `portfolio.${index}.description`, errors, { max: 500 }) || undefined,
      url: entry.url ? urlOrEmpty(entry.url, `portfolio.${index}.url`, errors) || undefined : undefined,
    };
  }).filter(Boolean) : [];

  const contactsValue = record(value.contacts) ? value.contacts : {};
  const contacts = {
    phone: text(contactsValue.phone, "contacts.phone", errors, { max: 80 }) || undefined,
    email: text(contactsValue.email, "contacts.email", errors, { max: 320 }) || undefined,
    telegram: text(contactsValue.telegram, "contacts.telegram", errors, { max: 120 }) || undefined,
    whatsapp: text(contactsValue.whatsapp, "contacts.whatsapp", errors, { max: 120 }) || undefined,
    website: contactsValue.website ? urlOrEmpty(contactsValue.website, "contacts.website", errors) || undefined : undefined,
  };
  if (contacts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contacts.email)) errors.push("contacts.email: некорректный email");
  if (!Object.values(contacts).some(Boolean)) errors.push("contacts: укажите хотя бы один способ связи");

  const avatarValue = record(value.avatar) ? value.avatar : {};
  const profileCropValue = record(value.profileCrop) ? value.profileCrop : {};
  const profileCrop = {
    positionX: numberOrNull(profileCropValue.positionX ?? 50, "profileCrop.positionX", errors, 0, 100) ?? 50,
    positionY: numberOrNull(profileCropValue.positionY ?? 50, "profileCrop.positionY", errors, 0, 100) ?? 50,
    zoom: numberOrNull(profileCropValue.zoom ?? 1, "profileCrop.zoom", errors, cropZoomRange.min, cropZoomRange.max) ?? 1,
  };
  const avatar = {
    positionX: numberOrNull(avatarValue.positionX ?? 50, "avatar.positionX", errors, 0, 100) ?? 50,
    positionY: numberOrNull(avatarValue.positionY ?? 24, "avatar.positionY", errors, 0, 100) ?? 24,
    zoom: numberOrNull(avatarValue.zoom ?? 1, "avatar.zoom", errors, cropZoomRange.min, cropZoomRange.max) ?? 1,
  };

  const photoValue = record(value.photo) ? value.photo : null;
  if (requirePhoto && !photoValue) errors.push("photo: добавьте фотографию");
  const photo = photoValue ? {
    originalName: text(photoValue.originalName, "photo.originalName", errors, { required: true, max: 180 }),
    contentType: text(photoValue.contentType, "photo.contentType", errors, { required: true, max: 80 }),
    size: numberOrNull(photoValue.size, "photo.size", errors, 1, catalogSubmissionLimits.photoBytes),
    mediaPath: text(photoValue.mediaPath, "photo.mediaPath", errors, { max: 500 }) || undefined,
  } : null;
  if (photo && !allowedPhotoTypes.has(photo.contentType)) errors.push("photo.contentType: разрешены JPEG, PNG и WebP");

  if (value.consent !== true || value.consentText !== catalogSubmissionConsent) errors.push("consent: требуется согласие с актуальным текстом");

  const data = {
    contractVersion,
    fullName: text(value.fullName, "fullName", errors, { required: true, max: 160 }),
    specialization: text(value.specialization, "specialization", errors, { required: true, max: 180 }),
    country: text(value.country, "country", errors, { required: true, max: 100 }),
    city: text(value.city, "city", errors, { required: true, max: 100 }),
    workMode,
    experienceYears: numberOrNull(value.experienceYears, "experienceYears", errors, 0, 80),
    profileSummary: text(value.profileSummary, "profileSummary", errors, { required: true, max: 220 }),
    about: text(value.about, "about", errors, { required: true, max: 3000 }),
    taxonomyVersion,
    categoryIds,
    categories,
    legacyCategories,
    missingCategoryRequest,
    helpTopics,
    workOffers,
    contacts,
    portfolio,
    profileCrop,
    avatar,
    photo,
    consent: true,
    consentText: catalogSubmissionConsent,
  };
  return { errors, data };
}

export function catalogSubmissionToSpecialistDraft(submission) {
  const payload = submission.payload ?? submission;
  return {
    id: submission.id,
    slug: "",
    fullName: payload.fullName,
    photo: { src: submission.photoPreviewUrl || "", alt: `Фото: ${payload.fullName}`, profileCrop: payload.profileCrop, avatar: payload.avatar },
    specialization: payload.specialization,
    taxonomyVersion: payload.taxonomyVersion || categoryTaxonomyVersion,
    categoryIds: payload.categoryIds || [],
    categories: payload.categories,
    legacyCategories: payload.legacyCategories || [],
    missingCategoryRequest: payload.missingCategoryRequest || "",
    country: payload.country,
    city: payload.city,
    workMode: payload.workMode,
    profileSummary: payload.profileSummary,
    about: payload.about,
    helpTopics: payload.helpTopics,
    workOffers: payload.workOffers,
    experienceYears: payload.experienceYears,
    trust: { recommendedByAlAmin: false, verifiedFacts: [] },
    contacts: payload.contacts,
    portfolio: payload.portfolio,
    published: true,
    featured: false,
    sortOrder: 0,
  };
}
