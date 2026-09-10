const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $("#form");
const list = $("#list");
const listEmpty = $("#list-empty");
const errors = $("#errors");
const previewDialog = $("#preview-dialog");
const currencies = ["RUB", "USD", "EUR", "KZT", "AED", "TRY", "UZS"];
let catalog = { version: 1, specialists: [] };
let selectedId = null;
let persistedIds = new Set();

const transliteration = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function current() { return catalog.specialists.find((item) => item.id === selectedId); }
function field(name) { return form.elements.namedItem(name); }
function value(name) { return String(field(name)?.value || "").trim(); }

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

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function updatePhotoPreview(src, alt = "") {
  const image = $("#photo-preview");
  const placeholder = $("#photo-placeholder");
  if (src) {
    image.src = `${src}?v=${Date.now()}`;
    image.alt = alt;
    image.hidden = false;
    placeholder.hidden = true;
  } else {
    image.removeAttribute("src");
    image.alt = "";
    image.hidden = true;
    placeholder.hidden = false;
  }
}

function renderList() {
  const sorted = [...catalog.specialists].sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", "ru"));
  list.replaceChildren(...sorted.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `specialist-row${item.id === selectedId ? " selected" : ""}`;
    if (item.photo?.src) {
      const image = document.createElement("img");
      image.src = item.photo.src;
      image.alt = "";
      button.append(image);
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

function select(id) {
  selectedId = id;
  const item = current();
  if (!item) return;
  form.hidden = false;
  $("#title").textContent = item.fullName || "Новый специалист";
  for (const name of ["fullName", "specialization", "country", "city", "workMode", "profileSummary", "about"]) field(name).value = item[name] ?? "";
  field("experienceYears").value = item.experienceYears ?? "";
  field("photoSrc").value = item.photo?.src || "";
  field("photoAlt").value = item.photo?.alt || "";
  updatePhotoPreview(item.photo?.src || "", item.photo?.alt || "");
  for (const name of ["phone", "email", "telegram", "whatsapp", "website"]) field(name).value = item.contacts?.[name] || "";
  field("featured").checked = item.featured === true;
  field("publishConsent").checked = item.published === true;
  renderCategories(item.categories || []);
  renderRepeaters(item);
  renderCategorySuggestions();
  errors.className = "";
  errors.textContent = "";
  renderList();
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
    photo: { src: value("photoSrc"), alt: photoAlt },
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

async function save(event) {
  event.preventDefault();
  errors.className = "";
  errors.textContent = "";
  if (!form.reportValidity()) return;
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
    errors.className = "success";
    errors.textContent = "Специалист сохранён и добавлен в каталог.";
  } catch (error) {
    errors.className = "error";
    errors.textContent = error instanceof Error ? error.message : "Не удалось сохранить специалиста.";
  }
}

function newItem() {
  return { id: crypto.randomUUID(), slug: "", fullName: "", photo: { src: "", alt: "" }, specialization: "", categories: [], country: "", city: "", workMode: "both", profileSummary: "", about: "", helpTopics: [], workOffers: [], experienceYears: null, trust: { recommendedByAlAmin: false, verifiedFacts: [] }, contacts: {}, portfolio: [], published: false, featured: false, sortOrder: 0 };
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
    else { form.hidden = true; errors.textContent = ""; renderList(); }
  } catch (error) {
    errors.className = "error";
    errors.textContent = error instanceof Error ? error.message : "Не удалось удалить специалиста.";
  }
};

$("#photo-file").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const slug = ensureSlug();
    errors.className = "working";
    errors.textContent = "Оптимизируем фотографию…";
    const response = await fetch(`/api/photo?slug=${encodeURIComponent(slug)}`, { method: "POST", body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(friendlyErrors(result.errors));
    field("photoSrc").value = result.src;
    if (!value("photoAlt")) field("photoAlt").value = `Фото: ${value("fullName")}`;
    updatePhotoPreview(result.src, value("photoAlt"));
    errors.className = "success";
    errors.textContent = "Фотография готова. Теперь сохраните специалиста.";
  } catch (error) {
    errors.className = "error";
    errors.textContent = error instanceof Error ? error.message : "Не удалось обработать фотографию.";
  } finally { event.target.value = ""; }
};

function previewSection(title, items) {
  if (!items.length) return null;
  const section = document.createElement("section");
  section.className = "preview-section";
  section.append(textElement("h3", "", title));
  const grid = document.createElement("div");
  grid.className = "preview-grid";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.append(textElement("strong", "", item.title));
    if (item.description) card.append(textElement("p", "", item.description));
    grid.append(card);
  });
  section.append(grid);
  return section;
}

