import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogSubmissionDraftStorageKey,
  clearCatalogSubmissionDraftStorage,
  createEmptyCatalogSubmissionDraft,
  hasMeaningfulCatalogSubmissionDraft,
  parseCatalogSubmissionDraft,
  serializeCatalogSubmissionDraft,
  syncCatalogSubmissionDraftStorage,
} from "../src/lib/catalog-submission-draft.mjs";
import {
  createAlaminSubmissionPackage,
  validateAlaminSubmissionPackage,
} from "../src/lib/alamin-submission-file.mjs";
import {
  catalogSubmissionConsent,
  catalogSubmissionContractVersion,
} from "../src/lib/catalog-submission-contract.mjs";
import { categoryTaxonomyVersion, getCategoryLabels } from "../src/lib/category-registry.mjs";

test("candidate draft preserves Russian multiline text and all serializable form sections", () => {
  const draft = createEmptyCatalogSubmissionDraft();
  draft.fields = {
    ...draft.fields,
    fullName: "Айша Тестова",
    specialization: "Семейный консультант",
    country: "Россия",
    city: "Казань",
    experienceYears: "8",
    profileSummary: "Помогаю спокойно разобраться в ситуации.",
    about: "Первая строка.\n\nВторая строка после вставки.\nПродолжение после Enter.",
    telegram: "@qa_candidate",
    consent: true,
  };
  draft.categoryIds = ["psychology-002"];
  draft.missingCategoryRequest = "Нужна более узкая семейная специализация";
  draft.helpTopics = [{ title: "Сложный разговор", description: "Подготовка к разговору" }];
  draft.workOffers = [{ title: "Консультация", mode: "online", durationMinutes: "60", price: "", currency: "RUB" }];
  draft.portfolio = [{ title: "Материал", description: "Описание", url: "https://example.com" }];
  draft.profileCrop = { positionX: 29, positionY: 72, zoom: 1.16 };
  draft.avatar = { positionX: 61, positionY: 37, zoom: 1.24 };
  draft.photoWasSelected = true;

  const restored = parseCatalogSubmissionDraft(serializeCatalogSubmissionDraft(draft, "2026-09-27T00:00:00.000Z"));
  assert.deepEqual(restored, draft);
  assert.equal(hasMeaningfulCatalogSubmissionDraft(restored), true);
  assert.match(restored.fields.about, /\n\n/u);
  assert.equal(catalogSubmissionDraftStorageKey, "alamin.catalog-submission-draft.v1");
});

test("empty, corrupt and unsupported drafts fail closed", () => {
  const empty = createEmptyCatalogSubmissionDraft();
  assert.equal(hasMeaningfulCatalogSubmissionDraft(empty), false);
  assert.equal(empty.fields.profileSummary, "");
  assert.deepEqual(empty.helpTopics, []);
  assert.equal(parseCatalogSubmissionDraft("not json"), null);
  assert.equal(parseCatalogSubmissionDraft(JSON.stringify({ marker: "AL-AMIN-CATALOG-SUBMISSION-DRAFT", version: 99 })), null);
});

test("restored draft can be cancelled, cleared and replaced by a new autosaved application", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const oldDraft = createEmptyCatalogSubmissionDraft();
  oldDraft.fields.fullName = "Старая заявка";
  oldDraft.fields.profileSummary = "Скрытое legacy-описание";
  oldDraft.categoryIds = ["psychology-002"];
  oldDraft.helpTopics = [{ title: "Старое направление", description: "Старое описание" }];
  oldDraft.workOffers = [{ title: "Старая услуга", mode: "online", durationMinutes: "60", price: "1000", currency: "RUB" }];
  oldDraft.portfolio = [{ title: "Старый материал", description: "Описание", url: "https://example.com" }];
  oldDraft.profileCrop = { positionX: 20, positionY: 80, zoom: 3 };
  oldDraft.avatar = { positionX: 70, positionY: 30, zoom: 4 };
  oldDraft.photoWasSelected = true;

  assert.equal(syncCatalogSubmissionDraftStorage(storage, oldDraft), "saved");
  assert.equal(parseCatalogSubmissionDraft(storage.getItem(catalogSubmissionDraftStorageKey)).fields.fullName, "Старая заявка");
  assert.equal(parseCatalogSubmissionDraft(storage.getItem(catalogSubmissionDraftStorageKey)).fields.profileSummary, "Скрытое legacy-описание");

  // Cancel leaves the stored draft untouched.
  assert.equal(parseCatalogSubmissionDraft(storage.getItem(catalogSubmissionDraftStorageKey)).fields.fullName, "Старая заявка");

  clearCatalogSubmissionDraftStorage(storage);
  const reset = createEmptyCatalogSubmissionDraft();
  assert.equal(syncCatalogSubmissionDraftStorage(storage, reset), "removed");
  assert.equal(storage.getItem(catalogSubmissionDraftStorageKey), null);
  assert.equal(reset.fields.profileSummary, "");
  assert.deepEqual(reset.categoryIds, []);
  assert.deepEqual(reset.helpTopics, []);
  assert.deepEqual(reset.workOffers, [{ title: "", mode: "online", durationMinutes: "", price: "", currency: "RUB" }]);
  assert.deepEqual(reset.portfolio, []);
  assert.deepEqual(reset.profileCrop, { positionX: 50, positionY: 50, zoom: 1 });
  assert.deepEqual(reset.avatar, { positionX: 50, positionY: 24, zoom: 1 });
  assert.equal(reset.photoWasSelected, false);

  reset.fields.fullName = "Новая заявка";
  assert.equal(syncCatalogSubmissionDraftStorage(storage, reset), "saved");
  const nextRestored = parseCatalogSubmissionDraft(storage.getItem(catalogSubmissionDraftStorageKey));
  assert.equal(nextRestored.fields.fullName, "Новая заявка");
  assert.equal(nextRestored.fields.profileSummary, "");
  assert.deepEqual(nextRestored.helpTopics, []);
  assert.deepEqual(nextRestored.portfolio, []);
});

