import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateContent, validateSpecialistsDocument } from "../src/lib/static-content-contract.mjs";

const site = JSON.parse(await readFile(new URL("../content/site.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../content/specialists.json", import.meta.url), "utf8"));

test("repository content satisfies the static contract", () => {
  const result = validateContent(site, catalog);
  assert.deepEqual(result.errors, []);
});

test("duplicate slugs are rejected", () => {
  const template = {
    id: "one", slug: "same", fullName: "Тестовый Специалист", photo: { src: "/images/specialists/test/profile.webp", alt: "Фото" },
    specialization: "Специалист", categories: ["Консультации"], country: "Россия", city: "Москва", workMode: "online",
    profileSummary: "Краткое описание специалиста.", about: "Подробное описание специалиста.", helpTopics: [], workOffers: [],
    experienceYears: null, trust: { recommendedByAlAmin: false, verifiedFacts: [] }, contacts: {}, portfolio: [], published: false, featured: false, sortOrder: 0
  };
  const result = validateSpecialistsDocument({ version: 1, specialists: [template, { ...template, id: "two" }] });
  assert.ok(result.errors.some((message) => message.includes("slug: дубликат")));
  assert.deepEqual(result.data.specialists[0].photo.avatar, { positionX: 50, positionY: 24, zoom: 1 });
});

test("insecure website URLs are rejected", () => {
  const result = validateSpecialistsDocument({ version: 1, specialists: [{
    id: "one", slug: "test", fullName: "Тестовый Специалист", photo: { src: "/images/specialists/test/profile.webp", alt: "Фото" },
    specialization: "Специалист", categories: ["Консультации"], country: "Россия", city: "Москва", workMode: "online",
    profileSummary: "Краткое описание специалиста.", about: "Подробное описание специалиста.", helpTopics: [], workOffers: [],
    experienceYears: null, trust: { recommendedByAlAmin: false, verifiedFacts: [] }, contacts: { website: "http://example.com" }, portfolio: [], published: false, featured: false, sortOrder: 0
  }] });
  assert.ok(result.errors.some((message) => message.includes("разрешён только https")));
});

test("avatar crop settings are normalized and bounded", () => {
  const specialist = {
    id: "one", slug: "test", fullName: "Тестовый Специалист", photo: { src: "/images/specialists/test/profile.webp", alt: "Фото", avatar: { positionX: 64, positionY: 33, zoom: 6 } },
    specialization: "Специалист", categories: ["Консультации"], country: "Россия", city: "Москва", workMode: "online",
    profileSummary: "Краткое описание специалиста.", about: "Подробное описание специалиста.", helpTopics: [], workOffers: [],
    experienceYears: null, trust: { recommendedByAlAmin: false, verifiedFacts: [] }, contacts: {}, portfolio: [], published: true, featured: false, sortOrder: 0
  };
  const valid = validateSpecialistsDocument({ version: 1, specialists: [specialist] });
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.data.specialists[0].photo.avatar, { positionX: 64, positionY: 33, zoom: 6 });

  specialist.photo.avatar.zoom = 9;
  const invalid = validateSpecialistsDocument({ version: 1, specialists: [specialist] });
  assert.ok(invalid.errors.some((message) => message.includes("photo.avatar.zoom")));
});
