const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $("#form");
const homeForm = $("#home-form");
const appShell = $(".app-shell");
const specialistsSidebar = $("#specialists-sidebar");
const submissionsSidebar = $("#submissions-sidebar");
const list = $("#list");
const listEmpty = $("#list-empty");
const errors = $("#errors");
const homeErrors = $("#home-errors");
const currencies = ["RUB", "USD", "EUR", "KZT", "AED", "TRY", "UZS"];
const defaultAvatarCrop = { positionX: 50, positionY: 24, zoom: 1 };
const selectedSpecialistStorageKey = "al-amin-owner-editor:selected-specialist";
let catalog = { version: 1, specialists: [] };
let siteContent = {};
let selectedId = null;
let submissions = [];
let selectedSubmissionId = null;
let reviewSpecialist = null;
let reviewPhotoToken = "";
let approvedProfileUrl = "";
let persistedIds = new Set();
let activeMode = "specialists";
const homeFields = ["tagline", "heroTitle", "heroText", "heroCtaText", "heroAssurance", "contactEmail", "contactTelegram", "contactPhone", "contactWebsite"];
const maxSubmissionFileBytes = 24 * 1024 * 1024;

const transliteration = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function current() { return activeMode === "submissions" ? reviewSpecialist : catalog.specialists.find((item) => item.id === selectedId); }
function field(name) { return form.elements.namedItem(name); }
function value(name) { return String(field(name)?.value || "").trim(); }
function homeField(name) { return homeForm.elements.namedItem(name); }
function homeValue(name) { return String(homeField(name)?.value || "").trim(); }

function setMode(mode) {
  activeMode = ["home", "submissions"].includes(mode) ? mode : "specialists";
  const editingHome = activeMode === "home";
  const reviewingSubmissions = activeMode === "submissions";
  $("#mode-specialists").classList.toggle("selected", activeMode === "specialists");
  $("#mode-submissions").classList.toggle("selected", reviewingSubmissions);
  $("#mode-home").classList.toggle("selected", editingHome);
  $("#mode-specialists").setAttribute("aria-selected", String(activeMode === "specialists"));
  $("#mode-submissions").setAttribute("aria-selected", String(reviewingSubmissions));
  $("#mode-home").setAttribute("aria-selected", String(editingHome));
  specialistsSidebar.hidden = activeMode !== "specialists";
  submissionsSidebar.hidden = !reviewingSubmissions;
  form.hidden = editingHome || !current();
  homeForm.hidden = !editingHome;
  appShell.classList.toggle("home-mode", editingHome);
  appShell.classList.toggle("submissions-mode", reviewingSubmissions);
  if (reviewingSubmissions && selectedSubmissionId) selectSubmission(selectedSubmissionId);
  if (activeMode === "specialists" && selectedId) select(selectedId);
}

function renderHomePreview() {
  $("#home-preview-tagline").textContent = homeValue("tagline") || "Короткая строка над заголовком";
  $("#home-preview-title").textContent = homeValue("heroTitle") || "Главный заголовок";
  $("#home-preview-text").textContent = homeValue("heroText") || "Описание ценности главной страницы.";
  $("#home-preview-cta").textContent = homeValue("heroCtaText") || "Найти специалиста";
  $("#home-preview-assurance").textContent = homeValue("heroAssurance") || "Без регистрации · Прямые контакты";
}

function loadHomeEditor(site) {
  siteContent = site;
  for (const name of homeFields) homeField(name).value = site[name] || "";
  renderHomePreview();
}

function friendlySiteErrors(messages = []) {
  const labels = { tagline: "надзаголовок", heroTitle: "главный заголовок", heroText: "описание", heroCtaText: "текст основной кнопки", heroAssurance: "короткую строку под кнопкой", contactEmail: "email владельца", contactTelegram: "Telegram владельца", contactPhone: "телефон владельца", contactWebsite: "сайт владельца" };
  return [...new Set(messages.map((message) => {
    const fieldName = Object.keys(labels).find((name) => message.includes(`site.${name}`));
    return fieldName ? `Проверьте ${labels[fieldName]}.` : "Не удалось сохранить главную страницу.";
  }))].join("\n");
}

async function persistHome() {
  homeErrors.className = "";
  homeErrors.textContent = "";
  if (!homeForm.reportValidity()) return false;
  const candidate = {
    ...siteContent,
    tagline: homeValue("tagline"),
    heroTitle: homeValue("heroTitle"),
    heroText: homeValue("heroText"),
    heroCtaText: homeValue("heroCtaText"),
    heroAssurance: homeValue("heroAssurance"),
    contactEmail: homeValue("contactEmail"),
    contactTelegram: normalizeTelegram(homeValue("contactTelegram")),
    contactPhone: homeValue("contactPhone"),
    contactWebsite: normalizeWebsite(homeValue("contactWebsite")),
  };
  try {
    const response = await fetch("/api/site", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candidate) });
    const result = await response.json();
    if (!response.ok) throw new Error(friendlySiteErrors(result.errors));
    siteContent = candidate;
    homeField("contactTelegram").value = candidate.contactTelegram;
    homeField("contactWebsite").value = candidate.contactWebsite;
    homeErrors.className = "success";
    homeErrors.textContent = "Главная страница сохранена. Предпросмотр уже обновлён.";
    return true;
  } catch (error) {
    homeErrors.className = "error";
    homeErrors.textContent = error instanceof Error ? error.message : "Не удалось сохранить главную страницу.";
    return false;
  }
}

