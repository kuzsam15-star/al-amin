import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationPath = "supabase/migrations/20260809001646_enforce_server_only_specialist_writes.sql";

test("the future migration denies direct Data API writes independently of contract_version", async () => {
  const migration = await read(migrationPath);
  for (const table of ["applications", "specialist_revisions"]) {
    assert.match(migration, new RegExp(`revoke insert, update, delete on table public\\.${table}[\\s\\S]*?from public, anon, authenticated`, "i"));
  }
  for (const policy of [
    "Authenticated owners submit applications", "Authenticated users submit their own applications",
    "Anonymous users submit unowned applications", "Anyone submits application", "Owners update own applications",
    "Owners create own revisions", "Owners update pending revisions",
  ]) assert.match(migration, new RegExp(`drop policy if exists "${policy}"`));
  assert.doesNotMatch(migration, /create policy .*owners.*(?:insert|update|delete)/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)/i);
});

test("v2 guards preserve legacy reads and status decisions but reject new or changed v1 content", async () => {
  const migration = await read(migrationPath);
  assert.match(migration, /if tg_op = 'INSERT'[\s\S]*new\.contract_version is distinct from 2/);
  assert.match(migration, /Changed application content must use contract version 2/);
  assert.match(migration, /new\.payload->>'contract_version' is distinct from '2'/);
  assert.match(migration, /before insert or update on public\.applications/);
  assert.match(migration, /before insert or update of payload on public\.specialist_revisions/);
  assert.doesNotMatch(migration, /update public\.(?:applications|specialist_revisions)/i);
  assert.doesNotMatch(migration, /delete from public\.(?:applications|specialist_revisions)/i);
});

test("application and revision writes authenticate first and use a server-only service client", async () => {
  const [route, cabinet, serverClient] = await Promise.all([
    read("src/app/api/applications/route.ts"), read("src/app/cabinet/actions.ts"), read("src/lib/supabase/server.ts"),
  ]);
  for (const source of [route, cabinet]) {
    assert.match(source, /auth\.getUser\(\)/);
    assert.match(source, /createSupabaseAdminClient/);
    assert.match(source, /owner_id: user\.id/);
    assert.match(source, /contract_version: 2/);
  }
  assert.match(route, /hasTrustedOrigin/);
  assert.match(route, /maximumRequestBytes/);
  assert.match(route, /activeCategories/);
  assert.match(route, /status: "new"/);
  assert.match(cabinet, /\.eq\("owner_id", user\.id\)/);
  assert.match(serverClient, /SUPABASE_SERVICE_ROLE_KEY|supabaseServiceConfig/);
  assert.doesNotMatch(serverClient, /NEXT_PUBLIC_SUPABASE_SERVICE/);
});

test("client-controlled owner, status, contract and moderation fields are outside both allowlists", async () => {
  const validation = await read("src/lib/application-validation.mjs");
  const applicationKeys = validation.match(/export const APPLICATION_INPUT_KEYS = \[([\s\S]*?)\];/)?.[1] ?? "";
  const revisionKeys = validation.match(/export const PROFILE_REVISION_INPUT_KEYS = \[([\s\S]*?)\];/)?.[1] ?? "";
  for (const forbidden of ["owner_id", "ownerId", "status", "contract_version", "internal_notes", "moderator_id", "verification"]) {
    assert.doesNotMatch(applicationKeys, new RegExp(`"${forbidden}"`));
    assert.doesNotMatch(revisionKeys, new RegExp(`"${forbidden}"`));
  }
  assert.match(validation, /Запрос содержит неподдерживаемые поля/);
});

test("moderation table writes that lose authenticated grants also use the service path", async () => {
  const actions = await read("src/app/admin/actions.ts");
  assert.match(actions, /const admin = createSupabaseAdminClient\(\)/);
  assert.match(actions, /admin_delete_application/);
  assert.match(actions, /admin_transition_application/);
  assert.match(actions, /admin_delete_revision/);
  assert.doesNotMatch(actions, /from\("applications"\)\.update/);
  assert.doesNotMatch(actions, /from\("specialist_revisions"\)\.delete/);
  assert.match(actions, /requireModerator\(\)/);
  assert.match(actions, /requireAdminAal2\(\)/);
});