test("restored draft is bounded and never contains a photo payload", () => {
  const value = JSON.parse(serializeCatalogSubmissionDraft(createEmptyCatalogSubmissionDraft()));
  value.fields.about = "я".repeat(4000);
  value.categoryIds = Array.from({ length: 20 }, (_, index) => `school-${String(index + 1).padStart(3, "0")}`);
  value.photo = { data: "base64-is-not-allowed-in-draft" };
  value.profileCrop = { positionX: 900, positionY: -10, zoom: 50 };
  value.avatar = { positionX: -10, positionY: 900, zoom: 50 };
  const restored = parseCatalogSubmissionDraft(JSON.stringify(value));
  assert.equal(Array.from(restored.fields.about).length, 3000);
  assert.equal(restored.categoryIds.length, 8);
  assert.deepEqual(restored.profileCrop, { positionX: 100, positionY: 0, zoom: 8 });
  assert.deepEqual(restored.avatar, { positionX: 0, positionY: 100, zoom: 8 });
  assert.equal("photo" in restored, false);
});

test("restored draft can be edited and the exported package uses the latest values", () => {
  const original = createEmptyCatalogSubmissionDraft();
  original.fields = {
    ...original.fields,
    fullName: "Айша Тестова",
    specialization: "Семейный консультант",
    country: "Россия",
    city: "Казань",
    experienceYears: "8",
    profileSummary: "Старая версия краткого описания.",
    about: "Старая версия подробного описания.",
    telegram: "@qa_candidate",
    consent: true,
  };
  original.categoryIds = ["psychology-002"];
  original.helpTopics = [{ title: "Сложный разговор", description: "Подготовка к разговору" }];
  original.workOffers = [{ title: "Консультация", mode: "online", durationMinutes: "60", price: "", currency: "RUB" }];
  original.photoWasSelected = true;

  const restored = parseCatalogSubmissionDraft(serializeCatalogSubmissionDraft(original));
  restored.fields.profileSummary = "Актуальная версия после восстановления.";
  restored.fields.about = "Первая строка после reload.\nВторая строка после paste и Enter.";

  const payload = {
    contractVersion: catalogSubmissionContractVersion,
    fullName: restored.fields.fullName,
    specialization: restored.fields.specialization,
    country: restored.fields.country,
    city: restored.fields.city,
    workMode: restored.fields.workMode,
    experienceYears: restored.fields.experienceYears,
    profileSummary: restored.fields.profileSummary,
    about: restored.fields.about,
    taxonomyVersion: restored.taxonomyVersion,
    categoryIds: restored.categoryIds,
    categories: getCategoryLabels(restored.categoryIds),
    missingCategoryRequest: restored.missingCategoryRequest,
    helpTopics: restored.helpTopics,
    workOffers: restored.workOffers,
    contacts: {
      phone: restored.fields.phone,
      email: restored.fields.email,
      telegram: restored.fields.telegram,
      whatsapp: restored.fields.whatsapp,
      website: restored.fields.website,
    },
    portfolio: restored.portfolio,
    profileCrop: restored.profileCrop,
    avatar: restored.avatar,
    photo: { originalName: "qa.png", contentType: "image/png", size: 3 },
    consent: restored.fields.consent,
    consentText: catalogSubmissionConsent,
  };
  const submissionPackage = createAlaminSubmissionPackage({
    packageId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-09-27T12:00:00.000Z",
    payload,
    attachment: { filename: "qa.png", mediaType: "image/png", data: "AQID" },
  });
  const validation = validateAlaminSubmissionPackage(submissionPackage);

  assert.deepEqual(validation.errors, []);
  assert.equal(validation.data.payload.profileSummary, "Актуальная версия после восстановления.");
  assert.equal(validation.data.payload.about, "Первая строка после reload.\nВторая строка после paste и Enter.");
  assert.doesNotMatch(validation.data.payload.about, /Старая версия/u);
});

test("legacy v1 drafts preserve unknown text and only migrate the explicitly safe YouTube alias", () => {
  const legacyFields = {
    ...createEmptyCatalogSubmissionDraft().fields,
    profileSummary: "Старое краткое описание остаётся в черновике.",
  };
  const legacy = {
    marker: "AL-AMIN-CATALOG-SUBMISSION-DRAFT",
    version: 1,
    fields: legacyFields,
    categories: ["YouTube", "Семейный бюджет", "Любовь и ненависть"],
    categoryDraft: "Редкое направление",
    helpTopics: [{ title: "Старое направление", description: "Старое описание" }], workOffers: [], portfolio: [],
    profileCrop: { positionX: 50, positionY: 50, zoom: 1 },
    avatar: { positionX: 50, positionY: 24, zoom: 1 },
  };
  const restored = parseCatalogSubmissionDraft(JSON.stringify(legacy));
  assert.equal(restored.taxonomyVersion, categoryTaxonomyVersion);
  assert.deepEqual(restored.categoryIds, ["creator-001"]);
  assert.deepEqual(restored.legacyCategories, ["Семейный бюджет", "Любовь и ненависть", "Редкое направление"]);
  assert.equal(restored.fields.profileSummary, "Старое краткое описание остаётся в черновике.");
  assert.deepEqual(restored.helpTopics, [{ title: "Старое направление", description: "Старое описание" }]);
});
