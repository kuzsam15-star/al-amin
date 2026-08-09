export const MAX_PROFILE_SUMMARY = 220;
export const MAX_FULL_DESCRIPTION = 3000;
export const MAX_HELP_TOPICS = 12;
export const MAX_WORK_OFFERS = 12;
export const WORK_MODES = ["online", "offline", "both"];
export const WORK_CURRENCIES = ["RUB", "USD", "EUR", "KZT", "AED", "TRY", "UZS"];

const bidiControlPattern = /[\u202A-\u202E\u2066-\u2069]/u;
const singleLineControlPattern = /[\u0000-\u001F\u007F-\u009F]/u;
const multilineControlPattern = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;
const markupPattern = /[<>]/u;
const containsLetter = /\p{L}/u;

export const codePointLength = (value) => Array.from(value).length;
export const isPlainRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export const isCanonicalUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function normalizeSingleLine(value, { minimum = 0, maximum, requireLetter = false } = {}) {
  if (typeof value !== "string") return { error: "Значение должно быть текстом." };
  if (singleLineControlPattern.test(value) || bidiControlPattern.test(value) || /[\r\n]/u.test(value)) return { error: "Удалите недопустимые служебные символы." };
  if (markupPattern.test(value)) return { error: "HTML-разметка в этом поле не поддерживается." };
  const data = value.normalize("NFC").trim().replace(/[\p{Zs}\f\v]+/gu, " ");
  const length = codePointLength(data);
  if (length < minimum) return { error: "Значение слишком короткое." };
  if (typeof maximum === "number" && length > maximum) return { error: `Значение не должно превышать ${maximum} символов.` };
  if (requireLetter && !containsLetter.test(data)) return { error: "Добавьте текст, содержащий буквы." };
  return { data };
}

export function normalizeMultiline(value, { minimum = 0, maximum, requireLetter = false } = {}) {
  if (typeof value !== "string") return { error: "Значение должно быть текстом." };
  const normalizedNewlines = value.replace(/\r\n?/g, "\n");
  if (multilineControlPattern.test(normalizedNewlines) || bidiControlPattern.test(normalizedNewlines)) return { error: "Удалите недопустимые служебные символы." };
  if (markupPattern.test(normalizedNewlines)) return { error: "HTML-разметка в этом поле не поддерживается." };
  const data = normalizedNewlines.normalize("NFC").trim();
  const length = codePointLength(data);
  if (length < minimum) return { error: "Значение слишком короткое." };
  if (typeof maximum === "number" && length > maximum) return { error: `Значение не должно превышать ${maximum} символов.` };
  if (requireLetter && !containsLetter.test(data)) return { error: "Добавьте текст, содержащий буквы." };
  return { data };
}

function result(data, errors) {
  const entries = Object.entries(errors);
  return entries.length ? { error: entries[0][1], field: entries[0][0], errors } : { data, errors: {} };
}

export function validateHelpTopics(value, { required = true, prefix = "helpTopics" } = {}) {
  const errors = {};
  if (!Array.isArray(value)) return result(undefined, { [prefix]: "Добавьте хотя бы одно направление помощи." });
  if (value.length > MAX_HELP_TOPICS) errors[prefix] = `Можно добавить не больше ${MAX_HELP_TOPICS} направлений.`;
  if (required && value.length === 0) errors[prefix] = "Добавьте хотя бы одно направление помощи.";
  const data = [];
  const titles = new Map();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const itemPrefix = `${prefix}.${index}`;
    if (!isPlainRecord(item)) {
      errors[itemPrefix] = `Направление ${index + 1}: проверьте данные.`;
      continue;
    }
    const unknown = Object.keys(item).filter((key) => !["title", "description"].includes(key));
    if (unknown.length) errors[itemPrefix] = `Направление ${index + 1}: обнаружены неподдерживаемые поля.`;
    const title = normalizeSingleLine(item.title, { minimum: 2, maximum: 140, requireLetter: true });
    const description = item.description === null || item.description === ""
      ? { data: "" }
      : normalizeMultiline(item.description, { maximum: 300, requireLetter: true });
    if (title.error) errors[`${itemPrefix}.title`] = `Направление ${index + 1}: укажите название от 2 до 140 символов.`;
    if (description.error) errors[`${itemPrefix}.description`] = `Направление ${index + 1}: пояснение должно быть текстом до 300 символов без разметки.`;
    if (!title.error) {
      const key = title.data.toLocaleLowerCase("ru");
      if (titles.has(key)) errors[`${itemPrefix}.title`] = `Направление ${index + 1}: такое направление уже добавлено.`;
      else titles.set(key, index);
    }
    if (!title.error && !description.error) data.push({ title: title.data, description: description.data || null });
  }
  return result(data, errors);
}

