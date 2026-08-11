import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { runCommand, redactCommandError } from './helpers/command.mjs';
import { cleanupLocalStack, createLocalStack, queryLocalSql } from './helpers/local-stack.mjs';
import { createTotp } from './helpers/totp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const expectedHeadBaselineHash = 'CF61CDB37D9B82B3AFFFF035A0EAF68B1FABC2022C261F87027AE95583C153E1';
const requiredConfirmation = '1';
const requiredProjectPrefix = 'alamin-role-matrix-';
const requiredSupabaseVersion = '2.113.0';
const requiredDockerContext = 'desktop-linux';

const casesDocument = JSON.parse(await readFile(join(here, 'cases.json'), 'utf8'));
const expectedDocument = JSON.parse(await readFile(join(here, 'expected-failures.json'), 'utf8'));
const caseById = new Map(casesDocument.cases.map((entry) => [entry.id, entry]));
const expectedFailures = new Map(Object.entries(expectedDocument.entries));

const unsafeEnvironmentNames = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_PROJECT_ID',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'DATABASE_URL',
  'POSTGRES_PASSWORD',
  'PGPASSWORD',
];

function sanitizedEnvironment() {
  const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' };
  for (const name of unsafeEnvironmentNames) delete env[name];
  return env;
}

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`Required local executable is absent: ${candidates.join(', ')}`);
}

