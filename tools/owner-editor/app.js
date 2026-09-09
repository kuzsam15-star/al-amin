const $ = (selector) => document.querySelector(selector);
const form = $("#form");
const list = $("#list");
const errors = $("#errors");
let catalog = { version: 1, specialists: [] };
let selectedId = null;

const lines = (value) => String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
const helpTopics = (value) => lines(value).map((line) => {
  const [title, ...description] = line.split("|");
  return { title: title.trim(), description: description.join("|").trim() || undefined };
});
const helpText = (value) => (value || []).map((item) => [item.title, item.description].filter(Boolean).join(" | ")).join("\n");
const jsonValue = (value, fallback = []) => {
  if (!String(value).trim()) return fallback;
  return JSON.parse(value);
};

function current() { return catalog.specialists.find((item) => item.id === selectedId); }
function field(name) { return form.elements.namedItem(name); }
function value(name) { return field(name).value.trim(); }

function renderList() {
  list.replaceChildren(...catalog.specialists.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.id === selectedId ? "selected" : "";
    button.innerHTML = `<strong>${item.fullName || "Без имени"}</strong><span>${item.published ? "Опубликован" : "Черновик"} · ${item.slug || "без slug"}</span>`;
    button.onclick = () => select(item.id);
    return button;
  }));
}

function select(id) {
  selectedId = id;
  const item = current();
  if (!item) return;
  $("#welcome").hidden = true;
  form.hidden = false;
  $("#title").textContent = item.fullName || "Новый специалист";
  for (const name of ["slug","fullName","specialization","country","city","workMode","profileSummary","about","sortOrder"]) field(name).value = item[name] ?? "";
  field("experienceYears").value = item.experienceYears ?? "";
  field("categories").value = (item.categories || []).join("\n");
  field("helpTopics").value = helpText(item.helpTopics);
  field("workOffers").value = JSON.stringify(item.workOffers || [], null, 2);
  field("portfolio").value = JSON.stringify(item.portfolio || [], null, 2);
  field("photoSrc").value = item.photo?.src || "";
  field("photoAlt").value = item.photo?.alt || "";
  $("#photo-preview").src = item.photo?.src || "";
  for (const name of ["phone","email","telegram","whatsapp","website"]) field(name).value = item.contacts?.[name] || "";
  field("recommendedByAlAmin").checked = item.trust?.recommendedByAlAmin === true;
  field("verificationDate").value = item.trust?.verificationDate || "";
  field("verificationSummary").value = item.trust?.verificationSummary || "";
  field("verifiedFacts").value = (item.trust?.verifiedFacts || []).join("\n");
  field("featured").checked = item.featured === true;
  field("published").checked = item.published === true;
  $("#preview").href = `http://127.0.0.1:3000/specialists/${item.slug || ""}/`;
  errors.textContent = "";
  renderList();
}

function readForm() {
  const item = current();
  return {
    ...item,
    slug: value("slug"), fullName: value("fullName"), specialization: value("specialization"),
    country: value("country"), city: value("city"), workMode: value("workMode"),
    categories: lines(value("categories")), profileSummary: value("profileSummary"), about: value("about"),
    experienceYears: value("experienceYears") ? Number(value("experienceYears")) : null,
    sortOrder: Number(value("sortOrder") || 0),
    photo: { src: value("photoSrc"), alt: value("photoAlt") },
    helpTopics: helpTopics(value("helpTopics")),
    workOffers: jsonValue(value("workOffers")),
    portfolio: jsonValue(value("portfolio")),
    contacts: Object.fromEntries(["phone","email","telegram","whatsapp","website"].map((name) => [name, value(name)]).filter(([, entry]) => entry)),
    trust: {
      recommendedByAlAmin: field("recommendedByAlAmin").checked,
      verificationDate: value("verificationDate") || undefined,
      verificationSummary: value("verificationSummary") || undefined,
      verifiedFacts: lines(value("verifiedFacts")),
    },
    featured: field("featured").checked,
    published: field("published").checked,
  };
}

async function save(event) {
  event.preventDefault();
  try {
    const index = catalog.specialists.findIndex((item) => item.id === selectedId);
    catalog.specialists[index] = readForm();
    const response = await fetch("/api/catalog", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(catalog) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.errors.join("\n"));
    errors.className = "success"; errors.textContent = "Сохранено. Проверьте профиль и затем выполните обычный git commit/push.";
    select(selectedId);
  } catch (error) {
    errors.className = "error"; errors.textContent = error.message;
  }
}

async function persistCatalog() {
  const response = await fetch("/api/catalog", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(catalog) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.errors.join("\n"));
}

$("#add").onclick = () => {
  const id = crypto.randomUUID();
  catalog.specialists.push({ id, slug: "", fullName: "", photo: { src: "", alt: "" }, specialization: "", categories: [], country: "", city: "", workMode: "both", profileSummary: "", about: "", helpTopics: [], workOffers: [], experienceYears: null, trust: { recommendedByAlAmin: false, verifiedFacts: [] }, contacts: {}, portfolio: [], published: false, featured: false, sortOrder: catalog.specialists.length });
  select(id);
};

$("#remove").onclick = async () => {
  const item = current();
  if (!item || !confirm(`Удалить ${item.fullName || "черновик"} из JSON? Локальная резервная копия создастся при сохранении.`)) return;
  catalog.specialists = catalog.specialists.filter((entry) => entry.id !== selectedId);
  try {
    await persistCatalog();
    selectedId = catalog.specialists[0]?.id || null;
    if (selectedId) select(selectedId); else { form.hidden = true; $("#welcome").hidden = false; renderList(); }
  } catch (error) {
    errors.className = "error"; errors.textContent = error.message;
  }
};

$("#photo-file").onchange = async (event) => {
  const file = event.target.files?.[0];
  const slug = value("slug");
  if (!file || !slug) return alert("Сначала заполните slug.");
  errors.textContent = "Оптимизируем фотографию…";
  const response = await fetch(`/api/photo?slug=${encodeURIComponent(slug)}`, { method: "POST", body: file });
  const result = await response.json();
  if (!response.ok) return errors.textContent = result.errors.join("\n");
  field("photoSrc").value = result.src;
  $("#photo-preview").src = `${result.src}?${Date.now()}`;
  if (!value("photoAlt") && value("fullName")) field("photoAlt").value = `Фотография ${value("fullName")}`;
  errors.textContent = "Фотография подготовлена. Сохраните карточку.";
};

form.addEventListener("submit", save);
fetch("/api/catalog").then((response) => response.json()).then((value) => {
  catalog = value;
  renderList();
  if (catalog.specialists[0]) select(catalog.specialists[0].id);
});