async function saveHome(event) {
  event.preventDefault();
  await persistHome();
}

async function previewHome() {
  const previewWindow = window.open("", "al-amin-home-preview");
  if (!previewWindow) {
    homeErrors.className = "error";
    homeErrors.textContent = "Разрешите открытие новой вкладки для предпросмотра.";
    return;
  }
  previewWindow.document.title = "Готовим предпросмотр AL-AMIN";
  previewWindow.document.body.textContent = "Готовим актуальную главную страницу…";
  if (!await persistHome()) {
    previewWindow.close();
    return;
  }
  homeErrors.className = "working";
  homeErrors.textContent = "Обновляем локальный сайт…";
  try {
    const response = await fetch("/api/preview-build", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.errors?.[0] || "Не удалось обновить локальный сайт.");
    homeErrors.className = "success";
    homeErrors.textContent = "Сайт обновлён. Предпросмотр открыт в новой вкладке.";
    previewWindow.location.replace(result.url);
  } catch (error) {
    previewWindow.close();
    homeErrors.className = "error";
    homeErrors.textContent = error instanceof Error ? error.message : "Не удалось открыть предпросмотр.";
  }
}

function slugify(input) {
  const transliterated = [...String(input).toLocaleLowerCase("ru")].map((letter) => transliteration[letter] ?? letter).join("");
  return transliterated.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 70);
}

function uniqueSlug(name, id) {
  const fallback = `specialist-${String(id).replace(/[^a-z0-9]/giu, "").slice(0, 8).toLocaleLowerCase()}`;
  const base = slugify(name) || fallback;
  const used = new Set(catalog.specialists.filter((item) => item.id !== id).map((item) => item.slug).filter(Boolean));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function ensureSlug(item = current()) {
  if (!item) throw new Error("Сначала создайте специалиста.");
  if (!item.slug) {
    const name = value("fullName");
    if (!name) throw new Error("Сначала укажите имя специалиста.");
    item.slug = uniqueSlug(name, item.id);
  }
  return item.slug;
}

function normalizeWebsite(input) {
  if (!input) return "";
  return /^https:\/\//iu.test(input) ? input : `https://${input.replace(/^\/+|\/+$/gu, "")}`;
}

function normalizeTelegram(input) {
  if (!input) return "";
  const username = input.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//iu, "").replace(/^@/u, "").split(/[?/#]/u)[0].trim();
  return /^[A-Za-z0-9_]{5,32}$/u.test(username) ? `@${username}` : input;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function normalizeAvatarCrop(value = {}) {
  return {
    positionX: clamp(value.positionX ?? defaultAvatarCrop.positionX, 0, 100),
    positionY: clamp(value.positionY ?? defaultAvatarCrop.positionY, 0, 100),
    zoom: clamp(value.zoom ?? defaultAvatarCrop.zoom, 1, 1.8),
  };
}

function avatarCropFromFields() {
  return normalizeAvatarCrop({
    positionX: field("avatarPositionX").value,
    positionY: field("avatarPositionY").value,
    zoom: field("avatarZoom").value,
  });
}

function applyAvatarCrop(image, cropValue) {
  const crop = normalizeAvatarCrop(cropValue);
  image.style.objectPosition = `${crop.positionX}% ${crop.positionY}%`;
  image.style.transform = `scale(${crop.zoom})`;
  image.style.transformOrigin = `${crop.positionX}% ${crop.positionY}%`;
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function updatePhotoPreview(src, alt = "", cropValue = defaultAvatarCrop) {
  const image = $("#photo-preview");
  const placeholder = $("#photo-placeholder");
  const avatar = $("#avatar-preview");
  const avatarPlaceholder = $("#avatar-placeholder");
  const enabled = Boolean(src);
  if (src) {
    image.src = `${src}?v=${Date.now()}`;
    image.alt = alt;
    image.hidden = false;
    placeholder.hidden = true;
    avatar.src = `${src}?v=${Date.now()}`;
    avatar.alt = alt ? `Круглый аватар: ${alt}` : "";
    applyAvatarCrop(avatar, cropValue);
    avatar.hidden = false;
    avatarPlaceholder.hidden = true;
  } else {
    image.removeAttribute("src");
    image.alt = "";
    image.hidden = true;
    placeholder.hidden = false;
    avatar.removeAttribute("src");
    avatar.alt = "";
    avatar.hidden = true;
    avatarPlaceholder.hidden = false;
  }
  for (const name of ["avatarPositionX", "avatarPositionY", "avatarZoom"]) field(name).disabled = !enabled;
  $("#reset-avatar").disabled = !enabled;
}

function renderList() {
  const sorted = [...catalog.specialists].sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", "ru"));
  list.replaceChildren(...sorted.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `specialist-row${item.id === selectedId ? " selected" : ""}`;
    if (item.photo?.src) {
      const visual = document.createElement("span");
      visual.className = "list-photo";
      const image = document.createElement("img");
      image.src = item.photo.avatarSrc || item.photo.src;
      image.alt = "";
      if (!item.photo.avatarSrc) applyAvatarCrop(image, item.photo.avatar);
      visual.append(image);
      button.append(visual);
    } else {
      button.append(textElement("span", "list-avatar", (item.fullName || "Н").trim().slice(0, 1).toLocaleUpperCase("ru")));
    }
    const copy = document.createElement("span");
    copy.className = "list-copy";
    copy.append(textElement("strong", "", item.fullName || "Новый специалист"));
    copy.append(textElement("small", "", item.specialization || "Специализация не указана"));
    button.append(copy);
    button.onclick = () => select(item.id);
    return button;
  }));
  listEmpty.hidden = sorted.length > 0;
  $("#list-count").textContent = String(sorted.length);
}

const submissionLabels = { new: "Новая", added: "Добавлена в каталог", rejected: "Отклонена" };

function renderSubmissions() {
  const container = $("#submissions-list");
  container.replaceChildren(...submissions.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `specialist-row submission-row${item.id === selectedSubmissionId ? " selected" : ""}`;
    const visual = document.createElement("span");
    visual.className = "list-photo";
    const image = document.createElement("img");
    image.src = item.photoPreviewUrl;
    image.alt = "";
    applyAvatarCrop(image, item.payload?.avatar || defaultAvatarCrop);
    visual.append(image);
    const copy = document.createElement("span");
    copy.className = "list-copy";
    copy.append(textElement("strong", "", item.payload?.fullName || "Без имени"));
    copy.append(textElement("small", `submission-status status-${item.status}`, submissionLabels[item.status] || item.status));
    button.append(visual, copy);
    button.onclick = () => selectSubmission(item.id);
    return button;
  }));
  $("#submissions-empty").hidden = submissions.length > 0;
  $("#submissions-count").textContent = String(submissions.length);
  const newCount = submissions.filter((item) => item.status === "new").length;
  $("#new-submissions-count").hidden = newCount === 0;
  $("#new-submissions-count").textContent = String(newCount);
}