async function resolveToolchain(env) {
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const supabaseBin = await firstExecutable([
    process.env.ALAMIN_SUPABASE_BIN,
    join(localAppData, 'Programs', 'SupabaseCLI', requiredSupabaseVersion, 'supabase.exe'),
  ].filter(Boolean));
  const dockerBin = await firstExecutable([
    process.env.ALAMIN_DOCKER_BIN,
    join(localAppData, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'),
    'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
  ].filter(Boolean));

  const supabaseVersion = (await runCommand(supabaseBin, ['--version'], { env })).stdout.trim();
  if (!supabaseVersion.includes(requiredSupabaseVersion)) {
    throw new Error(`Pinned Supabase CLI ${requiredSupabaseVersion} is required`);
  }
  const context = (await runCommand(dockerBin, ['context', 'show'], { env })).stdout.trim();
  if (context !== requiredDockerContext) {
    throw new Error(`Docker context must be ${requiredDockerContext}`);
  }
  const dockerInfo = await runCommand(
    dockerBin,
    ['info', '--format', '{{.OSType}}|{{.ServerVersion}}|{{json .SecurityOptions}}'],
    { env },
  );
  if (!dockerInfo.stdout.startsWith('linux|')) throw new Error('A local Linux Docker engine is required');
  if (/tcp:\/\//iu.test(process.env.DOCKER_HOST ?? '')) {
    throw new Error('DOCKER_HOST must not expose a TCP daemon');
  }
  return { supabaseBin, dockerBin, supabaseVersion, context, dockerInfo: dockerInfo.stdout.trim() };
}

async function validateLocalOnlyGuard(toolchain, env) {
  if (process.env.ALAMIN_SECURITY_LOCAL_ONLY !== requiredConfirmation) {
    throw new Error('Set ALAMIN_SECURITY_LOCAL_ONLY=1 to acknowledge disposable local-only execution');
  }
  const baseline = await readFile(join(repoRoot, 'supabase', 'bootstrap', 'baseline.sql'));
  const hash = createHash('sha256').update(baseline).digest('hex').toUpperCase();
  if (hash !== expectedHeadBaselineHash) throw new Error('Verified bootstrap baseline hash changed');
  const remote = await runCommand('git', ['-c', `safe.directory=${repoRoot.replaceAll('\\', '/')}`, 'remote'], { cwd: repoRoot, env });
  if (remote.stdout.trim()) throw new Error('Harness refuses a repository with a configured Git remote');
  return { baselineHash: hash, toolchain };
}

function clientOptions() {
  return {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-ALAMIN-TEST': 'synthetic-local-only' } },
  };
}

async function signedInClient(apiUrl, anonKey, email, password) {
  const client = createClient(apiUrl, anonKey, clientOptions());
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Synthetic local sign-in failed: ${error?.message ?? 'no session'}`);
  return client;
}

async function createSyntheticUsers(stack) {
  const service = createClient(stack.apiUrl, stack.serviceRoleKey, clientOptions());
  const definitions = [
    ['userA', 'user-a'],
    ['userB', 'user-b'],
    ['moderator', 'moderator'],
    ['adminAal1', 'admin'],
  ];
  const users = {};
  for (const [key, label] of definitions) {
    const email = `${label}-${stack.projectId.slice(-8)}@example.invalid`;
    const password = `L0cal!${randomBytes(18).toString('base64url')}`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    });
    if (error || !data.user) throw new Error(`Synthetic Auth fixture creation failed: ${error?.message ?? 'no user'}`);
    users[key] = {
      id: data.user.id,
      client: await signedInClient(stack.apiUrl, stack.anonKey, email, password),
    };
  }

  const { error: roleError } = await service.from('moderators').insert([
    { user_id: users.moderator.id, role: 'moderator' },
    { user_id: users.adminAal1.id, role: 'admin' },
  ]);
  if (roleError) throw new Error(`Synthetic role fixtures failed: ${roleError.message}`);
  return { service, users };
}

const webp = Buffer.from('UklGRiIAAABXRUJQVlA4ICAAAADQAQCdASoBAAEAAUAmJQBOgCHwAP7+AAAAAA=', 'base64');
const webpReplacement = Buffer.from('UklGRiIAAABXRUJQVlA4ICAAAADQAQCdASoBAAEAAUAmJaQAA3AA/v7gAA==', 'base64');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==', 'base64');

function commonContract() {
  return {
    contract_version: 2,
    profile_summary: 'Synthetic profile summary',
    help_topics: [{ title: 'Synthetic help', description: 'Synthetic description for a local-only fixture.' }],
    work_offers: [{ title: 'Synthetic offer', mode: 'online' }],
  };
}

async function insertFixture(service, table, value) {
  const { error } = await service.from(table).insert(value);
  if (error) throw new Error(`Synthetic ${table} fixture failed: ${error.message}`);
}

async function buildFixtures(stack, service, users) {
  const ids = Object.fromEntries([
    'category', 'appA', 'appB', 'specialistA', 'specialistB', 'verificationA',
    'reviewPublished', 'reviewUnpublished', 'revisionA', 'revisionB', 'badge', 'badgeAssignment',
    'emailA', 'emailB', 'eventPublicA', 'eventInternalA', 'eventPublicB',
  ].map((name) => [name, randomUUID()]));
  const canonicalPath = `submissions/${users.userA.id}/avatar/${randomUUID()}.webp`;
  const canonicalPathB = `submissions/${users.userB.id}/avatar/${randomUUID()}.webp`;
  const avatarPath = `synthetic/${stack.projectId}.webp`;

  const ownerUpload = await users.userA.client.storage.from('profile-media').upload(canonicalPath, webp, {
    contentType: 'image/webp',
    upsert: false,
  });
  if (ownerUpload.error) throw new Error(`Synthetic owner media fixture failed: ${ownerUpload.error.message}`);
  const userBUpload = await users.userB.client.storage.from('profile-media').upload(canonicalPathB, webp, {
    contentType: 'image/webp',
    upsert: false,
  });
  if (userBUpload.error) throw new Error(`Synthetic user B media fixture failed: ${userBUpload.error.message}`);
  const avatarUpload = await service.storage.from('avatars').upload(avatarPath, webp, {
    contentType: 'image/webp',
    upsert: false,
  });
  if (avatarUpload.error) throw new Error(`Synthetic avatar fixture failed: ${avatarUpload.error.message}`);

  await insertFixture(service, 'categories', {
    id: ids.category,
    name: `Synthetic ${stack.projectId.slice(-8)}`,
    slug: `synthetic-${stack.projectId.slice(-8)}`,
    group_name: 'Synthetic Group',
    is_active: true,
  });

  const description = 'Synthetic local-only application description long enough to satisfy the verified contract.';
  const applicationBase = {
    contact: 'fixture-contact@example.invalid',
    country: 'Synthetic Country',
    city: 'Synthetic City',
    category_text: 'Synthetic Category',
    category_id: ids.category,
    specialization: 'Synthetic specialization',
    description,
    services: 'Synthetic offer',
    experience_years: 5,
    consent_truthful: true,
    consent_personal_data: true,
    ...commonContract(),
  };
  await insertFixture(service, 'applications', [
    {
      ...applicationBase,
      id: ids.appA,
      owner_id: users.userA.id,
      full_name: 'Synthetic User A',
      status: 'screening',
      internal_notes: 'Synthetic internal note',
      call_at: '2099-01-01T00:00:00Z',
    },
    {
      ...applicationBase,
      id: ids.appB,
      owner_id: users.userB.id,
      full_name: 'Synthetic User B',
      status: 'new',
      internal_notes: 'Synthetic internal note B',
    },
  ]);

  const specialistBase = {
    category_id: ids.category,
    country: 'Synthetic Country',
    city: 'Synthetic City',
    specialization: 'Synthetic specialization',
    services: ['Synthetic offer'],
    service_mode: 'online',
    experience_years: 5,
    short_description: 'Synthetic profile summary',
    full_description: 'Synthetic local-only specialist description long enough to satisfy the verified contract.',
    public_contact: 'public-fixture@example.invalid',
    ...commonContract(),
  };
  await insertFixture(service, 'specialists', [
    {
      ...specialistBase,
      id: ids.specialistA,
      owner_id: users.userA.id,
      application_id: ids.appA,
      slug: `synthetic-a-${stack.projectId.slice(-8)}`,
      full_name: 'Synthetic Specialist A',
      avatar_path: canonicalPath,
      status: 'published',
      published_at: new Date().toISOString(),
    },
    {
      ...specialistBase,
      id: ids.specialistB,
      owner_id: users.userB.id,
      application_id: ids.appB,
      slug: `synthetic-b-${stack.projectId.slice(-8)}`,
      full_name: 'Synthetic Specialist B',
      avatar_path: null,
      status: 'draft',
    },
  ]);

  await insertFixture(service, 'verifications', {
    id: ids.verificationA,
    specialist_id: ids.specialistA,
    identity_checked: true,
    education_checked: true,
    checked_by: users.adminAal1.id,
    checked_at: new Date().toISOString(),
    private_notes: 'Synthetic verification note',
  });
  await insertFixture(service, 'reviews', [
    {
      id: ids.reviewPublished,
      specialist_id: ids.specialistA,
      author_contact: 'reviewer@example.invalid',
      body: 'Synthetic published review body for local security verification.',
      would_hire_again: true,
      evidence_checked: true,
      is_published: true,
    },
    {
      id: ids.reviewUnpublished,
      specialist_id: ids.specialistB,
      author_contact: 'private-reviewer@example.invalid',
      body: 'Synthetic unpublished review body for local security verification.',
      would_hire_again: false,
      evidence_checked: false,
      is_published: false,
    },
  ]);
  await insertFixture(service, 'site_content', {
    id: true,
    brand_name: 'Synthetic Brand',
    tagline: 'Synthetic tagline',
    hero_title: 'Synthetic hero',
    hero_text: 'Synthetic hero text',
    contact_email: 'site@example.invalid',
    about_text: 'Synthetic about text',
    rules_intro: 'Synthetic rules text',
    privacy_text: 'Synthetic privacy text',
    seo_title: 'Synthetic SEO title',
    seo_description: 'Synthetic SEO description',
    updated_by: users.adminAal1.id,
  });
  await insertFixture(service, 'trust_badges', {
    id: ids.badge,
    code: `synthetic_${stack.projectId.slice(-8)}`,
    title: 'Synthetic badge',
    description: 'Synthetic trust badge used only by the disposable local harness.',
    icon: 'shield',
    assignment_type: 'manual',
    is_active: true,
  });
  await insertFixture(service, 'specialist_trust_badges', {
    id: ids.badgeAssignment,
    specialist_id: ids.specialistA,
    badge_id: ids.badge,
    assigned_by: users.adminAal1.id,
    source: 'manual',
    admin_note: 'Synthetic assignment',
  });

  const revisionPayload = (owner, suffix, avatar = '') => ({
    contract_version: 2,
    full_name: `Synthetic Revision ${suffix}`,
    country: 'Synthetic Country',
    city: 'Synthetic City',
    category_id: ids.category,
    additional_category_ids: [],
    specialization: 'Synthetic revision specialization',
    experience_years: 6,
    profile_summary: 'Synthetic revised profile summary',
    full_description: 'Synthetic revised specialist description long enough for the verified contract.',
    help_topics: [{ title: 'Synthetic revised help', description: 'Synthetic revised description.' }],
    work_offers: [{ title: 'Synthetic revised offer', mode: 'online' }],
    avatar_path: avatar,
  });
  await insertFixture(service, 'specialist_revisions', [
    {
      id: ids.revisionA,
      specialist_id: ids.specialistA,
      owner_id: users.userA.id,
      payload: revisionPayload(users.userA.id, 'A', canonicalPath),
      status: 'pending',
    },
    {
      id: ids.revisionB,
      specialist_id: ids.specialistB,
      owner_id: users.userB.id,
      payload: revisionPayload(users.userB.id, 'B', canonicalPathB),
      status: 'pending',
    },
  ]);
  await insertFixture(service, 'email_notifications', [
    {
      id: ids.emailA,
      event_type: 'application_under_review',
      user_id: users.userA.id,
      recipient_email: 'user-a@example.invalid',
      application_id: ids.appA,
      subject: 'Synthetic A',
      idempotency_key: `synthetic-a-${stack.projectId}`,
    },
    {
      id: ids.emailB,
      event_type: 'application_submitted',
      user_id: users.userB.id,
      recipient_email: 'user-b@example.invalid',
      application_id: ids.appB,
      subject: 'Synthetic B',
      idempotency_key: `synthetic-b-${stack.projectId}`,
    },
  ]);
  await insertFixture(service, 'application_events', [
    { id: ids.eventPublicA, application_id: ids.appA, actor_id: users.userA.id, event_type: 'submitted', message: 'Synthetic public event A', is_internal: false },
    { id: ids.eventInternalA, application_id: ids.appA, actor_id: users.moderator.id, event_type: 'status_changed', message: 'Synthetic internal event A', is_internal: true },
    { id: ids.eventPublicB, application_id: ids.appB, actor_id: users.userB.id, event_type: 'submitted', message: 'Synthetic public event B', is_internal: false },
  ]);

  return { ids, canonicalPath, canonicalPathB, avatarPath, ownerUpload, revisionPayload };
}

function createRecorder() {
  const results = [];
  const seen = new Set();
  return {
    record(id, secure, evidence, skipReason = null) {
      if (!caseById.has(id)) throw new Error(`Unknown case ID ${id}`);
      if (seen.has(id)) throw new Error(`Case ${id} was recorded twice`);
      seen.add(id);
      const secIds = expectedFailures.get(id) ?? [];
      let result;
      if (skipReason) result = 'SKIP';
      else if (secure && secIds.length > 0) result = 'XPASS';
      else if (!secure && secIds.length > 0) result = 'XFAIL';
      else result = secure ? 'PASS' : 'FAIL';
      results.push({
        id,
        result,
        SEC_ID: secIds,
        evidence: skipReason ? `SKIP: ${skipReason}` : evidence,
      });
    },
    finalize() {
      const missing = casesDocument.cases.map((entry) => entry.id).filter((id) => !seen.has(id));
      if (missing.length) throw new Error(`Cases not executed: ${missing.join(', ')}`);
      return results.sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}

function deniedOrEmpty({ data, error }) {
  return Boolean(error) || (Array.isArray(data) && data.length === 0);
}

async function rowValue(service, table, id, field, keyField = 'id') {
  const { data, error } = await service.from(table).select(field).eq(keyField, id).maybeSingle();
  if (error) throw new Error(`Fixture verification failed for ${table}: ${error.message}`);
  return data?.[field];
}

async function rowExists(service, table, id) {
  const { data, error } = await service.from(table).select('id').eq('id', id).maybeSingle();
  if (error) throw new Error(`Fixture existence check failed for ${table}: ${error.message}`);
  return Boolean(data);
}

async function storageBytes(service, bucket, path) {
  const { data, error } = await service.storage.from(bucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

function sameBytes(left, right) {
  if (!left || !right) return false;
  return createHash('sha256').update(left).digest('hex') === createHash('sha256').update(right).digest('hex');
}

async function attemptUpdate({ actor, service, table, id, changes, verifyField, restoreValue, keyField = 'id' }) {
  await actor.from(table).update(changes).eq(keyField, id).select(keyField);
  const actual = await rowValue(service, table, id, verifyField, keyField);
  const changed = JSON.stringify(actual) !== JSON.stringify(restoreValue);
  if (changed) await service.from(table).update({ [verifyField]: restoreValue }).eq(keyField, id);
  return !changed;
}

async function attemptDelete({ actor, service, table, id }) {
  await actor.from(table).delete().eq('id', id);
  return await rowExists(service, table, id);
}

async function attemptInsert({ actor, service, table, value }) {
  await actor.from(table).insert(value);
  return !(await rowExists(service, table, value.id));
}

async function enableAal2(adminClient, stack) {
  try {
    const enrolled = await adminClient.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `local-${stack.projectId.slice(-8)}`,
    });
    if (enrolled.error || !enrolled.data?.totp?.secret || !enrolled.data.id) {
      return { ok: false, reason: enrolled.error?.message ?? 'local Auth returned no TOTP secret' };
    }
    const verified = await adminClient.auth.mfa.challengeAndVerify({
      factorId: enrolled.data.id,
      code: createTotp(enrolled.data.totp.secret),
    });
    if (verified.error) return { ok: false, reason: verified.error.message };
    const assurance = await adminClient.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data.currentLevel !== 'aal2') {
      return { ok: false, reason: assurance.error?.message ?? 'session did not reach AAL2' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function runCatalogCases(recorder, stack, toolchain, env) {
  recorder.record('LOCAL-001', stack.baselineVerified, 'verified no-data bootstrap replay passed');

  const rlsMissing = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
  `));
  recorder.record('CAT-001', rlsMissing === 0, `${rlsMissing} application tables without RLS`);

  const unsafeViews = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v'
      and not coalesce('security_invoker=true'=any(c.reloptions),false);
  `));
  recorder.record('CAT-002', unsafeViews === 0, `${unsafeViews} public projections lack security_invoker`);

  const exposedFunctions = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and p.proname not in ('is_moderator','is_admin','apply_specialist_revision','request_specialist_revision_changes')
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'));
  `));
  recorder.record('CAT-003', exposedFunctions === 0, `${exposedFunctions} internal definer functions executable by client roles`);

  const mutableSearchPath = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig,'{}')) setting
        where setting like 'search_path=pg_catalog%'
      );
  `));
  recorder.record('CAT-004', mutableSearchPath === 0, `${mutableSearchPath} definer functions lack pg_catalog-first search_path`);

  const broadDefaults = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from pg_default_acl d
    cross join lateral aclexplode(coalesce(d.defaclacl,acldefault(d.defaclobjtype,d.defaclrole))) a
    join pg_roles r on r.oid=a.grantee
    where r.rolname in ('anon','authenticated') and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','EXECUTE','USAGE');
  `));
  recorder.record('CAT-005', broadDefaults === 0, `${broadDefaults} broad client default-privilege entries`);

  const profilePolicy = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from pg_policies where schemaname='public' and tablename='account_profiles' and cmd='UPDATE';
  `));
  recorder.record('CAT-006', profilePolicy === 0, `${profilePolicy} owner UPDATE policies remain`);

  const feedbackPolicies = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from pg_policies where schemaname='public' and tablename in ('reviews','complaints') and cmd='INSERT';
  `));
  recorder.record('CAT-007', feedbackPolicies === 0, `${feedbackPolicies} direct feedback INSERT policies remain`);

  const webpOnly = (await queryLocalSql(stack, toolchain.dockerBin, env, `
    select allowed_mime_types = array['image/webp']::text[] from storage.buckets where id='profile-media';
  `)) === 't';
  recorder.record('CAT-008', webpOnly, webpOnly ? 'WebP-only bucket contract' : 'profile-media allows non-WebP image MIME types');
}

