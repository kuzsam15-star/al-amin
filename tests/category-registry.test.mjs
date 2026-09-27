import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  categoryRegistry,
  categoryRegistryIntegrity,
  categoryTaxonomyVersion,
  resolveLegacyCategories,
  searchCategoryRegistry,
  validateCategorySelection,
} from "../src/lib/category-registry.mjs";

test("category registry matches the approved handoff exactly", () => {
  assert.equal(categoryTaxonomyVersion, "2026-09-27.1");
  assert.deepEqual(categoryRegistryIntegrity(), { errors: [], groups: 45, categories: 876, aliases: 137 });
  assert.equal(new Set(categoryRegistry.groups.map((item) => item.id)).size, 45);
  assert.equal(new Set(categoryRegistry.categories.map((item) => item.id)).size, 876);
});

test("canonical registry content matches the approved handoff checksum", async () => {
  const source = JSON.parse(await readFile(new URL("../content/category-registry.json", import.meta.url), "utf8"));
  const checksum = createHash("sha256").update(`${JSON.stringify(source, null, 2)}\n`).digest("hex");
  assert.equal(checksum, "320c151f2406228bd54dfa82b929dc2ab0159c148621c1b95100fee5d25a434a");
});

test("registry search ranks exact labels and aliases before partial matches", () => {
  const cases = [
    ["ютуб", "creator-001"], ["YouTube", "creator-001"], ["смм", "marketing-004"],
    ["арабский", "languages-010"], ["семейный психолог", "psychology-002"],
    ["сантехник", "building-systems-001"], ["WordPress", "software-016"], ["Ableton", "learning-009"],
  ];
  for (const [query, id] of cases) assert.equal(searchCategoryRegistry(query)[0]?.id, id, query);
});

test("selection enforces current version, stable known IDs, uniqueness and the limit", () => {
  assert.deepEqual(validateCategorySelection(["creator-001"], categoryTaxonomyVersion).errors, []);
  assert.ok(validateCategorySelection(["unknown"], categoryTaxonomyVersion).errors.some((message) => message.includes("неизвестная")));
  assert.ok(validateCategorySelection(["creator-001", "creator-001"], categoryTaxonomyVersion).errors.some((message) => message.includes("дубликат")));
  assert.ok(validateCategorySelection(categoryRegistry.categories.slice(0, 9).map((item) => item.id), categoryTaxonomyVersion).errors.some((message) => message.includes("максимум 8")));
});

test("legacy migration is conservative and preserves ambiguous or unknown strings", () => {
  assert.deepEqual(resolveLegacyCategories(["YouTube"]), { categoryIds: ["creator-001"], categories: ["YouTube и видеоблогинг"], unresolved: [] });
  const unsafe = resolveLegacyCategories(["Семейный бюджет", "Любовь и ненависть"]);
  assert.deepEqual(unsafe.categoryIds, []);
  assert.deepEqual(unsafe.unresolved, ["Семейный бюджет", "Любовь и ненависть"]);
});
