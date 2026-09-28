import { cropZoomRange } from "./photo-crop.mjs";
import { categoryTaxonomyVersion, resolveLegacyCategories, validateCategorySelection } from "./category-registry.mjs";

export const catalogSubmissionDraftStorageKey = "alamin.catalog-submission-draft.v1";
export const catalogSubmissionDraftVersion = 2;

const marker = "AL-AMIN-CATALOG-SUBMISSION-DRAFT";
const workModes = new Set(["online", "offline", "both"]);
const currencies = new Set(["RUB", "USD", "EUR", "KZT", "AED", "TRY", "UZS"]);

const limits = Object.freeze({
  categories: 8,
  helpTopics: 12,
  workOffers: 12,
  portfolio: 12,
});

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max) {
  if (typeof value !== "string") return "";
  return Array.from(value.replaceAll("\0", "")).slice(0, max).join("");
}

function numericText(value, max = 16) {
  return text(value, max).replace(/[^0-9.,-]/gu, "");
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function createEmptyCatalogSubmissionDraft() {
  return {
    fields: {
      fullName: "",
      specialization: "",
      country: "",
      city: "",
      workMode: "both",
      experienceYears: "",
      profileSummary: "",
      about: "",
      phone: "",
      email: "",
      telegram: "",
      whatsapp: "",
      website: "",
      consent: false,
    },
    taxonomyVersion: categoryTaxonomyVersion,
    categoryIds: [],
    legacyCategories: [],
    missingCategoryRequest: "",
    helpTopics: [],
    workOffers: [{ title: "", mode: "online", durationMinutes: "", price: "", currency: "RUB" }],
    portfolio: [],
    profileCrop: { positionX: 50, positionY: 50, zoom: 1 },
    avatar: { positionX: 50, positionY: 24, zoom: 1 },
    photoWasSelected: false,
  };
}

export function normalizeCatalogSubmissionDraft(value) {
  const empty = createEmptyCatalogSubmissionDraft();
  if (!record(value) || value.marker !== marker || ![1, catalogSubmissionDraftVersion].includes(value.version)) return null;

  const sourceFields = record(value.fields) ? value.fields : {};
  const fields = {
    fullName: text(sourceFields.fullName, 160),
    specialization: text(sourceFields.specialization, 180),
    country: text(sourceFields.country, 100),
    city: text(sourceFields.city, 100),
    workMode: workModes.has(sourceFields.workMode) ? sourceFields.workMode : "both",
    experienceYears: numericText(sourceFields.experienceYears, 3),
    profileSummary: text(sourceFields.profileSummary, 220),
    about: text(sourceFields.about, 3000),
    phone: text(sourceFields.phone, 80),
    email: text(sourceFields.email, 320),
    telegram: text(sourceFields.telegram, 120),
    whatsapp: text(sourceFields.whatsapp, 120),
    website: text(sourceFields.website, 500),
    consent: sourceFields.consent === true,
  };

  let categoryIds = [];
  let legacyCategories = [];
  if (value.version === 1) {
    const legacyValues = [
      ...(Array.isArray(value.categories) ? value.categories : []),
      ...(typeof value.categoryDraft === "string" && value.categoryDraft.trim() ? [value.categoryDraft] : []),
    ].slice(0, limits.categories).map((entry) => text(entry, 120)).filter(Boolean);
    const resolved = resolveLegacyCategories(legacyValues);
    categoryIds = resolved.categoryIds;
    legacyCategories = resolved.unresolved;
  } else {
    const selection = validateCategorySelection(value.categoryIds, value.taxonomyVersion, { allowEmpty: true });
    categoryIds = value.taxonomyVersion === categoryTaxonomyVersion ? selection.categoryIds : [];
    legacyCategories = Array.isArray(value.legacyCategories)
      ? value.legacyCategories.slice(0, limits.categories).map((entry) => text(entry, 120)).filter(Boolean)
      : [];
  }
  const helpTopics = Array.isArray(value.helpTopics)
    ? value.helpTopics.slice(0, limits.helpTopics).filter(record).map((entry) => ({ title: text(entry.title, 140), description: text(entry.description, 300) }))
    : empty.helpTopics;
  const workOffers = Array.isArray(value.workOffers)
    ? value.workOffers.slice(0, limits.workOffers).filter(record).map((entry) => ({
      title: text(entry.title, 160),
      mode: workModes.has(entry.mode) ? entry.mode : "online",
      durationMinutes: numericText(entry.durationMinutes),
      price: numericText(entry.price),
      currency: currencies.has(entry.currency) ? entry.currency : "RUB",
    }))
    : empty.workOffers;
  const portfolio = Array.isArray(value.portfolio)
    ? value.portfolio.slice(0, limits.portfolio).filter(record).map((entry) => ({ title: text(entry.title, 160), description: text(entry.description, 500), url: text(entry.url, 500) }))
    : [];
  const sourceAvatar = record(value.avatar) ? value.avatar : {};
  const sourceProfileCrop = record(value.profileCrop) ? value.profileCrop : {};

  return {
    fields,
    taxonomyVersion: categoryTaxonomyVersion,
    categoryIds,
    legacyCategories,
    missingCategoryRequest: text(value.missingCategoryRequest, 500),
    helpTopics: helpTopics.length ? helpTopics : empty.helpTopics,
    workOffers: workOffers.length ? workOffers : empty.workOffers,
    portfolio,
    profileCrop: {
      positionX: boundedNumber(sourceProfileCrop.positionX, 50, 0, 100),
      positionY: boundedNumber(sourceProfileCrop.positionY, 50, 0, 100),
      zoom: boundedNumber(sourceProfileCrop.zoom, 1, cropZoomRange.min, cropZoomRange.max),
    },
    avatar: {
      positionX: boundedNumber(sourceAvatar.positionX, 50, 0, 100),
      positionY: boundedNumber(sourceAvatar.positionY, 24, 0, 100),
      zoom: boundedNumber(sourceAvatar.zoom, 1, cropZoomRange.min, cropZoomRange.max),
    },
    photoWasSelected: value.photoWasSelected === true,
  };
}

export function serializeCatalogSubmissionDraft(draft, savedAt = new Date().toISOString()) {
  return JSON.stringify({
    marker,
    version: catalogSubmissionDraftVersion,
    savedAt,
    ...draft,
  });
}

export function parseCatalogSubmissionDraft(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return normalizeCatalogSubmissionDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function hasMeaningfulCatalogSubmissionDraft(draft) {
  if (!draft) return false;
  const textFieldNames = ["fullName", "specialization", "country", "city", "experienceYears", "profileSummary", "about", "phone", "email", "telegram", "whatsapp", "website"];
  return textFieldNames.some((key) => Boolean(draft.fields[key]))
    || draft.fields.workMode !== "both"
    || draft.fields.consent
    || draft.categoryIds.length > 0
    || draft.legacyCategories.length > 0
    || Boolean(draft.missingCategoryRequest)
    || draft.helpTopics.some((entry) => entry.title || entry.description)
    || draft.workOffers.some((entry) => entry.title || entry.durationMinutes || entry.price || entry.mode !== "online")
    || draft.portfolio.some((entry) => entry.title || entry.description || entry.url)
    || draft.profileCrop.positionX !== 50
    || draft.profileCrop.positionY !== 50
    || draft.profileCrop.zoom !== 1
    || draft.avatar.positionX !== 50
    || draft.avatar.positionY !== 24
    || draft.avatar.zoom !== 1
    || draft.photoWasSelected;
}

export function syncCatalogSubmissionDraftStorage(storage, draft) {
  if (hasMeaningfulCatalogSubmissionDraft(draft)) {
    storage.setItem(catalogSubmissionDraftStorageKey, serializeCatalogSubmissionDraft(draft));
    return "saved";
  }
  storage.removeItem(catalogSubmissionDraftStorageKey);
  return "removed";
}

export function clearCatalogSubmissionDraftStorage(storage) {
  storage.removeItem(catalogSubmissionDraftStorageKey);
}
