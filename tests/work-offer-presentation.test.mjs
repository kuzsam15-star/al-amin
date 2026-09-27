import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkOfferPrice, getWorkOfferPresentationParts } from "../src/lib/work-offer-presentation.mjs";

const plainSpaces = (value) => value.replace(/\s/gu, " ");
const values = (offer) => plainSpaces(getWorkOfferPresentationParts(offer).map((part) => part.value).join(" · "));

test("work offer presentation covers every optional-data combination", () => {
  assert.equal(values({ mode: "online", durationMinutes: 60, price: 5000, currency: "RUB" }), "Онлайн · 60 мин. · 5 000 ₽");
  assert.equal(values({ mode: "offline", durationMinutes: 90, price: null, currency: null }), "Очно · 90 мин.");
  assert.equal(values({ mode: "both", durationMinutes: null, price: 3000, currency: "RUB" }), "Онлайн и очно · 3 000 ₽");
  assert.equal(values({ mode: "online", durationMinutes: null, price: null, currency: null }), "Онлайн");
});

test("zero and invalid optional values are omitted without stray separators", () => {
  assert.equal(values({ mode: "online", durationMinutes: 0, price: 0, currency: "RUB" }), "Онлайн");
  assert.equal(values({ mode: "offline", durationMinutes: -10, price: -1, currency: "RUB" }), "Очно");
});

test("supported currencies use human-readable localized symbols", () => {
  assert.equal(plainSpaces(formatWorkOfferPrice(5000, "RUB")), "5 000 ₽");
  assert.match(formatWorkOfferPrice(75, "USD"), /\$/u);
  assert.match(formatWorkOfferPrice(80, "EUR"), /€/u);
});