function submissionDraft(item) {
  const payload = item.payload || {};
  return {
    id: item.id,
    slug: catalog.specialists.find((entry) => entry.id === item.id)?.slug || "",
    fullName: payload.fullName || "",
    photo: { src: item.photoPreviewUrl, alt: `Фото: ${payload.fullName || "специалист"}`, avatar: payload.avatar || { ...defaultAvatarCrop } },
    specialization: payload.specialization || "",
    categories: payload.categories || [],
    country: payload.country || "",
    city: payload.city || "",
    workMode: payload.workMode || "both",
    profileSummary: payload.profileSummary || "",
    about: payload.about || "",
    helpTopics: payload.helpTopics || [],
    workOffers: payload.workOffers || [],
    experienceYears: payload.experienceYears ?? null,
    trust: { recommendedByAlAmin: false, verifiedFacts: [] },
    contacts: payload.contacts || {},
    portfolio: payload.portfolio || [],
    published: true,
    featured: false,
    sortOrder: 0,
  };
}

function renderCategorySuggestions() {
  const values = [...new Set(catalog.specialists.flatMap((item) => item.categories || []))].sort((a, b) => a.localeCompare(b, "ru"));
  $("#category-suggestions").replaceChildren(...values.map((item) => {
    const option = document.createElement("option");
    option.value = item;
    return option;
  }));
}

function addCategory(valueToAdd) {
  const normalized = String(valueToAdd || "").normalize("NFC").trim();
  if (!normalized) return;
  const existing = $$("[data-category]", $("#categories")).map((item) => item.dataset.category.toLocaleLowerCase("ru"));
  if (existing.includes(normalized.toLocaleLowerCase("ru"))) return;
  const chip = document.createElement("span");
  chip.className = "category-chip";
  chip.dataset.category = normalized;
  chip.append(textElement("span", "", normalized));
  const remove = textElement("button", "", "Удалить");
  remove.type = "button";
  remove.setAttribute("aria-label", `Удалить категорию ${normalized}`);
  remove.onclick = () => chip.remove();
  chip.append(remove);
  $("#categories").append(chip);
}

function renderCategories(values = []) {
  $("#categories").replaceChildren();
  values.forEach(addCategory);
}

function renumberCards(container, label) {
  $$(".repeater-card", container).forEach((card, index) => { $("h3", card).textContent = `${label} №${index + 1}`; });
}

function removableCard(container, label, markup) {
  const card = document.createElement("article");
  card.className = "repeater-card";
  card.innerHTML = `<div class="repeater-head"><h3></h3><button type="button" class="remove-row">Удалить</button></div>${markup}`;
  $(".remove-row", card).onclick = () => { card.remove(); renumberCards(container, label); };
  container.append(card);
  renumberCards(container, label);
  return card;
}

