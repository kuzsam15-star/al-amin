import test from "node:test";
import assert from "node:assert/strict";
import { russianCount, russianPluralForm } from "../src/lib/russian-count.mjs";

test("selects correct Russian photo and character forms", () => {
  const photos = { one: "фотография", few: "фотографии", many: "фотографий" };
  const photoAccusative = { one: "фотографию", few: "фотографии", many: "фотографий" };
  const characters = { one: "символ", few: "символа", many: "символов" };

  assert.deepEqual([1, 2, 5, 21, 22, 25].map((count) => russianCount(count, photos)), ["1 фотография", "2 фотографии", "5 фотографий", "21 фотография", "22 фотографии", "25 фотографий"]);
  assert.deepEqual([1, 2, 5].map((count) => russianCount(count, photoAccusative)), ["1 фотографию", "2 фотографии", "5 фотографий"]);
  assert.deepEqual([1, 2, 5, 21, 34].map((count) => russianCount(count, characters)), ["1 символ", "2 символа", "5 символов", "21 символ", "34 символа"]);
  assert.equal(`${russianPluralForm(8, { one: "Добавлена", few: "Добавлены", many: "Добавлено" })} ${russianCount(8, photos)}.`, "Добавлено 8 фотографий.");
});
