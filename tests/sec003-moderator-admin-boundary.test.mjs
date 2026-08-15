import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationPath = 'supabase/forward-migrations/20260813163013_sec003_moderator_admin_boundary.sql';

test('SEC-003 revokes privileged client DML and exposes only named action functions', async () => {
  const migration = await read(migrationPath);
  for (const table of [
    'specialists', 'verifications', 'moderators', 'categories', 'trust_badges',
    'specialist_trust_badges', 'audit_log',
  ]) {
    assert.match(migration, new RegExp(`revoke insert, update, delete on table public\\.${table}[\\s\\S]*from public, anon, authenticated`, 'i'));
  }
  assert.match(migration, /revoke update, delete on table public\.reviews from public, anon, authenticated/);
  assert.match(migration, /revoke update, delete on table public\.complaints from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete) on table public\./i);
  for (const name of [
    'moderator_decide_application', 'apply_specialist_revision',
    'admin_update_specialist_controls', 'admin_set_manual_trust_badges',
    'admin_update_site_content', 'admin_set_moderator_role',
  ]) assert.match(migration, new RegExp(`create or replace function public\\.${name}`));
});

test('role and AAL decisions are authoritative and every exposed definer has a fixed search path', async () => {
  const migration = await read(migrationPath);
  assert.match(migration, /private\.require_current_moderator\(\)/);
  assert.match(migration, /select 1 from public\.moderators where user_id = actor/);
  assert.match(migration, /private\.require_current_admin_aal2\(\)/);
  assert.match(migration, /auth\.jwt\(\) ->> 'aal'/);
  assert.match(migration, /coalesce\(auth\.jwt\(\) ->> 'aal', ''\) <> 'aal2'/);
  assert.doesNotMatch(migration, /p_(?:actor|owner|role|aal)_id/i);
  const exposedDefinitions = [...migration.matchAll(/create or replace function public\.[\s\S]*?\$\$;/g)].map((match) => match[0]);
  assert.ok(exposedDefinitions.length >= 10);
  for (const definition of exposedDefinitions) {
    if (/security definer/i.test(definition)) assert.match(definition, /set search_path = pg_catalog/i);
  }
});

test('application and profile state machines lock rows and deny invalid transitions', async () => {
  const migration = await read(migrationPath);
  assert.match(migration, /from public\.applications[\s\S]*for update/);
  assert.match(migration, /Application changed after review/);
  assert.match(migration, /Application transition is not allowed/);
  assert.match(migration, /Admin profile transition is not allowed/);
  assert.match(migration, /Revision has already been decided/);
  assert.match(migration, /private\.append_privileged_audit/);
  assert.match(migration, /revoke all on function private\.append_privileged_audit/);
});

test('server actions use exact RPC payloads and require AAL2 for sensitive admin actions', async () => {
  const [actions, auth] = await Promise.all([
    read('src/app/admin/actions.ts'),
    read('src/lib/auth.ts'),
  ]);
  assert.match(auth, /export async function requireAdminAal2/);
  assert.match(auth, /auth\.mfa\.getAuthenticatorAssuranceLevel\(\)/);
  assert.match(auth, /data\.currentLevel !== "aal2"/);
  for (const rpc of [
    'moderator_decide_application_v2', 'admin_delete_application',
    'admin_transition_application', 'admin_delete_revision',
    'admin_update_specialist_controls', 'admin_set_manual_trust_badges',
    'admin_update_site_content', 'admin_retry_email_notification',
  ]) assert.match(actions, new RegExp(`rpc\\("${rpc}"`));
  assert.match(actions, /moderator_decide_revision_v2/);
  assert.match(actions, /approve_application_with_canonical_media_v3/);
  assert.match(actions, /apply_specialist_revision_with_canonical_media_v3/);
  assert.doesNotMatch(actions, /from\("specialists"\)\.update/);
  assert.doesNotMatch(actions, /from\("verifications"\)\.(?:upsert|delete|update)/);
  assert.doesNotMatch(actions, /from\("audit_log"\)\.insert/);
});