function addHelpTopic(item = {}) {
  const container = $("#help-topics");
  const card = removableCard(container, "Направление", `<div class="grid"><label>Название<input data-help-title maxlength="140" placeholder="Например, сложные семейные ситуации"></label><label class="wide">Описание<textarea data-help-description maxlength="300" placeholder="Коротко объясните, какую помощь получит клиент"></textarea></label></div>`);
  $("[data-help-title]", card).value = item.title || "";
  $("[data-help-description]", card).value = item.description || "";
}

function addWorkOffer(item = {}) {
  const container = $("#work-offers");
  const currencyOptions = currencies.map((currency) => `<option value="${currency}">${currency === "RUB" ? "₽ · " : ""}${currency}</option>`).join("");
  const card = removableCard(container, "Формат работы", `<div class="grid"><label class="wide">Название<input data-offer-title maxlength="160" placeholder="Например, индивидуальная консультация"></label><label>Длительность, минут<input data-offer-duration type="number" min="1" max="1440" inputmode="numeric" placeholder="60"></label><label>Формат<select data-offer-mode><option value="online">Онлайн</option><option value="offline">Очно</option><option value="both">Онлайн и очно</option></select></label><label>Цена<input data-offer-price type="number" min="0" step="0.01" inputmode="decimal" placeholder="5000"></label><label>Валюта<select data-offer-currency>${currencyOptions}</select></label></div>`);
  $("[data-offer-title]", card).value = item.title || "";
  $("[data-offer-duration]", card).value = item.durationMinutes ?? "";
  $("[data-offer-mode]", card).value = item.mode || "online";
  $("[data-offer-price]", card).value = item.price ?? "";
  $("[data-offer-currency]", card).value = item.currency || "RUB";
}

function addPortfolioItem(item = {}) {
  const container = $("#portfolio-items");
  const card = removableCard(container, "Материал", `<div class="grid"><label class="wide">Название<input data-portfolio-title maxlength="160" placeholder="Название кейса или материала"></label><label class="wide">Описание<textarea data-portfolio-description maxlength="500" placeholder="Короткий контекст"></textarea></label><label class="wide">Ссылка<input data-portfolio-url inputmode="url" placeholder="https://example.com"></label></div>`);
  $("[data-portfolio-title]", card).value = item.title || "";
  $("[data-portfolio-description]", card).value = item.description || "";
  $("[data-portfolio-url]", card).value = item.url || "";
}

function renderRepeaters(item) {
  $("#help-topics").replaceChildren();
  (item.helpTopics || []).forEach(addHelpTopic);
  $("#work-offers").replaceChildren();
  (item.workOffers || []).forEach(addWorkOffer);
  $("#portfolio-items").replaceChildren();
  (item.portfolio || []).forEach(addPortfolioItem);
}

function populateForm(item) {
  if (!item) return;
  form.hidden = false;
  $("#title").textContent = item.fullName || "Новый специалист";
  for (const name of ["fullName", "specialization", "country", "city", "workMode", "profileSummary", "about"]) field(name).value = item[name] ?? "";
  field("experienceYears").value = item.experienceYears ?? "";
  field("photoSrc").value = item.photo?.src || "";
  field("photoAlt").value = item.photo?.alt || "";
  const avatar = normalizeAvatarCrop(item.photo?.avatar);
  field("avatarPositionX").value = String(avatar.positionX);
  field("avatarPositionY").value = String(avatar.positionY);
  field("avatarZoom").value = String(avatar.zoom);
  updatePhotoPreview(item.photo?.src || "", item.photo?.alt || "", avatar);
  for (const name of ["phone", "email", "telegram", "whatsapp", "website"]) field(name).value = item.contacts?.[name] || "";
  field("featured").checked = item.featured === true;
  field("publishConsent").checked = item.published === true;
  renderCategories(item.categories || []);
  renderRepeaters(item);
  renderCategorySuggestions();
  errors.className = "";
  errors.textContent = "";
}

function configureFormContext(kind, submission = null) {
  const reviewing = kind === "submission";
  $("#form-eyebrow").textContent = reviewing ? "Проверка заявки" : "Профиль специалиста";
  $("#submission-meta").hidden = !reviewing;
  $("#preview").hidden = reviewing;
  $("#remove").hidden = reviewing;
  $("#reject-submission").hidden = !reviewing || submission?.status !== "new";
  $("#approve-submission").hidden = !reviewing || submission?.status !== "new";
  $("#open-approved").hidden = !reviewing || submission?.status !== "added";
  $("#save-specialist").hidden = reviewing;
  $$('.actions button[type="submit"]', form).forEach((button) => { button.hidden = reviewing; });
  if (reviewing && submission) {
    const created = submission.createdAt ? new Date(submission.createdAt).toLocaleString("ru-RU") : "—";
    $("#submission-meta").textContent = `${submissionLabels[submission.status] || submission.status} · Получена ${created}`;
    approvedProfileUrl = catalog.specialists.find((item) => item.id === submission.id)?.slug
      ? new URL(`specialists/${catalog.specialists.find((item) => item.id === submission.id).slug}/`, window.location.origin.replace(/:4173$/u, ":3000")).href
      : "";
  }
}

