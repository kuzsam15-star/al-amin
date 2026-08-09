import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createMockPublicSpecialistCard,
  createRealPublicSpecialistCard,
  publicSpecialistCardHref,
  resolvePublicSpecialistCardAction,
} from "../src/lib/public-specialist-card.ts";

const victor = createRealPublicSpecialistCard({
  id: "4f0b9d27-ea5c-4079-a18d-99c1e664116b",
  slug: "profile-ff7e1f53",
  name: "Victor Kuznetsov",
  specialization: "Автоматизация",
  location: "Великие Луки",
  workFormat: "Онлайн и офлайн",
  photo: "/api/media/view?path=victor.webp",
  photoAlt: "Victor Kuznetsov",
  verificationState: "published",
});

const profileB = createRealPublicSpecialistCard({
  id: "profile-b-id",
  slug: "profile-b",
  name: "Profile B",
  specialization: "Консультант",
  location: "Казань",
  workFormat: "Онлайн",
  photo: null,
  photoAlt: "Profile B",
  verificationState: "verified",
});

const mock = createMockPublicSpecialistCard({
  id: "preview-mock",
  name: "Preview Mock",
  specialization: "Пример",
  location: "Москва",
  workFormat: "Онлайн",
  photo: "/design-preview/mock.png",
  photoAlt: "Preview Mock",
  verificationState: "published",
});

test("real Victor center card resolves to the exact published profile URL", () => {
  assert.ok(victor);
  assert.equal(victor.profileUrl, "/specialists/profile-ff7e1f53");
  assert.deepEqual(resolvePublicSpecialistCardAction(victor, "center"), {
    type: "navigate",
    href: "/specialists/profile-ff7e1f53",
  });
  assert.equal(publicSpecialistCardHref(victor), "/specialists/profile-ff7e1f53");
});

test("a second real profile keeps its own slug and URL", () => {
  assert.ok(profileB);
  assert.equal(profileB.profileUrl, "/specialists/profile-b");
  assert.equal(publicSpecialistCardHref(profileB), "/specialists/profile-b");
});

test("a side card centers without navigating", () => {
  assert.ok(victor);
  assert.deepEqual(resolvePublicSpecialistCardAction(victor, "right"), { type: "center" });
});

test("a mock center card never receives a nonexistent profile URL", () => {
  assert.equal(mock.profileUrl, null);
  assert.equal(publicSpecialistCardHref(mock), "/specialists");
  assert.deepEqual(resolvePublicSpecialistCardAction(mock, "center"), {
    type: "catalog",
    href: "/specialists",
  });
});

test("drag suppresses navigation while a simple center click navigates", () => {
  assert.ok(victor);
  assert.deepEqual(resolvePublicSpecialistCardAction(victor, "center", true), { type: "ignore" });
  assert.equal(resolvePublicSpecialistCardAction(victor, "center", false).type, "navigate");
});

test("Home Cover Flow and catalog both use the shared public-card contract", async () => {
  const root = new URL("../", import.meta.url);
  const [homeLoader, homeClient, catalogCard] = await Promise.all([
    readFile(new URL("src/lib/civic-home.ts", root), "utf8"),
    readFile(new URL("src/components/civic/CivicHome.tsx", root), "utf8"),
    readFile(new URL("src/components/SpecialistCard.tsx", root), "utf8"),
  ]);
  assert.match(homeLoader, /createRealPublicSpecialistCard/);
  assert.match(homeClient, /publicSpecialistCardHref/);
  assert.match(homeClient, /resolvePublicSpecialistCardAction/);
  assert.match(catalogCard, /createRealPublicSpecialistCard/);
  assert.doesNotMatch(homeClient, /specialist\.slug \? `\/specialists\//);
  assert.doesNotMatch(catalogCard, /const profileHref = `\/specialists\/\$\{item\.slug\}`/);
});
