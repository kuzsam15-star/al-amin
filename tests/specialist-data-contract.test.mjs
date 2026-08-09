import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateWorkOffers } from "../src/lib/specialist-contract.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, applicationValidation, applicationForm, cabinetPage, cabinetAction, publicPage, publicProfile, catalog, home] = await Promise.all([
  read("supabase/migrations/202608070001_specialist_data_contract.sql"),
  read("src/lib/application-validation.mjs"),
  read("src/components/ApplicationForm.tsx"),
  read("src/app/cabinet/page.tsx"),
  read("src/app/cabinet/actions.ts"),
  read("src/app/specialists/[slug]/page.tsx"),
  read("src/components/civic/CivicPublicProfile.tsx"),
  read("src/app/specialists/page.tsx"),
  read("src/lib/civic-home.ts"),
]);

test("private application contact is absent from publication and public representation", () => {
  const publishFunction = migration.match(/create or replace function public\.publish_approved_application[\s\S]*?revoke all on function public\.publish_approved_application/)?.[0] ?? "";
  const publicView = migration.match(/create or replace view public\.published_specialists[\s\S]*?revoke all on public\.published_specialists/)?.[0] ?? "";
  assert.doesNotMatch(publishFunction, /public_contact/);
  assert.doesNotMatch(publicView, /public_contact|owner_id|internal_notes|moderation/);
  assert.match(migration, /drop policy if exists "Public reads published specialists"/);
  assert.match(migration, /revoke all on public\.specialists from anon/);
  assert.match(publicPage, /from\("published_specialists"\)/);
  assert.doesNotMatch(publicPage, /public_contact|from\("specialists"\)/);
  assert.match(cabinetPage, /select\("id,status,created_at,full_name,contact,applicant_message,resubmitted_at"\)/);
  assert.match(cabinetPage, /application\.contact/);
  assert.match(cabinetPage, /eq\("owner_id", user\.id\)/);
  assert.match(applicationForm, /Приватный контакт: доступен только команде AL-AMIN/);
});

test("profile summary, help topics and work offers cross application, publication and revision", () => {
  for (const field of ["profile_summary", "help_topics", "work_offers"]) {
    assert.match(applicationValidation, new RegExp(`${field}:`));
    assert.match(migration, new RegExp(`${field} = app\\.${field}`));
    assert.match(publicProfile, new RegExp(`item\\.${field}`));
  }
  assert.match(cabinetAction, /validateProfileRevision/);
  assert.match(cabinetAction, /contract_version: 2/);
  assert.match(migration, /contract_version = 2/);
  assert.match(migration, /new\.payload->>'contract_version' = '2'/);
});

test("legacy services backfill offers without inventing help topics", () => {
  const backfill = migration.match(/-- Approved one-time legacy backfill[\s\S]*?alter table public\.applications alter column profile_summary set not null/)?.[0] ?? "";
  assert.match(backfill, /set work_offers =/);
  assert.match(backfill, /'duration_minutes', null/);
  assert.match(backfill, /'price', null/);
  assert.match(backfill, /'currency', null/);
  assert.doesNotMatch(backfill, /set help_topics =/);
  const legacy = validateWorkOffers([{ title: "Консультация", duration_minutes: null, mode: null, price: null, currency: null }], { required: false, allowLegacyMode: true });
  assert.ok(legacy.data);
});

test("legacy capabilities stay in storage but are absent from the new initial form and public profile", () => {
  assert.match(migration, /portfolio_links = case when app\.links is null/);
  assert.doesNotMatch(applicationForm, /GalleryViewer|ProfileLinks|VideoPreview|recommendations/);
  assert.doesNotMatch(publicProfile, /GalleryViewer|ProfileLinks|VideoPreview|FeedbackForms|ContactLinks|public_contact|recommendations/);
});

test("optional public sections and verification claims render only when data exists", () => {
  assert.match(publicProfile, /item\.help_topics\.length \?/);
  assert.match(publicProfile, /item\.work_offers\.length \?/);
  assert.match(publicProfile, /reviews\.length \?/);
  assert.match(publicProfile, /verificationFacts && verified \?/);
  assert.match(publicProfile, /verificationFacts\?\.experience_checked/);
  assert.match(catalog, /loadPublicVerificationFacts/);
  assert.match(home, /loadPublicVerificationFacts/);
  assert.doesNotMatch(publicProfile, /При публикации профиля|Ручная модерация|Профессиональные сведения подтверждены/);
});