async function runBehaviorCases(recorder, stack, service, users, fixtures, toolchain, env) {
  const anon = createClient(stack.apiUrl, stack.anonKey, clientOptions());
  const { ids, canonicalPath, avatarPath } = fixtures;

  recorder.record('READ-001', deniedOrEmpty(await anon.from('applications').select('id')), 'anonymous application read returned no rows');
  recorder.record('READ-002', deniedOrEmpty(await users.userA.client.from('applications').select('id').eq('id', ids.appB)), 'user A cannot read user B application');
  recorder.record('READ-003', deniedOrEmpty(await users.userB.client.from('applications').select('id').eq('id', ids.appA)), 'user B cannot read user A application');
  const own = await users.userA.client.from('applications').select('id').eq('id', ids.appA);
  recorder.record('READ-004', !own.error && own.data?.length === 1, 'owner can read own application row');
  const protectedRead = await users.userA.client.from('applications').select('internal_notes,call_at').eq('id', ids.appA);
  recorder.record('READ-005', Boolean(protectedRead.error) || protectedRead.data?.length === 0, 'direct protected-column projection evaluated without logging values');
  recorder.record('READ-006', deniedOrEmpty(await anon.from('specialists').select('id')), 'anonymous base specialist read returned no rows');
  recorder.record('READ-007', deniedOrEmpty(await anon.from('reviews').select('id')), 'anonymous base review read boundary evaluated');
  recorder.record('READ-008', deniedOrEmpty(await anon.from('verifications').select('id')), 'anonymous base verification read returned no rows');

  recorder.record('APP-001', await attemptUpdate({ actor: users.userA.client, service, table: 'applications', id: ids.appB, changes: { applicant_message: 'Synthetic foreign edit' }, verifyField: 'applicant_message', restoreValue: null }), 'foreign application update did not persist');
  recorder.record('APP-002', await attemptDelete({ actor: users.userA.client, service, table: 'applications', id: ids.appB }), 'foreign application delete did not persist');
  recorder.record('APP-003', await attemptUpdate({ actor: users.userA.client, service, table: 'applications', id: ids.appA, changes: { owner_id: users.userB.id }, verifyField: 'owner_id', restoreValue: users.userA.id }), 'owner transfer did not persist');
  recorder.record('APP-004', await attemptUpdate({ actor: users.userA.client, service, table: 'applications', id: ids.appA, changes: { internal_notes: 'Synthetic unauthorized change' }, verifyField: 'internal_notes', restoreValue: 'Synthetic internal note' }), 'owner internal-note update did not persist');
  recorder.record('APP-005', await attemptUpdate({ actor: users.userA.client, service, table: 'applications', id: ids.appA, changes: { status: 'approved' }, verifyField: 'status', restoreValue: 'screening' }), 'owner status transition did not persist');

  recorder.record('SPEC-001', await attemptUpdate({ actor: users.userA.client, service, table: 'specialists', id: ids.specialistA, changes: { full_name: 'Synthetic direct owner edit' }, verifyField: 'full_name', restoreValue: 'Synthetic Specialist A' }), 'owner direct published-profile update did not persist');
  recorder.record('SPEC-002', deniedOrEmpty(await users.userB.client.from('specialist_revisions').select('id').eq('id', ids.revisionA)), 'user B cannot read user A revision');
  recorder.record('SPEC-003', await attemptUpdate({ actor: users.moderator.client, service, table: 'specialists', id: ids.specialistA, changes: { owner_id: users.moderator.id }, verifyField: 'owner_id', restoreValue: users.userA.id }), 'moderator owner reassignment boundary evaluated');
  recorder.record('SPEC-004', await attemptUpdate({ actor: users.moderator.client, service, table: 'specialists', id: ids.specialistA, changes: { status: 'blocked' }, verifyField: 'status', restoreValue: 'published' }), 'moderator lifecycle boundary evaluated');
  recorder.record('SPEC-005', await attemptUpdate({ actor: users.moderator.client, service, table: 'verifications', id: ids.verificationA, changes: { qualifications_checked: true }, verifyField: 'qualifications_checked', restoreValue: false }), 'moderator protected verification boundary evaluated');

  const anonReviewId = randomUUID();
  recorder.record('FEEDBACK-001', await attemptInsert({ actor: anon, service, table: 'reviews', value: { id: anonReviewId, specialist_id: ids.specialistA, body: 'Synthetic anonymous review body long enough for local validation.', would_hire_again: false, is_published: false, evidence_checked: false } }), 'anonymous direct review insert checked through service-side existence');
  const anonComplaintId = randomUUID();
  recorder.record('FEEDBACK-002', await attemptInsert({ actor: anon, service, table: 'complaints', value: { id: anonComplaintId, specialist_id: ids.specialistA, reason: 'Synthetic reason', description: 'Synthetic anonymous complaint description for local-only validation.', reporter_contact: 'anonymous@example.invalid', status: 'new' } }), 'anonymous direct complaint insert checked through service-side existence');
  const authReviewId = randomUUID();
  recorder.record('FEEDBACK-003', await attemptInsert({ actor: users.userA.client, service, table: 'reviews', value: { id: authReviewId, specialist_id: ids.specialistA, body: 'Synthetic authenticated review body long enough for local validation.', would_hire_again: true, is_published: false, evidence_checked: false } }), 'authenticated direct review insert checked through service-side existence');

  recorder.record('PROFILE-001', await attemptUpdate({ actor: users.userA.client, service, table: 'account_profiles', id: users.userA.id, changes: { email: 'changed@example.invalid' }, verifyField: 'email', restoreValue: `user-a-${stack.projectId.slice(-8)}@example.invalid` }), 'mirrored email mutation boundary evaluated');
  const foreignProfile = await users.userA.client.from('account_profiles').update({ display_name: 'Synthetic foreign edit' }).eq('id', users.userB.id).select('id');
  recorder.record('PROFILE-002', deniedOrEmpty(foreignProfile), 'foreign account profile update returned no row');
  recorder.record('PROFILE-003', deniedOrEmpty(await anon.from('account_profiles').select('id')), 'anonymous account-profile read returned no rows');

  const ownPublicEvent = await users.userA.client.from('application_events').select('id').eq('id', ids.eventPublicA);
  recorder.record('EVENT-001', !ownPublicEvent.error && ownPublicEvent.data?.length === 1, 'owner can read own non-internal event');
  const privateEvents = await users.userA.client.from('application_events').select('id').in('id', [ids.eventInternalA, ids.eventPublicB]);
  recorder.record('EVENT-002', deniedOrEmpty(privateEvents), 'owner cannot read internal or foreign event');

  recorder.record('ROLE-001', deniedOrEmpty(await users.userA.client.from('moderators').select('role')), 'ordinary user has no moderator membership row');
  recorder.record('ROLE-002', await attemptUpdate({ actor: users.moderator.client, service, table: 'moderators', id: users.moderator.id, changes: { role: 'admin' }, verifyField: 'role', restoreValue: 'moderator', keyField: 'user_id' }), 'moderator self-promotion did not persist');
  recorder.record('ROLE-003', await attemptUpdate({ actor: users.moderator.client, service, table: 'applications', id: ids.appA, changes: { status: 'approved' }, verifyField: 'status', restoreValue: 'screening' }), 'AAL1 moderator status boundary evaluated');
  recorder.record('ROLE-004', await attemptUpdate({ actor: users.adminAal1.client, service, table: 'site_content', id: true, changes: { hero_title: 'Synthetic AAL1 change' }, verifyField: 'hero_title', restoreValue: 'Synthetic hero' }), 'AAL1 admin content boundary evaluated');

  const ordinaryRpc = await users.userA.client.rpc('apply_specialist_revision', { revision_uuid: ids.revisionA, approve: true, note: null });
  recorder.record('RPC-001', Boolean(ordinaryRpc.error), 'ordinary user revision-decision RPC denied');
  const moderatorRpc = await users.moderator.client.rpc('apply_specialist_revision', { revision_uuid: ids.revisionA, approve: true, note: null });
  recorder.record('RPC-002', Boolean(moderatorRpc.error), 'AAL1 moderator RPC boundary evaluated');

  const aal2 = await enableAal2(users.adminAal1.client, stack);
  if (aal2.ok) {
    const adminContent = await users.adminAal1.client.from('site_content').update({ hero_title: 'Synthetic AAL2 change' }).eq('id', true).select('id');
    recorder.record('ROLE-005', !adminContent.error && adminContent.data?.length === 1, 'real local TOTP session reached AAL2 and completed approved admin write');
    await service.from('site_content').update({ hero_title: 'Synthetic hero' }).eq('id', true);
    const adminRpc = await users.adminAal1.client.rpc('apply_specialist_revision', { revision_uuid: ids.revisionB, approve: true, note: null });
    recorder.record('RPC-003', !adminRpc.error, 'real local AAL2 admin session completed approved revision decision');
  } else {
    const safeReason = `local TOTP automation unavailable: ${aal2.reason}`.replace(/[A-Z0-9_-]{20,}/giu, '[redacted]');
    recorder.record('ROLE-005', false, '', safeReason);
    recorder.record('RPC-003', false, '', safeReason);
  }

  const viewContracts = {
    'VIEW-001': ['additional_category_ids','avatar_path','category_id','category_name','category_slug','city','country','experience_years','full_description','full_name','help_topics','id','profile_summary','published_at','service_mode','specialization','slug','work_offers'],
    'VIEW-002': ['body','created_at','id','specialist_id','would_hire_again'],
    'VIEW-003': ['checked_at','education_checked','experience_checked','identity_checked','qualifications_checked','references_checked','sources_checked','specialist_id'],
    'VIEW-004': ['assigned_at','badge_id','id','source','specialist_id'],
  };
  const viewNames = {
    'VIEW-001': 'published_specialists',
    'VIEW-002': 'published_reviews',
    'VIEW-003': 'published_specialist_verification_facts',
    'VIEW-004': 'published_specialist_trust_badges',
  };
  for (const [id, expectedColumns] of Object.entries(viewContracts)) {
    const result = await anon.from(viewNames[id]).select('*').limit(1);
    const columns = result.data?.[0] ? Object.keys(result.data[0]).sort() : [];
    recorder.record(id, !result.error && JSON.stringify(columns) === JSON.stringify([...expectedColumns].sort()), `${viewNames[id]} exact projection contract checked`);
  }
  const unpublishedReview = await anon.from('published_reviews').select('id').eq('id', ids.reviewUnpublished);
  recorder.record('VIEW-005', deniedOrEmpty(unpublishedReview), 'unpublished review excluded from public views');

  recorder.record('STORAGE-001', !fixtures.ownerUpload.error, 'owner WebP upload to own synthetic submission path succeeded');
  const foreignPath = `submissions/${users.userA.id}/foreign/foreign.webp`;
  const foreignUpload = await users.userB.client.storage.from('profile-media').upload(foreignPath, webp, { contentType: 'image/webp' });
  recorder.record('STORAGE-002', Boolean(foreignUpload.error) && (await storageBytes(service, 'profile-media', foreignPath)) === null, 'foreign-folder upload denied and no object persisted');
  const foreignRead = await users.userB.client.storage.from('profile-media').download(canonicalPath);
  recorder.record('STORAGE-003', Boolean(foreignRead.error), 'foreign private-object read denied');
  const foreignUpdate = await users.userB.client.storage.from('profile-media').update(canonicalPath, webpReplacement, { contentType: 'image/webp' });
  const afterForeignUpdate = await storageBytes(service, 'profile-media', canonicalPath);
  recorder.record('STORAGE-004', Boolean(foreignUpdate.error) && sameBytes(afterForeignUpdate, webp), 'foreign object update denied and bytes unchanged');
  const foreignDelete = await users.userB.client.storage.from('profile-media').remove([canonicalPath]);
  const afterForeignDelete = await storageBytes(service, 'profile-media', canonicalPath);
  recorder.record('STORAGE-005', sameBytes(afterForeignDelete, webp), 'foreign object delete denied and canonical bytes remain');
  const svgPath = `submissions/${users.userA.id}/formats/image.svg`;
  const svgUpload = await users.userA.client.storage.from('profile-media').upload(svgPath, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { contentType: 'image/svg+xml' });
  recorder.record('STORAGE-006', Boolean(svgUpload.error) && (await storageBytes(service, 'profile-media', svgPath)) === null, 'SVG upload denied by bucket MIME contract without persisting object');
  const pngPath = `submissions/${users.userA.id}/formats/image.png`;
  const pngUpload = await users.userA.client.storage.from('profile-media').upload(pngPath, png, { contentType: 'image/png' });
  recorder.record('STORAGE-007', Boolean(pngUpload.error) && (await storageBytes(service, 'profile-media', pngPath)) === null, 'direct PNG upload boundary evaluated');
  const jpegPath = `submissions/${users.userA.id}/formats/image.jpg`;
  const jpegUpload = await users.userA.client.storage.from('profile-media').upload(jpegPath, jpeg, { contentType: 'image/jpeg' });
  recorder.record('STORAGE-008', Boolean(jpegUpload.error) && (await storageBytes(service, 'profile-media', jpegPath)) === null, 'direct JPEG upload boundary evaluated');
  const invalidPath = `submissions/${users.userA.id}/formats/invalid.webp`;
  const invalidUpload = await users.userA.client.storage.from('profile-media').upload(invalidPath, Buffer.from('not-an-image'), { contentType: 'image/webp' });
  recorder.record('STORAGE-009', Boolean(invalidUpload.error) && (await storageBytes(service, 'profile-media', invalidPath)) === null, 'content-validation boundary evaluated without retaining output');
  const canonicalUpdate = await users.userA.client.storage.from('profile-media').update(canonicalPath, webpReplacement, { contentType: 'image/webp' });
  const afterCanonicalUpdate = await storageBytes(service, 'profile-media', canonicalPath);
  recorder.record('STORAGE-010', Boolean(canonicalUpdate.error) && sameBytes(afterCanonicalUpdate, webp), 'referenced canonical object replacement boundary evaluated with byte comparison');
  const oversizedPath = `submissions/${users.userA.id}/formats/oversized.webp`;
  const oversized = await users.userA.client.storage.from('profile-media').upload(oversizedPath, Buffer.alloc(5 * 1024 * 1024 + 1), { contentType: 'image/webp' });
  recorder.record('STORAGE-011', Boolean(oversized.error) && (await storageBytes(service, 'profile-media', oversizedPath)) === null, 'upload above configured bucket limit denied without persisting object');
  const anonMedia = await anon.storage.from('profile-media').download(canonicalPath);
  recorder.record('STORAGE-012', Boolean(anonMedia.error), 'anonymous private profile-media read denied');
  const anonAvatar = await anon.storage.from('avatars').download(avatarPath);
  recorder.record('STORAGE-013', !anonAvatar.error && anonAvatar.data?.size > 0, 'public synthetic avatar read succeeded');
  const moderatorAvatarPath = `synthetic/moderator-${stack.projectId}.webp`;
  const moderatorAvatar = await users.moderator.client.storage.from('avatars').upload(moderatorAvatarPath, webp, { contentType: 'image/webp' });
  recorder.record('STORAGE-014', !moderatorAvatar.error && (await storageBytes(service, 'avatars', moderatorAvatarPath)) !== null, 'moderator synthetic avatar upload succeeded');

  const categories = await anon.from('categories').select('id').eq('id', ids.category);
  recorder.record('CONTENT-001', !categories.error && categories.data?.length === 1, 'active category public read succeeded');
  recorder.record('CONTENT-002', await attemptUpdate({ actor: users.userA.client, service, table: 'site_content', id: true, changes: { tagline: 'Synthetic unauthorized tagline' }, verifyField: 'tagline', restoreValue: 'Synthetic tagline' }), 'ordinary user content update did not persist');
  recorder.record('CONTENT-003', await attemptUpdate({ actor: users.moderator.client, service, table: 'trust_badges', id: ids.badge, changes: { title: 'Synthetic unauthorized badge' }, verifyField: 'title', restoreValue: 'Synthetic badge' }), 'moderator admin-only badge update did not persist');
  const sitePublic = await anon.from('site_content').select('updated_by').eq('id', true);
  recorder.record('CONTENT-004', Boolean(sitePublic.error) || sitePublic.data?.length === 0, 'public operational actor column boundary evaluated without logging identifier');
  recorder.record('CONTENT-005', await attemptUpdate({ actor: users.moderator.client, service, table: 'categories', id: ids.category, changes: { name: 'Synthetic unauthorized category' }, verifyField: 'name', restoreValue: `Synthetic ${stack.projectId.slice(-8)}` }), 'moderator category update did not persist');
  recorder.record('CONTENT-006', await attemptDelete({ actor: users.moderator.client, service, table: 'specialist_trust_badges', id: ids.badgeAssignment }), 'moderator badge-assignment delete did not persist');

  const foreignEmail = await users.userA.client.from('email_notifications').select('id').eq('id', ids.emailB);
  recorder.record('AUDIT-001', deniedOrEmpty(foreignEmail), 'owner cannot read foreign email notification');
  const userAuditId = randomUUID();
  await users.userA.client.from('audit_log').insert({ actor_id: users.userA.id, entity_type: 'synthetic', entity_id: userAuditId, action: 'synthetic_user_write', details: {} });
  const userAuditCount = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `select count(*) from public.audit_log where entity_id='${userAuditId}'::uuid;`));
  recorder.record('AUDIT-002', userAuditCount === 0, 'ordinary client audit insertion checked without logging row data');
  const moderatorAuditId = randomUUID();
  const moderatorAudit = await users.moderator.client.from('audit_log').insert({ actor_id: users.moderator.id, entity_type: 'synthetic', entity_id: moderatorAuditId, action: 'synthetic_moderator_write', details: {} });
  const moderatorAuditExists = !moderatorAudit.error && Number(await queryLocalSql(stack, toolchain.dockerBin, env, `select count(*) from public.audit_log where entity_id='${moderatorAuditId}'::uuid;`)) > 0;
  recorder.record('AUDIT-003', !moderatorAuditExists, 'direct moderator audit insertion checked without logging content');
  const moderatorQueue = await users.moderator.client.from('email_notifications').select('id').limit(1);
  recorder.record('AUDIT-004', deniedOrEmpty(moderatorQueue), 'AAL1 moderator queue-read boundary evaluated without logging recipients');

  const { error: revokeError } = await service.from('moderators').delete().eq('user_id', users.moderator.id);
  if (revokeError) throw new Error(`Synthetic moderator revocation failed: ${revokeError.message}`);
  const afterRevoke = await users.moderator.client.from('applications').select('id').limit(1);
  recorder.record('ROLE-006', deniedOrEmpty(afterRevoke), 'revoked local moderator token no longer passes role lookup');
}

