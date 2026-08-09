import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContact, validateApplication, validateProfileRevision } from "../src/lib/application-validation.mjs";
import { validateHelpTopics, validateWorkOffers } from "../src/lib/specialist-contract.mjs";

const ownerId = "00000000-0000-4000-8000-000000000099";
const categoryId = "00000000-0000-4000-8000-000000000001";
const extraCategoryId = "00000000-0000-4000-8000-000000000002";
const context = { ownerId, activeCategories: [{ id: categoryId, name: "Психология" }, { id: extraCategoryId, name: "Образование" }] };
const valid = {
  mainImagePath: `submissions/${ownerId}/avatar/00000000-0000-4000-8000-000000000098.webp`,
  fullName: "Амина Каримова", contactMethod: "telegram", contact: "@amina", country: "Россия", city: "Казань",
  categoryId, additionalCategoryIds: [extraCategoryId], specialization: "Семейный психолог", experienceYears: "5",
  profileSummary: "Помогаю семьям вернуть спокойный и уважительный диалог.",
  description: "Помогаю семьям и отдельным взрослым разобраться в сложных ситуациях, вернуть устойчивость и выстроить бережный диалог.",
  helpTopics: [{ title: "Семейные конфликты", description: "Помогаю услышать друг друга и снизить напряжение." }],
  workOffers: [{ title: "Первичная консультация", duration_minutes: 60, mode: "both", price: 4500, currency: "RUB" }],
  truthful: true, personalData: true, website: "",
};
const validate = (body = valid, override = {}) => validateApplication(body, { ...context, ...override });

test("accepts and canonicalizes a complete structured application", () => {
  const result = validate();
  assert.ok(result.data);
  assert.equal(result.data.contract_version, 2);
  assert.equal(result.data.owner_id, ownerId);
  assert.equal(result.data.category_text, "Психология");
  assert.equal(result.data.contact, "@amina");
  assert.deepEqual(result.data.help_topics, valid.helpTopics);
  assert.deepEqual(result.data.work_offers, valid.workOffers);
  assert.equal(result.data.services, "Первичная консультация");
});

test("validates the full form and reports every field without silent truncation", () => {
  const result = validate({ ...valid, fullName: "", city: "!!!", profileSummary: "x".repeat(221), description: "мало", truthful: false, personalData: false });
  assert.ok(result.error);
  assert.deepEqual(Object.keys(result.errors).filter((key) => ["fullName", "city", "profileSummary", "description", "truthful", "personalData"].includes(key)), ["fullName", "city", "profileSummary", "description", "truthful", "personalData"]);
  assert.match(result.errors.profileSummary, /220/);
  assert.match(result.errors.description, /50/);
});

test("uses correct Russian forms for missing description characters", () => {
  for (const [missing, expected] of [[1, "1 символ"], [2, "2 символа"], [5, "5 символов"], [21, "21 символ"], [34, "34 символа"]]) {
    const result = validate({ ...valid, description: "а".repeat(50 - missing) });
    assert.equal(result.errors.description, `Добавьте ещё ${expected}. Минимум — 50.`);
  }
});

test("accepts multilingual names and rejects structural garbage", () => {
  for (const fullName of ["Анна-Мария Иванова", "Muhammad Ali", "José Álvarez", "Mary O’Connor", "مريم أحمد"]) assert.ok(validate({ ...valid, fullName }).data, fullName);
  for (const fullName of ["Один", "123 456", "аа аа", "<b>Имя Фамилия</b>", "@username Person"]) assert.equal(validate({ ...valid, fullName }).field, "fullName", fullName);
});

test("normalizes phone and Telegram contacts using an explicit method", () => {
  assert.deepEqual(normalizeContact("phone", "+7 (999) 123-45-67"), { data: "+79991234567" });
  assert.deepEqual(normalizeContact("phone", "372 5555 1234"), { data: "+37255551234" });
  assert.deepEqual(normalizeContact("telegram", "https://t.me/User_Name"), { data: "@User_Name" });
  assert.equal(normalizeContact("telegram", "t.me/язык").error.includes("Telegram"), true);
  assert.equal(validate({ ...valid, contactMethod: "other" }).field, "contactMethod");
  assert.equal(validate({ ...valid, contactMethod: "phone", contact: "абракадабра" }).field, "contact");
});

