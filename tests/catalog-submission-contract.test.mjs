import assert from "node:assert/strict";
import test from "node:test";
import { catalogSubmissionConsent, validateCatalogSubmissionPayload } from "../src/lib/catalog-submission-contract.mjs";
import {
  alaminSubmissionFileVersion,
  alaminSubmissionMarker,
  createAlaminSubmissionPackage,
  safeAlaminFileName,
  validateAlaminSubmissionPackage,
} from "../src/lib/alamin-submission-file.mjs";
import { categoryTaxonomyVersion } from "../src/lib/category-registry.mjs";

function validPayload(photoBytes = 4) {
  return {
    contractVersion: 1,
    fullName: "Амина Тестова",
    specialization: "Семейный консультант",
    country: "Россия",
    city: "Казань",
    workMode: "both",
    experienceYears: 7,
    profileSummary: "Помогает спокойно разбирать сложные семейные ситуации.",
    about: "Работает бережно и последовательно, объясняя каждый этап взаимодействия.",
    categories: ["Семейные отношения"],
    helpTopics: [{ title: "Диалог в семье", description: "Помощь в восстановлении общения." }],
    workOffers: [{ title: "Консультация", mode: "online", durationMinutes: 60, price: null, currency: null }],
    contacts: { email: "qa@example.com" },
    portfolio: [],
    profileCrop: { positionX: 35, positionY: 70, zoom: 1.2 },
    avatar: { positionX: 50, positionY: 24, zoom: 1 },
    photo: { originalName: "qa.png", contentType: "image/png", size: photoBytes },
    consent: true,
    consentText: catalogSubmissionConsent,
  };
}

function validPackage() {
  const bytes = Buffer.from("safe");
  return createAlaminSubmissionPackage({
    packageId: "1c0f9c74-5d72-4a57-9d92-f412ca4fe250",
    createdAt: "2026-09-26T12:00:00.000Z",
    payload: validPayload(bytes.length),
    attachment: { filename: "qa.png", mediaType: "image/png", data: bytes.toString("base64") },
  });
}

function validV2Payload(photoBytes = 4) {
  return {
    ...validPayload(photoBytes),
    contractVersion: 2,
    taxonomyVersion: categoryTaxonomyVersion,
    categoryIds: ["psychology-002", "creator-001"],
    categories: ["Подменённое клиентом название"],
    missingCategoryRequest: "",
  };
}

test("candidate payload maps only to the candidate-facing contract", () => {
  const result = validateCatalogSubmissionPayload(validPayload());
  assert.deepEqual(result.errors, []);
  assert.equal(result.data.contractVersion, 1);
  assert.deepEqual(result.data.workOffers[0], { title: "Консультация", mode: "online", durationMinutes: 60, price: null, currency: null });
  assert.deepEqual(result.data.profileCrop, { positionX: 35, positionY: 70, zoom: 1.2 });
  for (const forbidden of ["slug", "trust", "published", "featured", "status"]) assert.equal(forbidden in result.data, false);
});

test("new simplified candidate payload does not require summary or help topics", () => {
  const payload = validV2Payload();
  delete payload.profileSummary;
  delete payload.helpTopics;
  payload.workOffers = [
    { title: "Первая консультация", mode: "online", durationMinutes: 60, price: 2500, currency: "RUB" },
    { title: "Ознакомительная встреча", mode: "both", durationMinutes: null, price: null, currency: null },
  ];
  const result = validateCatalogSubmissionPayload(payload);
  assert.deepEqual(result.errors, []);
  assert.equal(result.data.profileSummary, "");
  assert.deepEqual(result.data.helpTopics, []);
  assert.deepEqual(result.data.workOffers[1], {
    title: "Ознакомительная встреча",
    mode: "both",
    durationMinutes: null,
    price: null,
    currency: null,
  });
});

test("legacy candidate payload keeps summary and help topics unchanged", () => {
  const result = validateCatalogSubmissionPayload(validPayload());
  assert.deepEqual(result.errors, []);
  assert.equal(result.data.profileSummary, "Помогает спокойно разбирать сложные семейные ситуации.");
  assert.deepEqual(result.data.helpTopics, [{ title: "Диалог в семье", description: "Помощь в восстановлении общения." }]);
});

test("candidate contract preserves high independent crops and rejects values beyond the safe range", () => {
  const payload = validPayload();
  payload.profileCrop = { positionX: 22, positionY: 71, zoom: 6.5 };
  payload.avatar = { positionX: 67, positionY: 18, zoom: 8 };
  const valid = validateCatalogSubmissionPayload(payload);
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.data.profileCrop, payload.profileCrop);
  assert.deepEqual(valid.data.avatar, payload.avatar);

  payload.avatar.zoom = 8.01;
  const invalid = validateCatalogSubmissionPayload(payload);
  assert.ok(invalid.errors.some((message) => message.includes("avatar.zoom")));
});