async function executeRun(runNumber, guard, env) {
  const recorder = createRecorder();
  let stack;
  let cleanup;
  try {
    stack = await createLocalStack({ runNumber, repoRoot, ...guard.toolchain, env });
    if (!stack.projectId.startsWith(requiredProjectPrefix)) throw new Error('Disposable project prefix guard failed');
    const { service, users } = await createSyntheticUsers(stack);
    const fixtures = await buildFixtures(stack, service, users);
    await runCatalogCases(recorder, stack, guard.toolchain, env);
    await runBehaviorCases(recorder, stack, service, users, fixtures, guard.toolchain, env);
    const results = recorder.finalize();
    const counts = Object.fromEntries(['PASS','XFAIL','XPASS','FAIL','SKIP'].map((name) => [name, results.filter((entry) => entry.result === name).length]));
    return {
      runNumber,
      projectId: stack.projectId,
      ports: stack.ports,
      results,
      counts,
      ok: counts.FAIL === 0 && counts.XPASS === 0,
    };
  } finally {
    cleanup = await cleanupLocalStack(stack, { ...guard.toolchain, env });
    if (!cleanup.ok) {
      const error = new Error(`Disposable cleanup left resources: ${cleanup.residual.join(', ')}`);
      error.code = 'CLEANUP_BLOCKED';
      throw error;
    }
  }
}