function showPreview() {
  try {
    const item = readForm();
    const content = $("#preview-content");
    content.replaceChildren();
    const hero = document.createElement("section");
    hero.className = "preview-hero";
    const visual = document.createElement("div");
    visual.className = "preview-portrait";
    if (item.photo.src) {
      const image = document.createElement("img");
      image.src = `${item.photo.src}?v=${Date.now()}`;
      image.alt = item.photo.alt;
      visual.append(image);
    } else visual.append(textElement("span", "", "Фото"));
    const copy = document.createElement("div");
    copy.append(textElement("p", "preview-label", "Профиль каталога AL-AMIN"));
    copy.append(textElement("h2", "", item.fullName || "Имя специалиста"));
    copy.append(textElement("strong", "preview-specialization", item.specialization || "Специализация"));
    copy.append(textElement("span", "preview-location", [item.city, item.country].filter(Boolean).join(" · ") || "Город · Страна"));
    copy.append(textElement("p", "preview-summary", item.profileSummary || "Короткое описание появится здесь."));
    if (item.categories.length) {
      const categories = document.createElement("div");
      categories.className = "preview-categories";
      item.categories.forEach((category) => categories.append(textElement("span", "", category)));
      copy.append(categories);
    }
    hero.append(visual, copy);
    content.append(hero);
    if (item.about) {
      const about = document.createElement("section");
      about.className = "preview-section";
      about.append(textElement("h3", "", "О специалисте"), textElement("p", "preview-prose", item.about));
      content.append(about);
    }
    const help = previewSection("С чем помогает", item.helpTopics);
    if (help) content.append(help);
    const offers = previewSection("Форматы работы", item.workOffers.map((offer) => ({ title: offer.title, description: [offer.mode === "online" ? "Онлайн" : offer.mode === "offline" ? "Очно" : "Онлайн и очно", offer.durationMinutes ? `${offer.durationMinutes} мин.` : "", offer.price != null ? `${offer.price} ${offer.currency}` : ""].filter(Boolean).join(" · ") })));
    if (offers) content.append(offers);
    const portfolio = previewSection("Кейсы и портфолио", item.portfolio);
    if (portfolio) content.append(portfolio);
    const contactValues = Object.values(item.contacts);
    if (contactValues.length) {
      const contacts = document.createElement("section");
      contacts.className = "preview-section";
      contacts.append(textElement("h3", "", "Прямые контакты"));
      const contactList = document.createElement("div");
      contactList.className = "preview-contacts";
      contactValues.forEach((contact) => contactList.append(textElement("span", "", contact)));
      contacts.append(contactList);
      content.append(contacts);
    }
    previewDialog.showModal();
  } catch (error) {
    errors.className = "error";
    errors.textContent = error instanceof Error ? error.message : "Не удалось открыть предпросмотр.";
  }
}

$("#preview").onclick = showPreview;
$("#close-preview").onclick = () => previewDialog.close();
previewDialog.addEventListener("click", (event) => { if (event.target === previewDialog) previewDialog.close(); });
$("#add-category").onclick = () => { addCategory($("#category-input").value); $("#category-input").value = ""; $("#category-input").focus(); };
$("#category-input").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); $("#add-category").click(); } });
$("#add-help-topic").onclick = () => addHelpTopic();
$("#add-work-offer").onclick = () => addWorkOffer();
$("#add-portfolio-item").onclick = () => addPortfolioItem();
field("fullName").addEventListener("input", () => { $("#title").textContent = value("fullName") || "Новый специалист"; });
form.addEventListener("submit", save);

fetch("/api/catalog").then((response) => response.json()).then((result) => {
  catalog = result;
  persistedIds = new Set(catalog.specialists.map((item) => item.id));
  renderList();
  renderCategorySuggestions();
  if (catalog.specialists[0]) select(catalog.specialists[0].id);
}).catch(() => {
  listEmpty.hidden = false;
  listEmpty.textContent = "Не удалось загрузить список. Обновите страницу.";
});
