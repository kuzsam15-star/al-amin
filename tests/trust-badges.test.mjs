import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/202607290010_trust_badges.sql", import.meta.url), "utf8");
const adminActions = await readFile(new URL("../src/app/admin/actions.ts", import.meta.url), "utf8");
const badges = await readFile(new URL("../src/components/TrustBadges.tsx", import.meta.url), "utf8");
const adminBadges = await readFile(new URL("../src/components/AdminTrustBadges.tsx", import.meta.url), "utf8");
const home = await readFile(new URL("../src/lib/civic-home.ts", import.meta.url), "utf8");
const catalog = await readFile(new URL("../src/app/specialists/page.tsx", import.meta.url), "utf8");
const card = await readFile(new URL("../src/components/SpecialistCard.tsx", import.meta.url), "utf8");
const contractMigration = await readFile(new URL("../supabase/migrations/202608070001_specialist_data_contract.sql", import.meta.url), "utf8");

test("trust badges use an extensible catalog, assignment records, and public RLS", () => {
  assert.match(migration, /create table if not exists public\.trust_badges/);
  assert.match(migration, /create table if not exists public\.specialist_trust_badges/);
  assert.match(migration, /assigned_by uuid references auth\.users/);
  assert.match(migration, /source text not null check \(source in \('automatic', 'manual'\)\)/);
  assert.match(migration, /Public reads published specialist badges[\s\S]*s\.status = 'published'/);
  assert.match(migration, /Admins manage specialist badges[\s\S]*public\.is_admin\(\)/);
});

test("legacy publication badges are retained but no longer define verification", () => {
  assert.match(migration, /sync_published_verified_badge/);
  assert.match(contractMigration, /drop trigger if exists specialists_sync_verified_badge/);
  assert.match(contractMigration, /badge\.code <> 'verified'/);
  assert.match(contractMigration, /published_specialist_verification_facts/);
  assert.doesNotMatch(contractMigration, /delete from public\.specialist_trust_badges/);
});

test("manual badges are an admin-only audited operation", () => {
  assert.match(adminActions, /export async function updateTrustBadges/);
  assert.match(adminActions, /requireAdmin\(\)/);
  assert.match(adminActions, /eq\("assignment_type", "manual"\)/);
  assert.match(adminActions, /eq\("source", "manual"\)/);
  assert.match(adminActions, /"trust_badges_updated"/);
});

test("public cards render compact accessible indicators and no supporter ranking", () => {
  assert.match(card, /TrustBadges/);
  assert.match(badges, /aria-label=\{`\$\{badge\.title\}\. Подробнее`\}/);
  assert.match(badges, /event\.key === "Escape"/);
  assert.match(badges, /contains\(event\.target as Node\)/);
  assert.match(adminBadges, /Больше не назначается автоматически/);
  assert.match(home, /order\("published_at"/);
  assert.match(catalog, /order\("full_name"/);
  assert.doesNotMatch(home, /supports_project|donation|supporter/);
  assert.doesNotMatch(catalog, /supports_project|donation|supporter/);
});