function compareRuns(first, second) {
  const normalized = (run) => run.results.map(({ id, result, SEC_ID }) => ({ id, result, SEC_ID }));
  assert.deepEqual(normalized(first), normalized(second), 'Independent runs produced different classifications or SEC mappings');
}

function printSummary(first, second) {
  const format = (run) => `PASS=${run.counts.PASS} XFAIL=${run.counts.XFAIL} XPASS=${run.counts.XPASS} FAIL=${run.counts.FAIL} SKIP=${run.counts.SKIP}`;
  console.log('AL-AMIN_ROLE_MATRIX_LOCAL_ONLY');
  console.log(`RUN_1 ${format(first)}`);
  console.log(`RUN_2 ${format(second)}`);
  console.log('CLEANUP PASS');
  console.log('No keys, passwords, tokens, user identifiers, ports, or fixture values are printed.');
}

async function main() {
  const env = sanitizedEnvironment();
  const toolchain = await resolveToolchain(env);
  const dockerDirectory = dirname(toolchain.dockerBin);
  const inheritedPath = env.Path ?? env.PATH ?? '';
  env.Path = `${dockerDirectory};${inheritedPath}`;
  env.PATH = env.Path;
  const guard = await validateLocalOnlyGuard(toolchain, env);

  for (const [id, secIds] of expectedFailures) {
    if (!caseById.has(id)) throw new Error(`Expected-failure ledger refers to unknown case ${id}`);
    if (!secIds.length || secIds.some((value) => !/^SEC-0(?:0[1-9]|1[0-9]|2[0-6])$/u.test(value))) {
      throw new Error(`Invalid SEC mapping for ${id}`);
    }
  }

  const first = await executeRun(1, guard, env);
  if (!first.ok) {
    const unexpected = first.results.filter((entry) => ['FAIL','XPASS'].includes(entry.result));
    throw new Error(`Run #1 requires adjudication: ${unexpected.map((entry) => `${entry.id}:${entry.result}`).join(', ')}`);
  }
  const second = await executeRun(2, guard, env);
  if (!second.ok) {
    const unexpected = second.results.filter((entry) => ['FAIL','XPASS'].includes(entry.result));
    throw new Error(`Run #2 requires adjudication: ${unexpected.map((entry) => `${entry.id}:${entry.result}`).join(', ')}`);
  }
  compareRuns(first, second);
  printSummary(first, second);
}

main().catch((error) => {
  console.error(`ROLE_MATRIX_BLOCKED: ${redactCommandError(error)}`);
  process.exitCode = 1;
});
