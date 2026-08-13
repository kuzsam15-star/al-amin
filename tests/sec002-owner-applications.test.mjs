import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const migration = read('supabase/forward-migrations/20260813154850_sec002_owner_safe_applications_projection.sql');

test('SEC-002 migration replaces broad application SELECT with an explicit security-invoker contract', () => {
  assert.match(migration, /revoke select on table public\.applications from public, anon, authenticated/i);
  assert.match(migration, /grant select \([\s\S]*?\) on table public\.applications to authenticated/i);
  assert.match(migration, /create or replace view public\.owner_applications_v1[\s\S]*?security_invoker\s*=\s*true/i);
  assert.match(migration, /security_barrier\s*=\s*true/i);
  const view = migration.match(/create or replace view public\.owner_applications_v1[\s\S]*?from public\.applications;/i)?.[0] ?? '';
  assert.ok(view);
  assert.doesNotMatch(view, /select\s+\*/i);
  for (const protectedColumn of ['internal_notes', 'call_at', 'owner_id', 'contract_version', 'status_updated_at']) {
    assert.doesNotMatch(view, new RegExp(`\\b${protectedColumn}\\b`, 'i'));
  }
  assert.match(migration, /has_column_privilege\('authenticated', 'public\.applications', 'internal_notes', 'SELECT'\)/i);
  assert.match(migration, /has_column_privilege\('authenticated', 'public\.applications', 'call_at', 'SELECT'\)/i);
  assert.match(migration, /create policy "Owners read own application events"[\s\S]*?from public\.owner_applications_v1/i);
});

test('owner-facing source uses only owner_applications_v1', () => {
  const ownerFiles = [
    'src/app/cabinet/page.tsx',
    'src/app/apply/page.tsx',
    'src/app/api/media/source/route.ts',
    'src/app/api/media/view/route.ts',
  ];
  for (const path of ownerFiles) {
    const source = read(path);
    assert.match(source, /from\("owner_applications_v1"\)/);
    assert.doesNotMatch(source, /from\("applications"\)/);
    assert.doesNotMatch(source, /from\("owner_applications_v1"\)\.select\("\*"\)/);
    assert.doesNotMatch(source, /internal_notes|call_at/);
  }
});

test('trusted moderation source uses the server-only client and explicit application fields', () => {
  const page = read('src/app/admin/page.tsx');
  const actions = read('src/app/admin/actions.ts');
  assert.match(page, /const supabase = createSupabaseAdminClient\(\)/);
  assert.doesNotMatch(page, /from\("applications"\)\.select\("\*"\)/);
  assert.match(page, /from\("applications"\)\.select\("[^"]*internal_notes[^"]*"\)/);
  assert.match(actions, /const admin = createSupabaseAdminClient\(\);[\s\S]*?admin\.from\("applications"\)\.select\("status,owner_id,main_image_path,gallery_paths,updated_at"\)/);
});