function select(id) {
  selectedId = id;
  const item = catalog.specialists.find((entry) => entry.id === selectedId);
  if (!item) return;
  try { localStorage.setItem(selectedSpecialistStorageKey, id); } catch {}
  configureFormContext("specialist");
  populateForm(item);
  renderList();
}

function selectSubmission(id) {
  selectedSubmissionId = id;
  const submission = submissions.find((item) => item.id === id);
  if (!submission) return;
  reviewSpecialist = submissionDraft(submission);
  reviewPhotoToken = "";
  configureFormContext("submission", submission);
  populateForm(reviewSpecialist);
  renderSubmissions();
}

function collectHelpTopics() {
  return $$(".repeater-card", $("#help-topics")).map((card) => ({ title: $("[data-help-title]", card).value.trim(), description: $("[data-help-description]", card).value.trim() || undefined })).filter((item) => item.title);
}

function collectWorkOffers() {
  return $$(".repeater-card", $("#work-offers")).map((card) => {
    const priceText = $("[data-offer-price]", card).value.trim();
    const durationText = $("[data-offer-duration]", card).value.trim();
    return { title: $("[data-offer-title]", card).value.trim(), durationMinutes: durationText ? Number(durationText) : null, mode: $("[data-offer-mode]", card).value, price: priceText ? Number(priceText) : null, currency: priceText ? $("[data-offer-currency]", card).value : null };
  }).filter((item) => item.title);
}

function collectPortfolio() {
  return $$(".repeater-card", $("#portfolio-items")).map((card) => {
    const rawUrl = $("[data-portfolio-url]", card).value.trim();
    return { title: $("[data-portfolio-title]", card).value.trim(), description: $("[data-portfolio-description]", card).value.trim() || undefined, url: rawUrl ? normalizeWebsite(rawUrl) : undefined };
  }).filter((item) => item.title);
}

function readForm() {
  const previous = current();
  if (!previous) throw new Error("Сначала создайте специалиста.");
  const fullName = value("fullName");
  const slug = previous.slug || uniqueSlug(fullName, previous.id);
  const previousAutomaticAlt = previous.fullName ? `Фото: ${previous.fullName}` : "";
  const photoAlt = !value("photoAlt") || value("photoAlt") === previousAutomaticAlt ? (fullName ? `Фото: ${fullName}` : "") : value("photoAlt");
  return {
    ...previous,
    slug,
    fullName,
    specialization: value("specialization"),
    country: value("country"),
    city: value("city"),
    workMode: value("workMode"),
    categories: $$("[data-category]", $("#categories")).map((item) => item.dataset.category),
    profileSummary: value("profileSummary"),
    about: value("about"),
    experienceYears: value("experienceYears") ? Number(value("experienceYears")) : null,
    sortOrder: 0,
    photo: { ...(previous.photo || {}), src: value("photoSrc"), alt: photoAlt, avatar: avatarCropFromFields() },
    helpTopics: collectHelpTopics(),
    workOffers: collectWorkOffers(),
    portfolio: collectPortfolio(),
    contacts: Object.fromEntries([["phone", value("phone")], ["email", value("email")], ["telegram", normalizeTelegram(value("telegram"))], ["whatsapp", value("whatsapp")], ["website", normalizeWebsite(value("website"))]].filter(([, entry]) => entry)),
    trust: previous.trust || { recommendedByAlAmin: false, verifiedFacts: [] },
    featured: field("featured").checked,
    published: field("publishConsent").checked,
  };
}

function friendlyErrors(messages = []) {
  return [...new Set(messages.map((message) => {
    if (message.includes(".slug")) return "Не удалось создать уникальный адрес профиля. Попробуйте уточнить имя.";
    if (message.includes(".photo")) return "Добавьте фотографию специалиста.";
    if (message.includes(".categories")) return "Добавьте хотя бы одну категорию.";
    if (message.includes(".fullName")) return "Укажите имя специалиста.";
    if (message.includes(".specialization")) return "Укажите профессию или специализацию.";
    if (message.includes(".country")) return "Укажите страну.";
    if (message.includes(".city")) return "Укажите город.";
    if (message.includes(".profileSummary")) return "Добавьте короткое описание.";
    if (message.includes(".about")) return "Добавьте полное описание.";
    if (message.includes(".workOffers") && message.includes("currency")) return "Для формата работы с ценой выберите валюту.";
    if (message.includes("разрешён только https URL")) return "Ссылки должны начинаться с https://";
    return message.replace(/^specialists\.\d+\./u, "");
  }))].join("\n");
}

async function persistCatalog() {
  const response = await fetch("/api/catalog", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(catalog) });
  const result = await response.json();
  if (!response.ok) throw new Error(friendlyErrors(result.errors));
}