test("requires active unique categories and derives the legacy category label on the server", () => {
  assert.equal(validate({ ...valid, categoryId: "00000000-0000-4000-8000-000000000003" }).field, "categoryId");
  assert.equal(validate({ ...valid, additionalCategoryIds: [extraCategoryId, extraCategoryId] }).field, "additionalCategoryIds");
  assert.equal(validate({ ...valid, additionalCategoryIds: [categoryId] }).field, "additionalCategoryIds");
  assert.equal(validate({ ...valid, additionalCategoryIds: Array(9).fill(extraCategoryId) }).field, "additionalCategoryIds");
});

test("rejects wrong types, unknown envelope keys and server-owned fields", () => {
  assert.equal(validate({ ...valid, experienceYears: 5 }).field, "experienceYears");
  assert.equal(validate({ ...valid, additionalCategoryIds: "not-an-array" }).field, "additionalCategoryIds");
  assert.equal(validate({ ...valid, status: "approved" }).field, "request");
  assert.equal(validate({ ...valid, owner_id: ownerId }).field, "request");
  assert.equal(validate({ ...valid, contract_version: 1 }).field, "request");
});

test("validates text controls, markup, ranges and exact integer experience", () => {
  assert.equal(validate({ ...valid, specialization: "C++" }).data.specialization, "C++");
  assert.equal(validate({ ...valid, specialization: "1С-разработчик" }).data.specialization, "1С-разработчик");
  assert.equal(validate({ ...valid, experienceYears: "0" }).data.experience_years, 0);
  for (const experienceYears of ["2.5", "1e1", "81", "-1"]) assert.equal(validate({ ...valid, experienceYears }).field, "experienceYears");
  assert.equal(validate({ ...valid, profileSummary: "<b>текст</b>" }).field, "profileSummary");
  assert.equal(validate({ ...valid, description: `Текст ${"а".repeat(50)}\u202E` }).field, "description");
});

test("enforces strict structured topics and offers with indexed errors", () => {
  assert.equal(validateHelpTopics([{ title: "Тема", description: null, extra: true }]).field, "helpTopics.0");
  assert.equal(validateHelpTopics([{ title: "Тема", description: null }, { title: " тема ", description: null }]).field, "helpTopics.1.title");
  assert.equal(validateWorkOffers([{ ...valid.workOffers[0], duration_minutes: 1.5 }]).field, "workOffers.0.duration_minutes");
  assert.equal(validateWorkOffers([{ ...valid.workOffers[0], price: 1.001 }]).field, "workOffers.0.price");
  assert.equal(validateWorkOffers([{ ...valid.workOffers[0], currency: "GBP" }]).field, "workOffers.0.currency");
  assert.equal(validateWorkOffers([{ ...valid.workOffers[0], price: null, currency: "RUB" }]).field, "workOffers.0.currency");
});

test("requires an exact owner-scoped avatar while allowing an explicitly referenced legacy path during edit", () => {
  assert.equal(validate({ ...valid, mainImagePath: "" }).field, "main");
  assert.equal(validate({ ...valid, mainImagePath: "submissions/another-user/avatar/file.webp" }).field, "main");
  const legacy = "submissions/main-00000000-0000-4000-8000-000000000098.png";
  assert.ok(validate({ ...valid, mainImagePath: legacy }, { allowedExistingMediaPaths: [legacy] }).data);
});

test("profile revision uses the same canonical core without accepting application-only or moderation fields", () => {
  const revisionInput = {
    fullName: valid.fullName, country: valid.country, city: valid.city, categoryId: valid.categoryId,
    additionalCategoryIds: valid.additionalCategoryIds, specialization: valid.specialization,
    experienceYears: valid.experienceYears, profileSummary: valid.profileSummary, description: valid.description,
    helpTopics: valid.helpTopics, workOffers: valid.workOffers, mainImagePath: valid.mainImagePath,
  };
  const result = validateProfileRevision(revisionInput, context);
  assert.equal(result.data.contract_version, 2);
  assert.equal(result.data.full_description, valid.description);
  assert.equal(validateProfileRevision({ ...revisionInput, status: "approved" }, context).field, "request");
});
