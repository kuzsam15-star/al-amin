import { cropZoomRange } from "./photo-crop.mjs";

const workModes = new Set(["online", "offline", "both"]);
const currencies = new Set(["RUB", "USD", "EUR", "KZT", "AED", "TRY", "UZS"]);
const allowedProtocols = new Set(["https:"]);

function isRecord(value) {
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
  const result = value.normalize("NFC").trim();
  if (/[<>\u202A-\u202E\u2066-\u2069]/u.test(result)) errors.push(`${path}: HTML и управляющие bidi-символы запрещены`);
  if (Array.from(result).length > max) errors.push(`${path}: максимум ${max} символов`);
  return result;
}

function stringList(value, path, errors, maxItems = 12) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path}: ожидается массив`);
    return [];
  }
  if (value.length > maxItems) errors.push(`${path}: максимум ${maxItems} элементов`);
  return value.map((item, index) => text(item, `${path}.${index}`, errors, { required: true, max: 120 })).filter(Boolean);
}

function boundedNumber(value, path, errors, { min, max, fallback }) {
  if (value == null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) {
    errors.push(`${path}: значение должно быть от ${min} до ${max}`);
    return fallback;
  }
  return result;
}

function safeUrl(value, path, errors) {
  const normalized = text(value, path, errors, { max: 500 });
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (!allowedProtocols.has(url.protocol)) errors.push(`${path}: разрешён только https URL`);
  } catch {
    errors.push(`${path}: некорректный URL`);
  }
  return normalized;
}

function validateSite(value) {
  const errors = [];
  if (!isRecord(value)) return { errors: ["site: ожидается объект"], data: null };
  const fields = ["brandName", "tagline", "heroTitle", "heroText", "heroCtaText", "heroAssurance", "contactEmail", "seoTitle", "seoDescription", "aboutText", "verificationIntro", "rulesIntro", "privacyText"];
  const data = {};
  for (const field of fields) data[field] = text(value[field], `site.${field}`, errors, { required: true, max: field.endsWith("Text") || field.endsWith("Intro") ? 5000 : 360 });
  data.contactTelegram = text(value.contactTelegram, "site.contactTelegram", errors, { max: 120 });
  data.contactPhone = text(value.contactPhone, "site.contactPhone", errors, { max: 80 });
  data.contactWebsite = value.contactWebsite ? safeUrl(value.contactWebsite, "site.contactWebsite", errors) : "";
  if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(data.contactEmail)) errors.push("site.contactEmail: некорректный email");
  return { errors, data };
}

export function validateSiteDocument(value) {
  return validateSite(value);
}

function validateSpecialist(value, index) {
  const errors = [];
  const path = `specialists.${index}`;
  if (!isRecord(value)) return { errors: [`${path}: ожидается объект`], data: null };
  const slug = text(value.slug, `${path}.slug`, errors, { required: true, max: 80 });
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) errors.push(`${path}.slug: используйте строчные латинские буквы, цифры и дефисы`);
  const avatarValue = isRecord(value.photo) && isRecord(value.photo.avatar) ? value.photo.avatar : {};
  const photo = isRecord(value.photo) ? {
    src: text(value.photo.src, `${path}.photo.src`, errors, { required: true, max: 300 }),
    avatarSrc: text(value.photo.avatarSrc, `${path}.photo.avatarSrc`, errors, { max: 300 }) || undefined,
    alt: text(value.photo.alt, `${path}.photo.alt`, errors, { required: true, max: 180 }),
    avatar: {
      positionX: boundedNumber(avatarValue.positionX, `${path}.photo.avatar.positionX`, errors, { min: 0, max: 100, fallback: 50 }),
      positionY: boundedNumber(avatarValue.positionY, `${path}.photo.avatar.positionY`, errors, { min: 0, max: 100, fallback: 24 }),
      zoom: boundedNumber(avatarValue.zoom, `${path}.photo.avatar.zoom`, errors, { min: cropZoomRange.min, max: cropZoomRange.max, fallback: 1 }),
    },
  } : null;
  if (!photo) errors.push(`${path}.photo: обязательный объект`);
  else if (!photo.src.startsWith("/images/specialists/")) errors.push(`${path}.photo.src: файл должен находиться в /public/images/specialists/`);
  else if (photo.avatarSrc && !photo.avatarSrc.startsWith("/images/specialists/")) errors.push(`${path}.photo.avatarSrc: файл должен находиться в /public/images/specialists/`);

  const categories = stringList(value.categories, `${path}.categories`, errors, 8);
  if (!categories.length) errors.push(`${path}.categories: нужна хотя бы одна категория`);
  const workMode = text(value.workMode, `${path}.workMode`, errors, { required: true, max: 20 });
  if (workMode && !workModes.has(workMode)) errors.push(`${path}.workMode: online, offline или both`);

  const helpTopics = Array.isArray(value.helpTopics) ? value.helpTopics.slice(0, 12).map((item, itemIndex) => {
    if (!isRecord(item)) { errors.push(`${path}.helpTopics.${itemIndex}: ожидается объект`); return null; }
    return {
      title: text(item.title, `${path}.helpTopics.${itemIndex}.title`, errors, { required: true, max: 140 }),
      description: text(item.description, `${path}.helpTopics.${itemIndex}.description`, errors, { max: 300 }) || undefined,
    };
  }).filter(Boolean) : [];

  const workOffers = Array.isArray(value.workOffers) ? value.workOffers.slice(0, 12).map((item, itemIndex) => {
    if (!isRecord(item)) { errors.push(`${path}.workOffers.${itemIndex}: ожидается объект`); return null; }
    const price = item.price == null || item.price === "" ? null : Number(item.price);
    const currency = text(item.currency, `${path}.workOffers.${itemIndex}.currency`, errors, { max: 3 }) || null;
    const mode = text(item.mode, `${path}.workOffers.${itemIndex}.mode`, errors, { required: true, max: 20 });
    if (mode && !workModes.has(mode)) errors.push(`${path}.workOffers.${itemIndex}.mode: некорректный формат`);
    if (price !== null && (!Number.isFinite(price) || price < 0)) errors.push(`${path}.workOffers.${itemIndex}.price: некорректная цена`);
    if (price !== null && (!currency || !currencies.has(currency))) errors.push(`${path}.workOffers.${itemIndex}.currency: некорректная валюта`);
    return {
      title: text(item.title, `${path}.workOffers.${itemIndex}.title`, errors, { required: true, max: 160 }),
      durationMinutes: item.durationMinutes == null || item.durationMinutes === "" ? null : Number(item.durationMinutes),
      mode,
      price,
      currency,
    };
  }).filter(Boolean) : [];

  const contactsValue = isRecord(value.contacts) ? value.contacts : {};
  const contacts = {
    phone: text(contactsValue.phone, `${path}.contacts.phone`, errors, { max: 80 }) || undefined,
    email: text(contactsValue.email, `${path}.contacts.email`, errors, { max: 320 }) || undefined,
    telegram: text(contactsValue.telegram, `${path}.contacts.telegram`, errors, { max: 120 }) || undefined,
    whatsapp: text(contactsValue.whatsapp, `${path}.contacts.whatsapp`, errors, { max: 120 }) || undefined,
    website: contactsValue.website ? safeUrl(contactsValue.website, `${path}.contacts.website`, errors) || undefined : undefined,
  };
  if (contacts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contacts.email)) errors.push(`${path}.contacts.email: некорректный email`);

  const trustValue = isRecord(value.trust) ? value.trust : {};
  const trust = {
    recommendedByAlAmin: trustValue.recommendedByAlAmin === true,
    verificationDate: text(trustValue.verificationDate, `${path}.trust.verificationDate`, errors, { max: 10 }) || undefined,
    verificationSummary: text(trustValue.verificationSummary, `${path}.trust.verificationSummary`, errors, { max: 500 }) || undefined,
    verifiedFacts: stringList(trustValue.verifiedFacts, `${path}.trust.verifiedFacts`, errors, 12),
  };

  return {
    errors,
    data: {
      id: text(value.id, `${path}.id`, errors, { required: true, max: 120 }),
      slug,
      fullName: text(value.fullName, `${path}.fullName`, errors, { required: true, max: 160 }),
      photo,
      specialization: text(value.specialization, `${path}.specialization`, errors, { required: true, max: 180 }),
      categories,
      country: text(value.country, `${path}.country`, errors, { required: true, max: 100 }),
      city: text(value.city, `${path}.city`, errors, { required: true, max: 100 }),
      workMode,
      profileSummary: text(value.profileSummary, `${path}.profileSummary`, errors, { required: true, max: 220 }),
      about: text(value.about, `${path}.about`, errors, { required: true, max: 3000 }),
      helpTopics,
      workOffers,
      experienceYears: value.experienceYears == null || value.experienceYears === "" ? null : Number(value.experienceYears),
      trust,
      contacts,
      portfolio: Array.isArray(value.portfolio) ? value.portfolio.slice(0, 12).map((item, itemIndex) => {
        if (!isRecord(item)) { errors.push(`${path}.portfolio.${itemIndex}: ожидается объект`); return null; }
        return {
          title: text(item.title, `${path}.portfolio.${itemIndex}.title`, errors, { required: true, max: 160 }),
          description: text(item.description, `${path}.portfolio.${itemIndex}.description`, errors, { max: 500 }) || undefined,
          url: item.url ? safeUrl(item.url, `${path}.portfolio.${itemIndex}.url`, errors) || undefined : undefined,
        };
      }).filter(Boolean) : [],
      published: value.published === true,
      featured: value.featured === true,
      sortOrder: Number.isFinite(Number(value.sortOrder)) ? Number(value.sortOrder) : 0,
    },
  };
}

export function validateSpecialistsDocument(value) {
  const errors = [];
  if (!isRecord(value)) return { errors: ["catalog: ожидается объект"], data: null };
  if (value.version !== 1) errors.push("catalog.version: поддерживается версия 1");
  if (!Array.isArray(value.specialists)) return { errors: [...errors, "catalog.specialists: ожидается массив"], data: null };
  const data = [];
  const ids = new Set();
  const slugs = new Set();
  value.specialists.forEach((item, index) => {
    const result = validateSpecialist(item, index);
    errors.push(...result.errors);
    if (!result.data) return;
    if (ids.has(result.data.id)) errors.push(`specialists.${index}.id: дубликат`);
    if (slugs.has(result.data.slug)) errors.push(`specialists.${index}.slug: дубликат`);
    ids.add(result.data.id);
    slugs.add(result.data.slug);
    data.push(result.data);
  });
  return { errors, data: { version: 1, specialists: data } };
}

export function validateContent(site, catalog) {
  const siteResult = validateSite(site);
  const catalogResult = validateSpecialistsDocument(catalog);
  return {
    errors: [...siteResult.errors, ...catalogResult.errors],
    site: siteResult.data,
    catalog: catalogResult.data,
  };
}