async function rebuildStaticPreview() {
  const response = await fetch("/api/preview-build", { method: "POST" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.errors?.[0] || "Не удалось обновить локальный сайт.");
  return result.url;
}

async function persistSpecialist() {
  errors.className = "";
  errors.textContent = "";
  if (!form.reportValidity()) return null;
  try {
    const item = readForm();
    if (!item.photo.src) throw new Error("Добавьте фотографию специалиста.");
    if (!item.categories.length) throw new Error("Добавьте хотя бы одну категорию.");
    const index = catalog.specialists.findIndex((entry) => entry.id === selectedId);
    catalog.specialists[index] = item;
    catalog.specialists.sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
    catalog.specialists.forEach((entry) => { entry.sortOrder = 0; });
    await persistCatalog();
    persistedIds.add(selectedId);
    field("photoAlt").value = item.photo.alt;
    $("#title").textContent = item.fullName;
    renderList();
    renderCategorySuggestions();
    errors.className = "working";
    errors.textContent = "Специалист сохранён. Обновляем локальный сайт…";
    const previewUrl = await rebuildStaticPreview();
    errors.className = "success";
    errors.textContent = "Специалист сохранён. Локальный сайт обновлён.";
    return { item, previewUrl };
  } catch (error) {
    errors.className = "error";
    errors.textContent = error instanceof Error ? error.message : "Не удалось сохранить специалиста.";
    return null;
  }
}

async function save(event) {
  event.preventDefault();
  if (activeMode === "submissions") {
    errors.className = "error";
    errors.textContent = "Используйте кнопку «Одобрить и добавить в каталог», чтобы завершить проверку заявки.";
    return;
  }
  await persistSpecialist();
}

function newItem() {
  return { id: crypto.randomUUID(), slug: "", fullName: "", photo: { src: "", alt: "", avatar: { ...defaultAvatarCrop } }, specialization: "", categories: [], country: "", city: "", workMode: "both", profileSummary: "", about: "", helpTopics: [], workOffers: [], experienceYears: null, trust: { recommendedByAlAmin: false, verifiedFacts: [] }, contacts: {}, portfolio: [], published: false, featured: false, sortOrder: 0 };
}

$("#add").onclick = () => {
  const active = current();
  if (active && !persistedIds.has(active.id)) {
    errors.className = "error";
    errors.textContent = "Сначала сохраните или удалите нового специалиста.";
    return;
  }
  const item = newItem();
  catalog.specialists.push(item);
  select(item.id);
  field("fullName").focus();
};

$("#remove").onclick = async () => {
  const item = current();
  if (!item || !confirm(`Удалить «${item.fullName || "Новый специалист"}» из каталога?`)) return;
  catalog.specialists = catalog.specialists.filter((entry) => entry.id !== selectedId);
  try {
    if (persistedIds.has(selectedId)) await persistCatalog();
    persistedIds.delete(selectedId);
    selectedId = catalog.specialists[0]?.id || null;
    if (selectedId) select(selectedId);
    else {
      try { localStorage.removeItem(selectedSpecialistStorageKey); } catch {}
      form.hidden = true;
      errors.textContent = "";
      renderList();
    }
  } catch (error) {
    errors.className = "error";
    errors.textContent = error instanceof Error ? error.message : "Не удалось удалить специалиста.";
  }
};

$("#photo-file").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error("Фотография должна быть не больше 8 МБ.");
    if (activeMode === "submissions") {
      errors.className = "working";
      errors.textContent = "Готовим фотографию для проверки…";
      const response = await fetch(`/api/submissions/${encodeURIComponent(selectedSubmissionId)}/replacement-photo`, { method: "POST", body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(friendlyErrors(result.errors));
      reviewPhotoToken = result.token;
      field("photoSrc").value = result.previewUrl;
      if (!value("photoAlt")) field("photoAlt").value = `Фото: ${value("fullName")}`;
      updatePhotoPreview(result.previewUrl, value("photoAlt"), avatarCropFromFields());
      errors.className = "success";
      errors.textContent = "Новая фотография готова. Она попадёт в каталог только после одобрения.";
      return;
    }
    const slug = ensureSlug();
    errors.className = "working";
    errors.textContent = "Оптимизируем фотографию…";
    const response = await fetch(`/api/photo?slug=${encodeURIComponent(slug)}`, { method: "POST", body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(friendlyErrors(result.errors));
    field("photoSrc").value = result.src;
    if (!value("photoAlt")) field("photoAlt").value = `Фото: ${value("fullName")}`;
    updatePhotoPreview(result.src, value("photoAlt"), avatarCropFromFields());
    errors.className = "success";
    errors.textContent = "Фотография готова. Теперь сохраните специалиста.";
  } catch (error) {
    errors.className = "error";
    errors.textContent = error instanceof Error ? error.message : "Не удалось обработать фотографию.";
  } finally { event.target.value = ""; }
};

async function refreshSubmissionData() {
  const [catalogResult, submissionResult] = await Promise.all([
    fetch("/api/catalog").then((response) => response.json()),
    fetch("/api/submissions").then((response) => response.json()),
  ]);
  catalog = catalogResult;
  persistedIds = new Set(catalog.specialists.map((item) => item.id));
  submissions = submissionResult.submissions || [];
  renderList();
  renderSubmissions();
}

$("#approve-submission").onclick = async () => {
  const submission = submissions.find((item) => item.id === selectedSubmissionId);
  if (!submission || submission.status !== "new") return;
  errors.className = "";
  errors.textContent = "";
  if (!form.reportValidity()) return;
  try {
    const specialist = { ...readForm(), reviewPhotoToken };
    if (!specialist.categories.length) throw new Error("Добавьте хотя бы одну категорию.");
    errors.className = "working";
    errors.textContent = "Проверяем данные, создаём WebP и обновляем локальный каталог…";
    const response = await fetch(`/api/submissions/${encodeURIComponent(submission.id)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(specialist) });
    const result = await response.json();
    if (!response.ok) throw new Error(friendlyErrors(result.errors));
    approvedProfileUrl = result.profileUrl;
    await refreshSubmissionData();
    selectSubmission(submission.id);
    errors.className = "success";
    errors.textContent = "Специалист добавлен в локальный каталог. Профиль и локальная сборка готовы.";
    if (result.imageOutput?.warning) errors.textContent += ` ${result.imageOutput.warning}`;
  } catch (error) {
    errors.className = "error";
    errors.textContent = error instanceof Error ? error.message : "Не удалось добавить заявку в каталог.";
  }
};

$("#reject-submission").onclick = async () => {
  const submission = submissions.find((item) => item.id === selectedSubmissionId);
  if (!submission || submission.status !== "new" || !confirm(`Отклонить заявку «${submission.payload?.fullName || "Без имени"}»?`)) return;
  try {
    const response = await fetch(`/api/submissions/${encodeURIComponent(submission.id)}/reject`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.errors?.[0] || "Не удалось отклонить заявку.");
    await refreshSubmissionData();
    selectSubmission(submission.id);
    errors.className = "success";
    errors.textContent = "Заявка отклонена. Данные не публиковались.";
  } catch (error) {
    errors.className = "error";
    errors.textContent = error instanceof Error ? error.message : "Не удалось отклонить заявку.";
  }
};

$("#open-approved").onclick = () => {
  if (!approvedProfileUrl) {
    const item = catalog.specialists.find((entry) => entry.id === selectedSubmissionId);
    if (item) approvedProfileUrl = `${window.location.origin.replace(/:4173$/u, ":3000")}/specialists/${encodeURIComponent(item.slug)}/`;
  }
  if (approvedProfileUrl) window.open(approvedProfileUrl, "_blank", "noopener");
};

function refreshAvatarPreview() {
  const image = $("#avatar-preview");
  if (!image.hidden) applyAvatarCrop(image, avatarCropFromFields());
}

for (const name of ["avatarPositionX", "avatarPositionY", "avatarZoom"]) {
  field(name).addEventListener("input", refreshAvatarPreview);
}

$("#reset-avatar").onclick = () => {
  field("avatarPositionX").value = String(defaultAvatarCrop.positionX);
  field("avatarPositionY").value = String(defaultAvatarCrop.positionY);
  field("avatarZoom").value = String(defaultAvatarCrop.zoom);
  refreshAvatarPreview();
};

let avatarDrag = null;
$("#avatar-frame").addEventListener("pointerdown", (event) => {
  if ($("#avatar-preview").hidden) return;
  event.preventDefault();
  const crop = avatarCropFromFields();
  avatarDrag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, positionX: crop.positionX, positionY: crop.positionY, zoom: crop.zoom };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add("dragging");
});

$("#avatar-frame").addEventListener("pointermove", (event) => {
  if (!avatarDrag || avatarDrag.pointerId !== event.pointerId) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const scale = 100 / Math.max(bounds.width, 1) / avatarDrag.zoom;
  field("avatarPositionX").value = String(Math.round(clamp(avatarDrag.positionX - (event.clientX - avatarDrag.clientX) * scale, 0, 100)));
  field("avatarPositionY").value = String(Math.round(clamp(avatarDrag.positionY - (event.clientY - avatarDrag.clientY) * scale, 0, 100)));
  refreshAvatarPreview();
});

function finishAvatarDrag(event) {
  if (!avatarDrag || avatarDrag.pointerId !== event.pointerId) return;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  avatarDrag = null;
  event.currentTarget.classList.remove("dragging");
}

$("#avatar-frame").addEventListener("pointerup", finishAvatarDrag);
$("#avatar-frame").addEventListener("pointercancel", finishAvatarDrag);

async function showPreview() {
  const previewWindow = window.open("", "al-amin-specialist-preview");
  if (!previewWindow) {
    errors.className = "error";
    errors.textContent = "Разрешите открытие новой вкладки для предпросмотра.";
    return;
  }
  previewWindow.document.title = "Готовим профиль AL-AMIN";
  previewWindow.document.body.textContent = "Сохраняем специалиста и обновляем публичный профиль…";
  const result = await persistSpecialist();
  if (!result) {
    previewWindow.close();
    return;
  }
  const profileUrl = new URL("specialists/" + encodeURIComponent(result.item.slug) + "/", result.previewUrl).href;
  errors.className = "success";
  errors.textContent = "Публичный профиль обновлён и открыт в новой вкладке.";
  previewWindow.location.replace(profileUrl);
}

$("#preview").onclick = showPreview;
$("#add-category").onclick = () => { addCategory($("#category-input").value); $("#category-input").value = ""; $("#category-input").focus(); };
$("#category-input").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); $("#add-category").click(); } });
$("#add-help-topic").onclick = () => addHelpTopic();
$("#add-work-offer").onclick = () => addWorkOffer();
$("#add-portfolio-item").onclick = () => addPortfolioItem();
field("fullName").addEventListener("input", () => { $("#title").textContent = value("fullName") || "Новый специалист"; });
form.addEventListener("submit", save);
homeForm.addEventListener("submit", saveHome);
for (const name of ["tagline", "heroTitle", "heroText", "heroCtaText", "heroAssurance"]) homeField(name).addEventListener("input", renderHomePreview);
$("#home-preview-open").onclick = previewHome;
$("#mode-specialists").onclick = () => setMode("specialists");
$("#mode-submissions").onclick = () => setMode("submissions");
$("#mode-home").onclick = () => setMode("home");

async function importSubmissionFile(file) {
  const status = $("#import-status");
  status.className = "import-status";
  status.textContent = "";
  if (!file) return;
  if (!/\.(?:alamin|alamin\.json)$/iu.test(file.name)) {
    status.className = "import-status error";
    status.textContent = "Выберите файл .alamin или .alamin.json.";
    return;
  }
  if (file.size > maxSubmissionFileBytes) {
    status.className = "import-status error";
    status.textContent = "Файл заявки должен быть не больше 24 МиБ.";
    return;
  }
  status.textContent = "Проверяем файл и фотографию…";
  try {
    const response = await fetch("/api/submissions/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.arrayBuffer() });
    const result = await response.json();
    if (!response.ok) throw new Error(friendlyErrors(result.errors));
    await refreshSubmissionData();
    selectedSubmissionId = result.id;
    setMode("submissions");
    selectSubmission(result.id);
    status.className = "import-status success";
    status.textContent = result.message || (result.duplicate ? "Заявка уже была импортирована." : "Заявка импортирована локально.");
  } catch (error) {
    status.className = "import-status error";
    status.textContent = error instanceof Error ? error.message : "Не удалось импортировать заявку.";
  } finally {
    $("#submission-file").value = "";
  }
}

$("#submission-file").addEventListener("change", (event) => importSubmissionFile(event.target.files?.[0]));
const submissionDropzone = $("#submission-dropzone");
submissionDropzone.addEventListener("click", () => $("#submission-file").click());
submissionDropzone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("#submission-file").click(); } });
for (const eventName of ["dragenter", "dragover"]) submissionDropzone.addEventListener(eventName, (event) => { event.preventDefault(); submissionDropzone.classList.add("dragging"); });
for (const eventName of ["dragleave", "drop"]) submissionDropzone.addEventListener(eventName, (event) => { event.preventDefault(); submissionDropzone.classList.remove("dragging"); });
submissionDropzone.addEventListener("drop", (event) => importSubmissionFile(event.dataTransfer?.files?.[0]));

Promise.all([fetch("/api/catalog").then((response) => response.json()), fetch("/api/site").then((response) => response.json()), fetch("/api/submissions").then((response) => response.json())]).then(([catalogResult, siteResult, submissionResult]) => {
  catalog = catalogResult;
  submissions = submissionResult.submissions || [];
  loadHomeEditor(siteResult);
  persistedIds = new Set(catalog.specialists.map((item) => item.id));
  renderList();
  renderSubmissions();
  renderCategorySuggestions();
  let rememberedId = null;
  try { rememberedId = localStorage.getItem(selectedSpecialistStorageKey); } catch {}
  const initialId = catalog.specialists.some((item) => item.id === rememberedId) ? rememberedId : catalog.specialists[0]?.id;
  if (initialId) select(initialId);
  const initialParameters = new URLSearchParams(window.location.search);
  const requestedMode = initialParameters.get("mode");
  const requestedSubmission = initialParameters.get("submission");
  if (requestedMode === "submissions") {
    const initialSubmission = submissions.some((item) => item.id === requestedSubmission) ? requestedSubmission : submissions[0]?.id;
    if (initialSubmission) selectSubmission(initialSubmission);
    setMode("submissions");
  } else if (requestedMode === "home") setMode("home");
  else setMode("specialists");
}).catch(() => {
  listEmpty.hidden = false;
  listEmpty.textContent = "Не удалось загрузить список. Обновите страницу.";
  homeErrors.className = "error";
  homeErrors.textContent = "Не удалось загрузить главную страницу. Обновите страницу.";
});
