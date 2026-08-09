import { russianCount } from "./russian-count.mjs";
import {
  MAX_FULL_DESCRIPTION,
  MAX_PROFILE_SUMMARY,
  codePointLength,
  isCanonicalUuid,
  isPlainRecord,
  normalizeMultiline,
  normalizeSingleLine,
  validateHelpTopics,
  validateWorkOffers,
  workOfferTitles,
} from "./specialist-contract.mjs";

export const CONTACT_METHODS = ["phone", "telegram"];
export const APPLICATION_INPUT_KEYS = [
  "applicationId", "fullName", "contactMethod", "contact", "country", "city",
  "categoryId", "additionalCategoryIds", "specialization", "experienceYears",
  "profileSummary", "description", "helpTopics", "workOffers", "mainImagePath",
  "truthful", "personalData", "website",
];
export const PROFILE_REVISION_INPUT_KEYS = [
  "fullName", "country", "city", "categoryId", "additionalCategoryIds",
  "specialization", "experienceYears", "profileSummary", "description",
  "helpTopics", "workOffers", "mainImagePath",
];

const characterForms = { one: "символ", few: "символа", many: "символов" };
const nameToken = "[\\p{L}\\p{M}]+(?:[-'’][\\p{L}\\p{M}]+)*";
const personNamePattern = new RegExp(`^${nameToken}(?:\\s+${nameToken})+$`, "u");
const placePattern = /^[\p{L}\p{M}][\p{L}\p{M}\p{Zs}.'’()\-]*$/u;
const phonePattern = /^\+?[0-9 ()-]+$/u;
const telegramPattern = /^(?![0-9])[A-Za-z0-9_]{5,32}$/u;
const canonicalAvatarPattern = /^submissions\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/avatar\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

const rootField = (field) => field.split(".")[0];
const firstError = (errors) => Object.entries(errors)[0];
const add = (errors, field, message) => { if (!errors[field]) errors[field] = message; };
const fieldOrder = ["request", "main", "fullName", "contactMethod", "contact", "country", "city", "categoryId", "additionalCategoryIds", "specialization", "experienceYears", "profileSummary", "description", "helpTopics", "workOffers", "truthful", "personalData", "applicationId"];
const distinctLetters = (value) => new Set((value.match(/\p{L}/gu) ?? []).map((letter) => letter.toLocaleLowerCase())).size;
const hasEmailOrUrlShape = (value) => /@|(?:https?:\/\/)|(?:www\.)/iu.test(value);

function finish(data, errors) {
  const sorted = Object.fromEntries(Object.entries(errors).sort(([left], [right]) => {
    const leftIndex = fieldOrder.indexOf(rootField(left)); const rightIndex = fieldOrder.indexOf(rootField(right));
    return (leftIndex < 0 ? fieldOrder.length : leftIndex) - (rightIndex < 0 ? fieldOrder.length : rightIndex);
  }));
  const first = firstError(sorted);
  return first ? { error: first[1], field: rootField(first[0]), errors: sorted } : { data, errors: {} };
}

function validateEnvelope(body, allowedKeys) {
  if (!isPlainRecord(body)) return { request: "Некорректный запрос." };
  const unknown = Object.keys(body).filter((key) => !allowedKeys.includes(key));
  return unknown.length ? { request: "Запрос содержит неподдерживаемые поля." } : {};
}

export function inferContactMethod(value) {
  if (typeof value !== "string") return "phone";
  const candidate = value.trim();
  return candidate.startsWith("@") || /^(?:https:\/\/)?t\.me\//i.test(candidate) ? "telegram" : "phone";
}

export function normalizeContact(method, value) {
  if (!CONTACT_METHODS.includes(method)) return { error: "Выберите способ связи: телефон или Telegram." };
  if (typeof value !== "string") return { error: method === "phone" ? "Введите корректный номер телефона с кодом страны." : "Введите Telegram username, например @username или t.me/username." };
  const raw = value.normalize("NFC").trim();
  if (/[<>\r\n\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(raw)) return { error: "Удалите недопустимые символы из контакта." };
  if (method === "phone") {
    if (!phonePattern.test(raw) || (raw.match(/\+/g) ?? []).length > 1 || (raw.includes("+") && !raw.startsWith("+"))) return { error: "Введите корректный номер телефона с кодом страны." };
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return { error: "Введите корректный номер телефона с кодом страны." };
    return { data: `+${digits}` };
  }
  const match = raw.match(/^(?:https:\/\/)?t\.me\/([^/?#]+)\/?$/i);
  const username = (match?.[1] ?? raw.replace(/^@/, ""));
  if (!telegramPattern.test(username)) return { error: "Введите Telegram username, например @username или t.me/username." };
  return { data: `@${username}` };
}

function validateCore(body, context, allowedKeys) {
  const errors = validateEnvelope(body, allowedKeys);
  if (!isPlainRecord(body)) return { errors };

  const fullName = normalizeSingleLine(body.fullName, { minimum: 3, maximum: 140, requireLetter: true });
  if (fullName.error || !personNamePattern.test(fullName.data) || distinctLetters(fullName.data) < 2 || hasEmailOrUrlShape(fullName.data)) {
    add(errors, "fullName", "Укажите имя и фамилию буквами. Можно использовать пробел, дефис и апостроф.");
  }

  const country = normalizeSingleLine(body.country, { minimum: 2, maximum: 100, requireLetter: true });
  if (country.error || !placePattern.test(country.data)) add(errors, "country", "Введите корректное название страны.");
  const city = normalizeSingleLine(body.city, { minimum: 2, maximum: 100, requireLetter: true });
  if (city.error || !placePattern.test(city.data)) add(errors, "city", "Введите корректное название города.");

  const categoryId = body.categoryId;
  if (!isCanonicalUuid(categoryId)) add(errors, "categoryId", "Выберите действующую основную категорию.");
  const activeCategories = Array.isArray(context.activeCategories) ? context.activeCategories : null;
  const category = activeCategories?.find((item) => item && item.id === categoryId);
  if (activeCategories && !category) add(errors, "categoryId", "Выберите действующую основную категорию.");

  const extras = body.additionalCategoryIds;
  if (!Array.isArray(extras)) add(errors, "additionalCategoryIds", "Проверьте дополнительные категории: они должны быть действующими, без повторов и не совпадать с основной.");
  else {
    const seen = new Set();
    if (extras.length > 8) add(errors, "additionalCategoryIds", "Можно выбрать не больше 8 дополнительных категорий.");
    for (const id of extras) {
      if (!isCanonicalUuid(id) || id === categoryId || seen.has(id) || (activeCategories && !activeCategories.some((item) => item?.id === id))) {
        add(errors, "additionalCategoryIds", "Проверьте дополнительные категории: они должны быть действующими, без повторов и не совпадать с основной.");
        break;
      }
      seen.add(id);
    }
  }

  const specialization = normalizeSingleLine(body.specialization, { minimum: 2, maximum: 240, requireLetter: true });
  if (specialization.error || hasEmailOrUrlShape(specialization.data)) add(errors, "specialization", "Опишите специализацию словами. Допустимы цифры и профессиональные символы: +, #, /, &, дефис и скобки.");

  const experience = body.experienceYears;
  const experienceYears = typeof experience === "string" && /^(?:0|[1-9]\d?)$/.test(experience) && Number(experience) <= 80 ? Number(experience) : null;
  if (experienceYears === null) add(errors, "experienceYears", "Укажите опыт работы целым числом от 0 до 80.");

  const summary = normalizeSingleLine(body.profileSummary, { minimum: 1, maximum: MAX_PROFILE_SUMMARY, requireLetter: true });
  if (summary.error) add(errors, "profileSummary", typeof body.profileSummary === "string" && codePointLength(body.profileSummary.normalize("NFC").trim()) > MAX_PROFILE_SUMMARY ? `Короткое представление не должно превышать ${MAX_PROFILE_SUMMARY} символов.` : `Добавьте короткое представление до ${MAX_PROFILE_SUMMARY} символов.`);

  const description = normalizeMultiline(body.description, { minimum: 50, maximum: MAX_FULL_DESCRIPTION, requireLetter: true });
  if (description.error) {
    const rawLength = typeof body.description === "string" ? codePointLength(body.description.replace(/\r\n?/g, "\n").normalize("NFC").trim()) : 0;
    add(errors, "description", rawLength > MAX_FULL_DESCRIPTION ? `Описание не должно превышать ${MAX_FULL_DESCRIPTION} символов.` : rawLength < 50 ? `Добавьте ещё ${russianCount(50 - rawLength, characterForms)}. Минимум — 50.` : "Проверьте описание: используйте обычный текст без HTML-разметки и служебных символов.");
  }

  const helpTopics = validateHelpTopics(body.helpTopics);
  if (helpTopics.error) Object.assign(errors, helpTopics.errors);
  const workOffers = validateWorkOffers(body.workOffers);
  if (workOffers.error) Object.assign(errors, workOffers.errors);

  const mainImagePath = body.mainImagePath;
  const ownerId = context.ownerId;
  const allowedExisting = new Set(Array.isArray(context.allowedExistingMediaPaths) ? context.allowedExistingMediaPaths : []);
  const mediaIsAllowedLegacy = typeof mainImagePath === "string" && allowedExisting.has(mainImagePath);
  const mediaMatch = typeof mainImagePath === "string" ? mainImagePath.match(canonicalAvatarPattern) : null;
  if (!context.hasPendingMainImage && (typeof mainImagePath !== "string" || (!mediaIsAllowedLegacy && (!mediaMatch || (ownerId && mediaMatch[1].toLowerCase() !== ownerId.toLowerCase()))))) {
    add(errors, "main", "Добавьте фотографию профиля.");
  }

  return {
    errors,
    values: {
      full_name: fullName.data,
      country: country.data,
      city: city.data,
      category_id: categoryId,
      category_text: category?.name,
      additional_category_ids: Array.isArray(extras) ? extras : [],
      specialization: specialization.data,
      experience_years: experienceYears,
      profile_summary: summary.data,
      description: description.data,
      help_topics: helpTopics.data,
      work_offers: workOffers.data,
      services: workOffers.data ? workOfferTitles(workOffers.data).join("\n") : "",
      main_image_path: mainImagePath,
    },
  };
}

export function validateApplication(body, context = {}) {
  const core = validateCore(body, context, APPLICATION_INPUT_KEYS);
  const errors = core.errors;
  if (!isPlainRecord(body)) return finish(undefined, errors);
  if (body.applicationId !== undefined && !isCanonicalUuid(body.applicationId)) add(errors, "applicationId", "Эту заявку нельзя отправить повторно.");
  if (typeof body.website !== "string" || body.website !== "") add(errors, "request", "Некорректный запрос.");
  if (!CONTACT_METHODS.includes(body.contactMethod)) add(errors, "contactMethod", "Выберите способ связи: телефон или Telegram.");
  const contact = normalizeContact(body.contactMethod, body.contact);
  if (contact.error) add(errors, "contact", contact.error);
  if (body.truthful !== true) add(errors, "truthful", "Подтвердите достоверность сведений.");
  if (body.personalData !== true) add(errors, "personalData", "Подтвердите согласие на обработку персональных данных.");
  const data = core.values ? {
    contract_version: 2,
    ...core.values,
    owner_id: context.ownerId,
    contact: contact.data,
    consent_truthful: true,
    consent_personal_data: true,
  } : undefined;
  return finish(data, errors);
}

export function validateProfileRevision(body, context = {}) {
  const core = validateCore(body, context, PROFILE_REVISION_INPUT_KEYS);
  const values = core.values;
  const data = values ? {
    contract_version: 2,
    full_name: values.full_name,
    country: values.country,
    city: values.city,
    category_id: values.category_id,
    additional_category_ids: values.additional_category_ids,
    specialization: values.specialization,
    experience_years: values.experience_years,
    profile_summary: values.profile_summary,
    full_description: values.description,
    help_topics: values.help_topics,
    work_offers: values.work_offers,
    avatar_path: values.main_image_path,
  } : undefined;
  return finish(data, core.errors);
}