const validDecimal = (value) => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;

export function validateWorkOffers(value, { required = true, allowLegacyMode = false, prefix = "workOffers" } = {}) {
  const errors = {};
  if (!Array.isArray(value)) return result(undefined, { [prefix]: "Добавьте хотя бы один формат работы." });
  if (value.length > MAX_WORK_OFFERS) errors[prefix] = `Можно добавить не больше ${MAX_WORK_OFFERS} форматов работы.`;
  if (required && value.length === 0) errors[prefix] = "Добавьте хотя бы один формат работы.";
  const data = [];
  const titles = new Map();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const itemPrefix = `${prefix}.${index}`;
    if (!isPlainRecord(item)) {
      errors[itemPrefix] = `Формат ${index + 1}: проверьте данные.`;
      continue;
    }
    const unknown = Object.keys(item).filter((key) => !["title", "duration_minutes", "mode", "price", "currency"].includes(key));
    if (unknown.length) errors[itemPrefix] = `Формат ${index + 1}: обнаружены неподдерживаемые поля.`;
    const title = normalizeSingleLine(item.title, { minimum: 2, maximum: 160, requireLetter: true });
    const mode = item.mode;
    const duration = item.duration_minutes;
    const price = item.price;
    const currency = item.currency;
    if (title.error) errors[`${itemPrefix}.title`] = `Формат ${index + 1}: укажите название от 2 до 160 символов.`;
    if (!(WORK_MODES.includes(mode) || (allowLegacyMode && mode === null))) errors[`${itemPrefix}.mode`] = `Формат ${index + 1}: выберите онлайн, очно или оба варианта.`;
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 1440)) errors[`${itemPrefix}.duration_minutes`] = `Формат ${index + 1}: длительность должна быть целым числом от 1 до 1440 минут.`;
    if (price !== null && (typeof price !== "number" || !validDecimal(price) || price < 0.01 || price > 100_000_000)) errors[`${itemPrefix}.price`] = `Формат ${index + 1}: стоимость должна быть от 0,01 до 100 000 000 и содержать не больше двух знаков после запятой.`;
    if (price === null && currency !== null) errors[`${itemPrefix}.currency`] = `Формат ${index + 1}: без стоимости валюта должна быть пустой.`;
    if (price !== null && (typeof currency !== "string" || !WORK_CURRENCIES.includes(currency))) errors[`${itemPrefix}.currency`] = `Формат ${index + 1}: выберите поддерживаемую валюту.`;
    if (!title.error) {
      const key = title.data.toLocaleLowerCase("ru");
      if (titles.has(key)) errors[`${itemPrefix}.title`] = `Формат ${index + 1}: такой формат уже добавлен.`;
      else titles.set(key, index);
    }
    if (!Object.keys(errors).some((key) => key === itemPrefix || key.startsWith(`${itemPrefix}.`))) {
      data.push({ title: title.data, duration_minutes: duration, mode, price, currency: price === null ? null : currency });
    }
  }
  return result(data, errors);
}

export function workOfferTitles(workOffers) {
  return workOffers.map((offer) => offer.title).filter(Boolean);
}

export function combinedWorkMode(workOffers) {
  const modes = new Set(workOffers.map((offer) => offer.mode).filter((mode) => WORK_MODES.includes(mode)));
  if (modes.has("both") || modes.size > 1) return "both";
  return modes.values().next().value ?? "both";
}
