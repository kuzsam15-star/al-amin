import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogSubmissionDraftStorageKey,
  createEmptyCatalogSubmissionDraft,
  hasMeaningfulCatalogSubmissionDraft,
  parseCatalogSubmissionDraft,
  serializeCatalogSubmissionDraft,
} from "../src/lib/catalog-submission-draft.mjs";
import {
  createAlaminSubmissionPackage,
  validateAlaminSubmissionPackage,
} from "../src/lib/alamin-submission-file.mjs";
import {
  catalogSubmissionConsent,
  catalogSubmissionContractVersion,
} from "../src/lib/catalog-submission-contract.mjs";

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
  draft.categoryDraft = "Незавершённая категория";
  draft.categories = ["Семейные отношения"];
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
  assert.equal(hasMeaningfulCatalogSubmissionDraft(createEmptyCatalogSubmissionDraft()), false);
  assert.equal(parseCatalogSubmissionDraft("not json"), null);
  assert.equal(parseCatalogSubmissionDraft(JSON.stringify({ marker: "AL-AMIN-CATALOG-SUBMISSION-DRAFT", version: 99 })), null);
});

test("restored draft is bounded and never contains a photo payload", () => {
  const value = JSON.parse(serializeCatalogSubmissionDraft(createEmptyCatalogSubmissionDraft()));
  value.fields.about = "я".repeat(4000);
  value.categories = Array.from({ length: 20 }, (_, index) => `Категория ${index}`);
  value.photo = { data: "base64-is-not-allowed-in-draft" };
  value.profileCrop = { positionX: 900, positionY: -10, zoom: 50 };
  value.avatar = { positionX: -10, positionY: 900, zoom: 50 };
  const restored = parseCatalogSubmissionDraft(JSON.stringify(value));
  assert.equal(Array.from(restored.fields.about).length, 3000);
  assert.equal(restored.categories.length, 8);
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
  original.categories = ["Семейные отношения"];
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
    categories: restored.categories,
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