test("current contract trusts registry IDs, regenerates labels and rejects unknown IDs", () => {
  const valid = validateCatalogSubmissionPayload(validV2Payload());
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.data.categoryIds, ["psychology-002", "creator-001"]);
  assert.deepEqual(valid.data.categories, ["Семейный психолог", "YouTube и видеоблогинг"]);

  const tampered = validV2Payload();
  tampered.categoryIds = ["candidate-created-category"];
  assert.ok(validateCatalogSubmissionPayload(tampered).errors.some((message) => message.includes("неизвестная категория")));
});

test("missing category request is private application context and can replace a selection", () => {
  const payload = validV2Payload();
  payload.categoryIds = [];
  payload.categories = [];
  payload.missingCategoryRequest = "Нужно редкое направление, которого пока нет в справочнике.";
  const result = validateCatalogSubmissionPayload(payload);
  assert.deepEqual(result.errors, []);
  assert.equal(result.data.missingCategoryRequest, payload.missingCategoryRequest);
  assert.deepEqual(result.data.categories, []);
});

test("legacy v1 packages without profileCrop remain valid and receive a centered profile crop", () => {
  const packageValue = validPackage();
  delete packageValue.payload.profileCrop;
  const result = validateAlaminSubmissionPackage(packageValue);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data.payload.profileCrop, { positionX: 50, positionY: 50, zoom: 1 });
});

test("AL-AMIN v1 package is self-contained and normalized", () => {
  const packageValue = validPackage();
  const result = validateAlaminSubmissionPackage(packageValue);
  assert.deepEqual(result.errors, []);
  assert.equal(packageValue.marker, alaminSubmissionMarker);
  assert.equal(packageValue.version, alaminSubmissionFileVersion);
  assert.equal(packageValue.attachments.length, 1);
  assert.equal(result.attachmentBytes, 4);
  assert.equal("consent" in packageValue.payload, false);
  assert.equal("consentText" in packageValue.payload, false);
});

test("current consent is mandatory and exact", () => {
  const missing = validPackage();
  missing.consent.accepted = false;
  assert.ok(validateAlaminSubmissionPackage(missing).errors.some((message) => message.startsWith("consent:")));
  const stale = validPackage();
  stale.consent.text = "Старый текст";
  assert.ok(validateAlaminSubmissionPackage(stale).errors.some((message) => message.startsWith("consent:")));
});

test("package rejects unsupported versions, malformed base64 and size mismatches", () => {
  const version = validPackage();
  version.version = 2;
  assert.ok(validateAlaminSubmissionPackage(version).errors.some((message) => message.startsWith("version:")));
  const malformed = validPackage();
  malformed.attachments[0].data = "not base64!";
  assert.ok(validateAlaminSubmissionPackage(malformed).errors.some((message) => message.includes("base64")));
  const mismatch = validPackage();
  mismatch.payload.photo.size = 99;
  assert.ok(validateAlaminSubmissionPackage(mismatch).errors.some((message) => message.includes("не совпадает")));
});

test("package rejects owner-only fields, HTML and unsafe filenames", () => {
  for (const field of ["slug", "published", "featured", "verifiedFacts", "status"]) {
    const packageValue = validPackage();
    packageValue.payload[field] = field === "slug" ? "existing-profile" : true;
    assert.ok(validateAlaminSubmissionPackage(packageValue).errors.some((message) => message.includes(field)));
  }
  const html = validPackage();
  html.payload.about = "<script>alert(1)</script>";
  assert.ok(validateAlaminSubmissionPackage(html).errors.some((message) => message.includes("HTML")));
  const traversal = validPackage();
  traversal.attachments[0].filename = "../../profile.png";
  assert.ok(validateAlaminSubmissionPackage(traversal).errors.some((message) => message.includes("filename")));
});

test("photo metadata rejects oversize and unsupported media", () => {
  const payload = validPayload();
  payload.photo.size = 8 * 1024 * 1024 + 1;
  assert.ok(validateCatalogSubmissionPayload(payload).errors.some((message) => message.includes("photo.size")));
  const packageValue = validPackage();
  packageValue.attachments[0].mediaType = "image/svg+xml";
  packageValue.payload.photo.contentType = "image/svg+xml";
  assert.ok(validateAlaminSubmissionPackage(packageValue).errors.some((message) => message.includes("JPEG")));
});

test("download filename is friendly and path-safe", () => {
  assert.equal(safeAlaminFileName("Иван Иванов"), "Заявка-Иван-Иванов.alamin");
  assert.equal(safeAlaminFileName("../Опасное: имя", ".alamin.json"), "Заявка-..-Опасное-имя.alamin.json");
  assert.doesNotMatch(safeAlaminFileName("../Опасное: имя"), /[\\/:*?"<>|]/u);
});
