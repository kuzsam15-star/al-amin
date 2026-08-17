import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { publishCanonicalMediaSet } from '../../../src/lib/published-media.mjs';
import { runCommand, redactCommandError } from './helpers/command.mjs';
import { cleanupLocalStack, createLocalStack, queryLocalSql } from './helpers/local-stack.mjs';
import { createTotp } from './helpers/totp.mjs';
import { runP007Cases } from './helpers/p007.mjs';
import { runP008Cases } from './helpers/p008.mjs';
import { runP009Cases } from './helpers/p009.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const expectedHeadBaselineHash = 'CF61CDB37D9B82B3AFFFF035A0EAF68B1FABC2022C261F87027AE95583C153E1';
const requiredConfirmation = '1';
const requiredProjectPrefix = 'alamin-role-matrix-';
const requiredSupabaseVersion = '2.113.0';
const requiredDockerContext = 'desktop-linux';
const ownerApplicationColumns = [
  'id',
  'full_name',
  'contact',
  'country',
  'city',
  'category_id',
  'additional_category_ids',
  'specialization',
  'experience_years',
  'profile_summary',
  'description',
  'help_topics',
  'work_offers',
  'main_image_path',
  'gallery_paths',
  'status',
  'applicant_message',
  'created_at',
  'updated_at',
  'resubmitted_at',
];
const ownerApplicationSelect = ownerApplicationColumns.join(',');

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
    ['submitter', 'p007-submitter'],
    ['p007Failure', 'p007-failure'],
    ['p007Decision', 'p007-decision'],
    ['p007Race', 'p007-race'],
    ['appModerationOwner', 'app-moderation-owner'],
    ['appReplayOwner', 'app-replay-owner'],
    ['appRaceOwner', 'app-race-owner'],
    ['appLifecycleOwner', 'app-lifecycle-owner'],
    ['appRevokedOwner', 'app-revoked-owner'],
    ['p009Moderator', 'p009-moderator'],
    ['p009AdminAal2', 'p009-admin-aal2'],
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
      email,
      client: await signedInClient(stack.apiUrl, stack.anonKey, email, password),
    };
  }

  const { error: roleError } = await service.from('moderators').insert([
    { user_id: users.moderator.id, role: 'moderator' },
    { user_id: users.adminAal1.id, role: 'admin' },
    { user_id: users.p009Moderator.id, role: 'moderator' },
    { user_id: users.p009AdminAal2.id, role: 'admin' },
  ]);
  if (roleError) throw new Error(`Synthetic role fixtures failed: ${roleError.message}`);
  return { service, users };
}

const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#335577' } }).webp().toBuffer();
const webpReplacement = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#773355' } }).webp().toBuffer();
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

async function uploadRegisteredSubmission(service, ownerId, path, bytes) {
  const uploaded = await service.storage.from('profile-media').upload(path, bytes, { contentType: 'image/webp', upsert: false });
  if (uploaded.error) throw new Error(`Synthetic bounded media upload failed: ${uploaded.error.message}`);
  const registered = await service.rpc('register_submission_media_v1', {
    p_owner_id: ownerId,
    p_object_path: path,
    p_sha256: createHash('sha256').update(bytes).digest('hex'),
    p_byte_count: bytes.byteLength,
  });
  if (registered.error || registered.data !== true) throw new Error(`Synthetic bounded media registration failed: ${registered.error?.message ?? 'no acknowledgement'}`);
  return uploaded;
}

async function buildFixtures(stack, service, users, toolchain, env) {
  const ids = Object.fromEntries([
    'category', 'appA', 'appB', 'appModeration', 'appReplay', 'appRace', 'appDelete', 'appLifecycle', 'appRevoked', 'appInvalid',
    'specialistA', 'specialistB', 'verificationA', 'reviewPublished', 'reviewUnpublished', 'complaintA',
    'revisionA', 'revisionB', 'revisionAdmin', 'revisionMedia', 'revisionRace', 'badge', 'badgeSecond', 'badgeAssignment',
    'emailA', 'emailB', 'eventPublicA', 'eventInternalA', 'eventPublicB',
  ].map((name) => [name, randomUUID()]));
  const sourcePath = `submissions/${users.userA.id}/avatar/${randomUUID()}.webp`;
  const sourcePathB = `submissions/${users.userB.id}/avatar/${randomUUID()}.webp`;
  const avatarPath = `synthetic/${stack.projectId}.webp`;

  await uploadRegisteredSubmission(service, users.userA.id, sourcePath, webp);
  await uploadRegisteredSubmission(service, users.userB.id, sourcePathB, webp);
  const directOwnerPath = `submissions/${users.userA.id}/avatar/${randomUUID()}.webp`;
  const ownerUpload = await users.userA.client.storage.from('profile-media').upload(directOwnerPath, webp, { contentType: 'image/webp', upsert: false });
  const avatarUpload = await service.storage.from('avatars').upload(avatarPath, webp, {
    contentType: 'image/webp',
    upsert: false,
  });
  if (avatarUpload.error) throw new Error(`Synthetic avatar fixture failed: ${avatarUpload.error.message}`);

  const [initialA, initialB] = await Promise.all([
    publishCanonicalMediaSet({ storage: service.storage, ownerId: users.userA.id, entityType: 'applications', entityId: ids.appA, avatarPath: sourcePath }),
    publishCanonicalMediaSet({ storage: service.storage, ownerId: users.userB.id, entityType: 'applications', entityId: ids.appB, avatarPath: sourcePathB }),
  ]);
  const canonicalPath = initialA.avatar.canonical_path;
  const canonicalPathB = initialB.avatar.canonical_path;
  const quote = (value) => String(value).replaceAll("'", "''");
  for (const [ownerId, entityId, descriptor] of [
    [users.userA.id, ids.appA, initialA.avatar],
    [users.userB.id, ids.appB, initialB.avatar],
  ]) {
    await queryLocalSql(stack, toolchain.dockerBin, env, `
      insert into private.published_media_assets (
        canonical_path,owner_id,source_entity_type,source_entity_id,slot,source_path,
        source_sha256,canonical_sha256,canonical_bytes
      ) values (
        '${quote(descriptor.canonical_path)}','${quote(ownerId)}'::uuid,'applications','${quote(entityId)}'::uuid,'avatar',
        '${quote(descriptor.source_path)}','${quote(descriptor.source_sha256)}','${quote(descriptor.canonical_sha256)}',${descriptor.canonical_bytes}
      );
    `);
  }

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
      main_image_path: sourcePath,
      internal_notes: 'Synthetic internal note',
      call_at: '2099-01-01T00:00:00Z',
    },
    {
      ...applicationBase,
      id: ids.appB,
      owner_id: users.userB.id,
      full_name: 'Synthetic User B',
      status: 'new',
      main_image_path: sourcePathB,
      internal_notes: 'Synthetic internal note B',
    },
    ...[
      [ids.appModeration, 'Synthetic Moderation', 'screening', users.appModerationOwner.id],
      [ids.appReplay, 'Synthetic Replay', 'screening', users.appReplayOwner.id],
      [ids.appRace, 'Synthetic Race', 'screening', users.appRaceOwner.id],
      [ids.appDelete, 'Synthetic Delete', 'withdrawn', users.userA.id],
      [ids.appLifecycle, 'Synthetic Lifecycle', 'new', users.appLifecycleOwner.id],
      [ids.appRevoked, 'Synthetic Revoked', 'screening', users.appRevokedOwner.id],
      [ids.appInvalid, 'Synthetic Invalid', 'withdrawn', users.userA.id],
    ].map(([id, full_name, status, owner_id]) => ({
      ...applicationBase,
      id,
      owner_id,
      full_name,
      status,
      main_image_path: null,
      internal_notes: 'Synthetic privileged-boundary fixture',
    })),
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
      avatar_path: canonicalPathB,
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
  await insertFixture(service, 'complaints', {
    id: ids.complaintA,
    specialist_id: ids.specialistA,
    reason: 'Synthetic reason',
    description: 'Synthetic complaint used only for local privilege-boundary verification.',
    reporter_contact: 'complaint@example.invalid',
    status: 'new',
  });
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
  await insertFixture(service, 'trust_badges', {
    id: ids.badgeSecond,
    code: `synthetic_second_${stack.projectId.slice(-8)}`,
    title: 'Synthetic second badge',
    description: 'Synthetic second trust badge used only by the disposable local harness.',
    icon: 'badge',
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

  return { ids, sourcePath, sourcePathB, canonicalPath, canonicalPathB, avatarPath, ownerUpload, revisionPayload, mediaBytes: webp };
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

function diagnosticCounts(output) {
  const counts = { ERROR: 0, WARN: 0, INFO: 0 };
  const add = (level) => {
    const normalized = String(level ?? '').toUpperCase();
    if (normalized === 'WARNING') counts.WARN += 1;
    else if (normalized in counts) counts[normalized] += 1;
  };
  try {
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      if ('level' in value) add(value.level);
      if ('severity' in value) add(value.severity);
      for (const child of Object.values(value)) visit(child);
    };
    visit(JSON.parse(output));
  } catch {
    for (const line of output.split(/\r?\n/u)) {
      const match = line.match(/\b(ERROR|WARN(?:ING)?|INFO)\b/iu);
      if (match) add(match[1]);
    }
  }
  return counts;
}

async function runLocalDatabaseDiagnostics(stack, toolchain, env) {
  const lint = await runCommand(toolchain.supabaseBin, [
    'db', 'lint', '--local', '--schema', 'public,private', '--level', 'warning', '--fail-on', 'none',
    '--workdir', stack.workdir, '--output-format', 'json',
  ], { cwd: stack.workdir, env, timeoutMs: 180_000, allowFailure: true });
  const advisors = await runCommand(toolchain.supabaseBin, [
    'db', 'advisors', '--local', '--type', 'security', '--level', 'info', '--fail-on', 'none',
    '--workdir', stack.workdir, '--output-format', 'json',
  ], { cwd: stack.workdir, env, timeoutMs: 180_000, allowFailure: true });
  if (lint.code !== 0 || advisors.code !== 0) throw new Error('Local database lint or security advisors command failed');
  return { lint: diagnosticCounts(lint.stdout), advisors: diagnosticCounts(advisors.stdout) };
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
    where n.nspname in ('public','private')
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))
      and not exists (
        select 1 from private.api_surface_manifest_v1 manifest
        where manifest.object_kind='FUNCTION'
          and manifest.object_identity=format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
      );
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
    join pg_roles owner_role on owner_role.oid=d.defaclrole
    left join pg_namespace namespace on namespace.oid=d.defaclnamespace
    where owner_role.rolname in ('postgres','supabase_admin')
      and (namespace.nspname='public' or (namespace.oid is null and d.defaclobjtype='f'))
      and r.rolname in ('anon','authenticated')
      and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','EXECUTE','USAGE');
  `));
  recorder.record('CAT-005', broadDefaults === 0, `${broadDefaults} broad client default-privilege entries`);

  const profilePolicy = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from pg_policies where schemaname='public' and tablename='account_profiles' and cmd='UPDATE';
  `));
  recorder.record('CAT-006', profilePolicy === 0, `${profilePolicy} owner UPDATE policies remain`);

  const feedbackPolicies = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from pg_policies where schemaname='public' and tablename in ('reviews','complaints') and cmd='INSERT';
  `));
  const feedbackClientInsertGrants = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `
    select count(*) from (values ('anon'::name),('authenticated'::name)) as role_name(name)
    cross join (values ('reviews'::name),('complaints'::name)) as relation_name(name)
    where has_table_privilege(role_name.name, format('public.%I', relation_name.name), 'INSERT');
  `));
  recorder.record('CAT-007', feedbackPolicies === 0 && feedbackClientInsertGrants === 0, `${feedbackPolicies} direct feedback INSERT policies and ${feedbackClientInsertGrants} client INSERT grants remain`);

  const webpOnly = (await queryLocalSql(stack, toolchain.dockerBin, env, `
    select allowed_mime_types = array['image/webp']::text[] from storage.buckets where id='profile-media';
  `)) === 't';
  recorder.record('CAT-008', webpOnly, webpOnly ? 'WebP-only bucket contract' : 'profile-media allows non-WebP image MIME types');
}

async function runBehaviorCases(recorder, stack, service, users, fixtures, toolchain, env) {
  const anon = createClient(stack.apiUrl, stack.anonKey, clientOptions());
  const { ids, sourcePath, canonicalPath, avatarPath, revisionPayload } = fixtures;

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

  const ownerProjection = await users.userA.client.from('owner_applications_v1').select(ownerApplicationSelect).eq('id', ids.appA);
  const ownerProjectionReady = !ownerProjection.error && ownerProjection.data?.length === 1;
  recorder.record('APPREAD-001', ownerProjectionReady, 'versioned owner application contract availability evaluated');
  const ownerBaseWildcard = await users.userA.client.from('applications').select('*').eq('id', ids.appA);
  recorder.record('APPREAD-002', Boolean(ownerBaseWildcard.error), 'base wildcard projection boundary evaluated without logging row values');
  const ownerProjectionWildcard = await users.userA.client.from('owner_applications_v1').select('*').eq('id', ids.appA);
  const ownerProjectionKeys = Object.keys(ownerProjectionWildcard.data?.[0] ?? {}).sort();
  recorder.record(
    'APPREAD-003',
    !ownerProjectionWildcard.error
      && ownerProjectionWildcard.data?.length === 1
      && JSON.stringify(ownerProjectionKeys) === JSON.stringify([...ownerApplicationColumns].sort()),
    'versioned owner projection exposes exactly the stable allowlist',
  );
  const foreignProjection = await users.userB.client.from('owner_applications_v1').select('id').eq('id', ids.appA);
  recorder.record('APPREAD-004', ownerProjectionReady && !foreignProjection.error && foreignProjection.data?.length === 0, 'foreign owner projection returned no rows');
  const anonymousProjection = await anon.from('owner_applications_v1').select('id').eq('id', ids.appA);
  recorder.record('APPREAD-005', ownerProjectionReady && deniedOrEmpty(anonymousProjection), 'anonymous owner-projection access denied');
  const moderatorProtected = await users.moderator.client.from('applications').select('internal_notes,call_at').eq('id', ids.appA);
  recorder.record('APPREAD-006', Boolean(moderatorProtected.error) || moderatorProtected.data?.length === 0, 'moderator client cannot read protected base columns directly');
  const backendProtected = await service.from('applications').select('internal_notes,call_at').eq('id', ids.appA);
  recorder.record('APPREAD-007', !backendProtected.error && backendProtected.data?.length === 1, 'trusted backend retained protected moderation read without logging values');
  const projectionProtected = await users.userA.client.from('owner_applications_v1').select('internal_notes,call_at').eq('id', ids.appA);
  recorder.record('APPREAD-009', ownerProjectionReady && Boolean(projectionProtected.error), 'protected fields are absent from the versioned owner contract');

  await queryLocalSql(stack, toolchain.dockerBin, env, `
    alter table public.applications
      add column sec002_future_sensitive text not null default 'Synthetic future secret';
    notify pgrst, 'reload schema';
  `);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
  const futureCatalog = (await queryLocalSql(stack, toolchain.dockerBin, env, `
    select
      not has_column_privilege('authenticated','public.applications','sec002_future_sensitive','SELECT')
      and not exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='owner_applications_v1'
          and column_name='sec002_future_sensitive'
      );
  `)) === 't';
  const futureBaseRead = await users.userA.client.from('applications').select('sec002_future_sensitive').eq('id', ids.appA);
  const futureProjectionRead = await users.userA.client.from('owner_applications_v1').select('*').eq('id', ids.appA);
  recorder.record(
    'APPREAD-008',
    ownerProjectionReady
      && futureCatalog
      && Boolean(futureBaseRead.error)
      && !Object.hasOwn(futureProjectionRead.data?.[0] ?? {}, 'sec002_future_sensitive'),
    'synthetic future column remained ungranted and absent from the versioned projection',
  );

  recorder.record('APP-001', await attemptUpdate({ actor: users.userA.client, service, table: 'applications', id: ids.appB, changes: { applicant_message: 'Synthetic foreign edit' }, verifyField: 'applicant_message', restoreValue: null }), 'foreign application update did not persist');
  recorder.record('APP-002', await attemptDelete({ actor: users.userA.client, service, table: 'applications', id: ids.appB }), 'foreign application delete did not persist');
  recorder.record('APP-003', await attemptUpdate({ actor: users.userA.client, service, table: 'applications', id: ids.appA, changes: { owner_id: users.userB.id }, verifyField: 'owner_id', restoreValue: users.userA.id }), 'owner transfer did not persist');
  recorder.record('APP-004', await attemptUpdate({ actor: users.userA.client, service, table: 'applications', id: ids.appA, changes: { internal_notes: 'Synthetic unauthorized change' }, verifyField: 'internal_notes', restoreValue: 'Synthetic internal note' }), 'owner internal-note update did not persist');
  recorder.record('APP-005', await attemptUpdate({ actor: users.userA.client, service, table: 'applications', id: ids.appA, changes: { status: 'approved' }, verifyField: 'status', restoreValue: 'screening' }), 'owner status transition did not persist');

  recorder.record('SPEC-001', await attemptUpdate({ actor: users.userA.client, service, table: 'specialists', id: ids.specialistA, changes: { full_name: 'Synthetic direct owner edit' }, verifyField: 'full_name', restoreValue: 'Synthetic Specialist A' }), 'owner direct published-profile update did not persist');
  recorder.record('SPEC-002', deniedOrEmpty(await users.userB.client.from('specialist_revisions').select('id').eq('id', ids.revisionA)), 'user B cannot read user A revision');
  recorder.record('SPEC-003', await attemptUpdate({ actor: users.moderator.client, service, table: 'specialists', id: ids.specialistB, changes: { owner_id: users.moderator.id }, verifyField: 'owner_id', restoreValue: users.userB.id }), 'moderator owner reassignment boundary evaluated on a non-published profile; SEC-001 canonical constraints do not adjudicate this broader privilege finding');
  recorder.record('SPEC-004', await attemptUpdate({ actor: users.moderator.client, service, table: 'specialists', id: ids.specialistA, changes: { status: 'blocked' }, verifyField: 'status', restoreValue: 'published' }), 'moderator lifecycle boundary evaluated');
  recorder.record('SPEC-005', await attemptUpdate({ actor: users.moderator.client, service, table: 'verifications', id: ids.verificationA, changes: { qualifications_checked: true }, verifyField: 'qualifications_checked', restoreValue: false }), 'moderator protected verification boundary evaluated');
  recorder.record('SPEC-006', await attemptUpdate({ actor: users.moderator.client, service, table: 'specialists', id: ids.specialistB, changes: { slug: `unauthorized-${stack.projectId.slice(-8)}` }, verifyField: 'slug', restoreValue: `synthetic-b-${stack.projectId.slice(-8)}` }), 'moderator protected publication-identity boundary evaluated');
  const futureFieldProbe = await queryLocalSql(stack, toolchain.dockerBin, env, `
    begin;
    alter table public.specialists add column sec003_future_sensitive text;
    select has_column_privilege('authenticated','public.specialists','sec003_future_sensitive','UPDATE');
    rollback;
  `);
  recorder.record('SPEC-007', !futureFieldProbe.split(/\r?\n/u).includes('t'), 'transactional future-column probe confirmed deny-by-default without retaining the column');

  const anonReviewId = randomUUID();
  recorder.record('FEEDBACK-001', await attemptInsert({ actor: anon, service, table: 'reviews', value: { id: anonReviewId, specialist_id: ids.specialistA, body: 'Synthetic anonymous review body long enough for local validation.', would_hire_again: false, is_published: false, evidence_checked: false } }), 'anonymous direct review insert checked through service-side existence');
  const anonComplaintId = randomUUID();
  recorder.record('FEEDBACK-002', await attemptInsert({ actor: anon, service, table: 'complaints', value: { id: anonComplaintId, specialist_id: ids.specialistA, reason: 'Synthetic reason', description: 'Synthetic anonymous complaint description for local-only validation.', reporter_contact: 'anonymous@example.invalid', status: 'new' } }), 'anonymous direct complaint insert checked through service-side existence');
  const authReviewId = randomUUID();
  recorder.record('FEEDBACK-003', await attemptInsert({ actor: users.userA.client, service, table: 'reviews', value: { id: authReviewId, specialist_id: ids.specialistA, body: 'Synthetic authenticated review body long enough for local validation.', would_hire_again: true, is_published: false, evidence_checked: false } }), 'authenticated direct review insert checked through service-side existence');
  recorder.record('FEEDBACK-004', await attemptUpdate({ actor: users.moderator.client, service, table: 'reviews', id: ids.reviewUnpublished, changes: { is_published: true }, verifyField: 'is_published', restoreValue: false }), 'direct moderator review mutation boundary evaluated');
  recorder.record('FEEDBACK-005', await attemptUpdate({ actor: users.moderator.client, service, table: 'complaints', id: ids.complaintA, changes: { status: 'resolved' }, verifyField: 'status', restoreValue: 'new' }), 'direct moderator complaint mutation boundary evaluated');
  const authComplaintId = randomUUID();
  recorder.record('FEEDBACK-006', await attemptInsert({ actor: users.userA.client, service, table: 'complaints', value: { id: authComplaintId, specialist_id: ids.specialistA, reason: 'Synthetic auth reason', description: 'Synthetic authenticated complaint description for local validation.', reporter_contact: 'auth@example.invalid', status: 'new' } }), 'authenticated direct complaint insert checked through service-side existence');
  const protectedComplaintId = randomUUID();
  recorder.record('FEEDBACK-007', await attemptInsert({ actor: anon, service, table: 'complaints', value: { id: protectedComplaintId, specialist_id: ids.specialistA, reason: 'Synthetic protected reason', description: 'Synthetic complaint attempting a protected field through direct Data API.', reporter_contact: 'protected@example.invalid', status: 'new', internal_notes: 'Synthetic client-controlled internal note' } }), 'client-controlled complaint internal_notes insert checked without logging content');
  const duplicateBody = 'Synthetic duplicate review body long enough for deterministic local validation.';
  const duplicateReviewIds = [randomUUID(), randomUUID()];
  await anon.from('reviews').insert(duplicateReviewIds.map((id) => ({ id, specialist_id: ids.specialistA, body: duplicateBody, would_hire_again: true, is_published: false, evidence_checked: false })));
  const duplicateDirectRows = await service.from('reviews').select('id').in('id', duplicateReviewIds);
  recorder.record('FEEDBACK-008', !duplicateDirectRows.error && duplicateDirectRows.data?.length === 0, 'duplicate direct submissions were checked by row cardinality without logging content');

  const gatewaySignature = 'public.submit_feedback_v1(text,uuid,uuid,text,text,text,text,text,boolean,text,text,text)';
  const gatewayExists = (await queryLocalSql(stack, toolchain.dockerBin, env, `select to_regprocedure('${gatewaySignature}') is not null;`)) === 't';
  if (!gatewayExists) {
    for (const id of ['FEEDBACK-009','FEEDBACK-010','FEEDBACK-011','FEEDBACK-012','FEEDBACK-013','FEEDBACK-014','FEEDBACK-015','FEEDBACK-016','FEEDBACK-017']) {
      recorder.record(id, false, 'service-only atomic feedback gateway is absent in the pre-fix catalog');
    }
  } else {
    const hashLabel = (value) => createHash('sha256').update(`${stack.projectId}:${value}`).digest('hex');
    const invokeGateway = (overrides = {}) => service.rpc('submit_feedback_v1', {
      p_feedback_type: 'review',
      p_target_id: ids.specialistA,
      p_actor_id: null,
      p_network_fingerprint: hashLabel('network-default'),
      p_idempotency_key_hash: hashLabel(`idempotency-${randomUUID()}`),
      p_payload_hash: hashLabel(`payload-${randomUUID()}`),
      p_body: 'Synthetic gateway review body long enough for the validated contract.',
      p_contact: 'gateway@example.invalid',
      p_would_hire_again: true,
      p_reason: null,
      p_description: null,
      p_materials_links: null,
      ...overrides,
    });
    const resultRow = (result) => Array.isArray(result.data) ? result.data[0] : result.data;
    const gatewayAcl = (await queryLocalSql(stack, toolchain.dockerBin, env, `
      select not has_function_privilege('anon','${gatewaySignature}','EXECUTE')
        and not has_function_privilege('authenticated','${gatewaySignature}','EXECUTE')
        and has_function_privilege('service_role','${gatewaySignature}','EXECUTE');
    `)) === 't';
    const anonGateway = await anon.rpc('submit_feedback_v1', {
      p_feedback_type: 'review', p_target_id: ids.specialistA, p_actor_id: null,
      p_network_fingerprint: hashLabel('acl-network'), p_idempotency_key_hash: hashLabel('acl-idem'),
      p_payload_hash: hashLabel('acl-payload'), p_body: 'Synthetic denied RPC review body long enough for validation.',
      p_contact: null, p_would_hire_again: true, p_reason: null, p_description: null, p_materials_links: null,
    });
    const authGateway = await users.userA.client.rpc('submit_feedback_v1', {
      p_feedback_type: 'review', p_target_id: ids.specialistA, p_actor_id: users.userA.id,
      p_network_fingerprint: hashLabel('acl-network-auth'), p_idempotency_key_hash: hashLabel('acl-idem-auth'),
      p_payload_hash: hashLabel('acl-payload-auth'), p_body: 'Synthetic denied authenticated RPC review body for validation.',
      p_contact: null, p_would_hire_again: true, p_reason: null, p_description: null, p_materials_links: null,
    });
    recorder.record('FEEDBACK-009', gatewayAcl && Boolean(anonGateway.error) && Boolean(authGateway.error), 'gateway function ACL and direct RPC denial verified');

    const validReview = await invokeGateway({ p_network_fingerprint: hashLabel('review-network'), p_idempotency_key_hash: hashLabel('review-idem'), p_payload_hash: hashLabel('review-payload') });
    const validReviewRow = resultRow(validReview);
    const storedReview = validReviewRow?.feedback_id
      ? await service.from('reviews').select('id,is_published,evidence_checked').eq('id', validReviewRow.feedback_id).maybeSingle()
      : { data: null, error: validReview.error ?? new Error('missing result') };
    recorder.record('FEEDBACK-010', !validReview.error && validReviewRow?.result_status === 'accepted' && storedReview.data?.is_published === false && storedReview.data?.evidence_checked === false, 'valid service gateway review created one server-controlled pending row');

    const validComplaint = await invokeGateway({
      p_feedback_type: 'complaint', p_network_fingerprint: hashLabel('complaint-network'),
      p_idempotency_key_hash: hashLabel('complaint-idem'), p_payload_hash: hashLabel('complaint-payload'),
      p_body: null, p_contact: 'complaint-gateway@example.invalid', p_would_hire_again: null,
      p_reason: 'Synthetic gateway reason', p_description: 'Synthetic gateway complaint description long enough for validation.',
      p_materials_links: 'https://example.invalid/evidence',
    });
    const validComplaintRow = resultRow(validComplaint);
    const storedComplaint = validComplaintRow?.feedback_id
      ? await service.from('complaints').select('id,status,internal_notes').eq('id', validComplaintRow.feedback_id).maybeSingle()
      : { data: null, error: validComplaint.error ?? new Error('missing result') };
    recorder.record('FEEDBACK-011', !validComplaint.error && validComplaintRow?.result_status === 'accepted' && storedComplaint.data?.status === 'new' && storedComplaint.data?.internal_notes === null, 'valid service gateway complaint created one server-controlled new row');

    const replayArgs = { p_network_fingerprint: hashLabel('replay-network'), p_idempotency_key_hash: hashLabel('replay-idem'), p_payload_hash: hashLabel('replay-payload') };
    const replayFirst = await invokeGateway(replayArgs);
    const replaySecond = await invokeGateway(replayArgs);
    const replayFirstRow = resultRow(replayFirst);
    const replaySecondRow = resultRow(replaySecond);
    const replayCount = replayFirstRow?.feedback_id ? Number(await queryLocalSql(stack, toolchain.dockerBin, env, `select count(*) from public.reviews where id='${replayFirstRow.feedback_id}'::uuid;`)) : 0;
    recorder.record('FEEDBACK-012', !replayFirst.error && !replaySecond.error && replayFirstRow?.feedback_id === replaySecondRow?.feedback_id && replaySecondRow?.result_status === 'replayed' && replayCount === 1, 'same idempotency scope and payload replayed one feedback row');

    const conflictFirst = await invokeGateway({ p_network_fingerprint: hashLabel('conflict-network'), p_idempotency_key_hash: hashLabel('conflict-idem'), p_payload_hash: hashLabel('conflict-payload-a') });
    const conflictSecond = await invokeGateway({ p_network_fingerprint: hashLabel('conflict-network'), p_idempotency_key_hash: hashLabel('conflict-idem'), p_payload_hash: hashLabel('conflict-payload-b'), p_body: 'Synthetic different review content long enough for idempotency conflict.' });
    recorder.record('FEEDBACK-013', !conflictFirst.error && Boolean(conflictSecond.error), 'idempotency conflict rejected without exposing content');

    const duplicateArgs = { p_network_fingerprint: hashLabel('content-network'), p_payload_hash: hashLabel('content-payload') };
    const contentFirst = await invokeGateway({ ...duplicateArgs, p_idempotency_key_hash: hashLabel('content-idem-a') });
    const contentSecond = await invokeGateway({ ...duplicateArgs, p_idempotency_key_hash: hashLabel('content-idem-b') });
    const contentFirstRow = resultRow(contentFirst);
    const contentSecondRow = resultRow(contentSecond);
    recorder.record('FEEDBACK-014', !contentFirst.error && !contentSecond.error && contentFirstRow?.feedback_id === contentSecondRow?.feedback_id && contentSecondRow?.result_status === 'duplicate', 'content duplicate window returned the existing result');

    const ineligible = await invokeGateway({ p_target_id: ids.specialistB, p_network_fingerprint: hashLabel('ineligible-network'), p_idempotency_key_hash: hashLabel('ineligible-idem'), p_payload_hash: hashLabel('ineligible-payload') });
    recorder.record('FEEDBACK-015', Boolean(ineligible.error), 'unpublished feedback target was rejected');

    const burstFingerprint = hashLabel('burst-network');
    const burst = await Promise.all(Array.from({ length: 6 }, (_, index) => invokeGateway({
      p_network_fingerprint: burstFingerprint,
      p_idempotency_key_hash: hashLabel(`burst-idem-${index}`),
      p_payload_hash: hashLabel(`burst-payload-${index}`),
      p_body: `Synthetic atomic burst review number ${index} long enough for gateway validation.`,
    })));
    recorder.record('FEEDBACK-016', burst.filter((result) => !result.error).length === 3 && burst.filter((result) => result.error).length === 3, 'concurrent burst admitted exactly the configured atomic allowance');

    const futureProbe = await queryLocalSql(stack, toolchain.dockerBin, env, `
      begin;
      alter table public.reviews add column sec004_future_sensitive text;
      set local role service_role;
      select * from public.submit_feedback_v1(
        'review','${ids.specialistA}'::uuid,null,'${hashLabel('future-network')}','${hashLabel('future-idem')}',
        '${hashLabel('future-payload')}','Synthetic future-column gateway review body long enough for validation.',null,true,null,null,null
      );
      reset role;
      select coalesce(bool_and(sec004_future_sensitive is null),false) from public.reviews where body like 'Synthetic future-column gateway review%';
      rollback;
    `);
    recorder.record('FEEDBACK-017', futureProbe.split(/\r?\n/u).includes('t'), 'transactional future-column probe remained null under exact gateway insert');
  }

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
  recorder.record('ROLE-007', await attemptUpdate({ actor: users.adminAal1.client, service, table: 'moderators', id: users.moderator.id, changes: { role: 'admin' }, verifyField: 'role', restoreValue: 'moderator', keyField: 'user_id' }), 'AAL1 admin direct role-assignment boundary evaluated');
  recorder.record('ROLE-008', await attemptUpdate({ actor: users.adminAal1.client, service, table: 'verifications', id: ids.verificationA, changes: { qualifications_checked: true }, verifyField: 'qualifications_checked', restoreValue: false }), 'AAL1 admin direct verification boundary evaluated');
  const aal1SpecialistControl = await users.adminAal1.client.rpc('admin_update_specialist_controls', {
    p_specialist_id: ids.specialistA,
    p_expected_status: 'published',
    p_target_status: 'suspended',
    p_identity_checked: true,
    p_education_checked: true,
    p_experience_checked: false,
    p_qualifications_checked: false,
    p_references_checked: false,
    p_sources_checked: 1,
  });
  recorder.record('ROLE-009', Boolean(aal1SpecialistControl.error), 'AAL1 admin named specialist-control RPC was denied');
  const aal1Delete = await users.adminAal1.client.rpc('admin_delete_application', { p_application_id: ids.appDelete });
  recorder.record('ROLE-013', Boolean(aal1Delete.error) && await rowExists(service, 'applications', ids.appDelete), 'AAL1 admin application deletion RPC was denied');
  const aal1Lifecycle = await users.adminAal1.client.rpc('admin_transition_application', { p_application_id: ids.appLifecycle, p_expected_status: 'new', p_target_status: 'withdrawn' });
  recorder.record('ROLE-015', Boolean(aal1Lifecycle.error) && await rowValue(service, 'applications', ids.appLifecycle, 'status') === 'new', 'AAL1 admin lifecycle RPC was denied');
  await users.adminAal1.client.from('specialist_trust_badges').delete().eq('id', ids.badgeAssignment);
  const aal1BadgeAssignmentExists = await rowExists(service, 'specialist_trust_badges', ids.badgeAssignment);
  if (!aal1BadgeAssignmentExists) {
    await insertFixture(service, 'specialist_trust_badges', {
      id: ids.badgeAssignment,
      specialist_id: ids.specialistA,
      badge_id: ids.badge,
      assigned_by: users.adminAal1.id,
      source: 'manual',
      admin_note: 'Synthetic assignment',
    });
  }
  recorder.record('ROLE-012', aal1BadgeAssignmentExists, 'AAL1 admin direct badge-assignment mutation boundary evaluated');

  const appModerationBefore = await service.from('applications').select('workflow_version,status').eq('id', ids.appModeration).single();
  const moderatorDecision = await users.moderator.client.rpc('moderator_decide_application_v2', {
    p_application_id: ids.appModeration,
    p_expected_version: appModerationBefore.data?.workflow_version,
    p_expected_status: appModerationBefore.data?.status,
    p_decision: 'request_changes',
    p_operation_id: randomUUID(),
    p_internal_note: 'Synthetic moderator note',
    p_applicant_message: 'Synthetic requested change',
  });
  recorder.record('MOD-001', !moderatorDecision.error && await rowValue(service, 'applications', ids.appModeration, 'status') === 'changes_requested', 'current moderator completed the named request-changes action');
  const ordinaryDecision = await users.userA.client.rpc('moderator_decide_application_v2', {
    p_application_id: ids.appRevoked,
    p_expected_version: 0,
    p_expected_status: 'screening',
    p_decision: 'reject',
    p_operation_id: randomUUID(),
    p_internal_note: 'Synthetic unauthorized decision',
    p_applicant_message: null,
  });
  recorder.record('MOD-002', Boolean(ordinaryDecision.error) && await rowValue(service, 'applications', ids.appRevoked, 'status') === 'screening', 'ordinary user application-decision RPC was denied');
  const invalidBefore = await service.from('applications').select('workflow_version,status').eq('id', ids.appInvalid).single();
  const invalidDecision = await users.moderator.client.rpc('moderator_decide_application_v2', {
    p_application_id: ids.appInvalid,
    p_expected_version: invalidBefore.data?.workflow_version,
    p_expected_status: invalidBefore.data?.status,
    p_decision: 'reject',
    p_operation_id: randomUUID(),
    p_internal_note: 'Synthetic invalid transition',
    p_applicant_message: null,
  });
  recorder.record('MOD-003', Boolean(invalidDecision.error) && await rowValue(service, 'applications', ids.appInvalid, 'status') === 'withdrawn', 'withdrawn application rejected an invalid moderator transition');
  const replayBefore = await service.from('applications').select('workflow_version,status').eq('id', ids.appReplay).single();
  const firstReplay = await users.moderator.client.rpc('moderator_decide_application_v2', {
    p_application_id: ids.appReplay,
    p_expected_version: replayBefore.data?.workflow_version,
    p_expected_status: replayBefore.data?.status,
    p_decision: 'reject',
    p_operation_id: randomUUID(),
    p_internal_note: 'Synthetic first decision',
    p_applicant_message: null,
  });
  const secondReplay = await users.moderator.client.rpc('moderator_decide_application_v2', {
    p_application_id: ids.appReplay,
    p_expected_version: replayBefore.data?.workflow_version,
    p_expected_status: replayBefore.data?.status,
    p_decision: 'reject',
    p_operation_id: randomUUID(),
    p_internal_note: 'Synthetic replay',
    p_applicant_message: null,
  });
  recorder.record('MOD-004', !firstReplay.error && Boolean(secondReplay.error) && await rowValue(service, 'applications', ids.appReplay, 'status') === 'rejected', 'terminal application decision replay was denied');
  const raceBefore = await service.from('applications').select('workflow_version,status').eq('id', ids.appRace).single();
  const raceDecisions = await Promise.all([
    users.moderator.client.rpc('moderator_decide_application_v2', {
      p_application_id: ids.appRace,
      p_expected_version: raceBefore.data?.workflow_version,
      p_expected_status: raceBefore.data?.status,
      p_decision: 'request_changes',
      p_operation_id: randomUUID(),
      p_internal_note: 'Synthetic race changes',
      p_applicant_message: 'Synthetic race request',
    }),
    users.moderator.client.rpc('moderator_decide_application_v2', {
      p_application_id: ids.appRace,
      p_expected_version: raceBefore.data?.workflow_version,
      p_expected_status: raceBefore.data?.status,
      p_decision: 'reject',
      p_operation_id: randomUUID(),
      p_internal_note: 'Synthetic race rejection',
      p_applicant_message: null,
    }),
  ]);
  const raceWinnerCount = raceDecisions.filter((entry) => !entry.error).length;
  recorder.record('MOD-005', raceWinnerCount === 1 && ['changes_requested','rejected'].includes(await rowValue(service, 'applications', ids.appRace, 'status')), 'concurrent application decisions produced one valid terminal/moderation outcome');

  const revisionABefore = await service.from('specialist_revisions').select('updated_at,status').eq('id', ids.revisionA).single();
  const ordinaryRpc = await users.userA.client.rpc('moderator_decide_revision_v2', { p_revision_id: ids.revisionA, p_expected_updated_at: revisionABefore.data?.updated_at, p_expected_status: revisionABefore.data?.status, p_decision: 'approve', p_operation_id: randomUUID(), p_note: null });
  recorder.record('RPC-001', Boolean(ordinaryRpc.error), 'ordinary user revision-decision RPC denied');
  const moderatorRpc = await users.moderator.client.rpc('moderator_decide_revision_v2', { p_revision_id: ids.revisionA, p_expected_updated_at: revisionABefore.data?.updated_at, p_expected_status: revisionABefore.data?.status, p_decision: 'approve', p_operation_id: randomUUID(), p_note: null });
  if (moderatorRpc.error) throw new Error(`Moderator revision RPC failed: ${moderatorRpc.error.message}`);
  recorder.record('RPC-002', !moderatorRpc.error, 'current AAL1 moderator completed the allowlisted revision decision');

  await insertFixture(service, 'specialist_revisions', {
    id: ids.revisionAdmin,
    specialist_id: ids.specialistA,
    owner_id: users.userA.id,
    payload: revisionPayload(users.userA.id, 'Admin', canonicalPath),
    status: 'pending',
  });

  const aal2 = await enableAal2(users.adminAal1.client, stack);
  if (aal2.ok) {
    const adminContent = await users.adminAal1.client.rpc('admin_update_site_content', {
      p_content: {
        brand_name: 'Synthetic Brand', tagline: 'Synthetic tagline', hero_title: 'Synthetic AAL2 change',
        hero_text: 'Synthetic hero text', contact_email: 'site@example.invalid', about_text: 'Synthetic about text',
        rules_intro: 'Synthetic rules text', privacy_text: 'Synthetic privacy text', seo_title: 'Synthetic SEO title',
        seo_description: 'Synthetic SEO description',
      },
    });
    recorder.record('ROLE-005', !adminContent.error && await rowValue(service, 'site_content', true, 'hero_title') === 'Synthetic AAL2 change', 'real local TOTP session reached AAL2 and completed the named content action');
    await service.from('site_content').update({ hero_title: 'Synthetic hero' }).eq('id', true);
    const specialistControl = await users.adminAal1.client.rpc('admin_update_specialist_controls', {
      p_specialist_id: ids.specialistA,
      p_expected_status: 'published',
      p_target_status: 'suspended',
      p_identity_checked: true,
      p_education_checked: true,
      p_experience_checked: false,
      p_qualifications_checked: true,
      p_references_checked: false,
      p_sources_checked: 2,
    });
    recorder.record('ROLE-010', !specialistControl.error
      && await rowValue(service, 'specialists', ids.specialistA, 'status') === 'suspended'
      && await rowValue(service, 'verifications', ids.verificationA, 'qualifications_checked') === true,
    'AAL2 specialist lifecycle and verification allowlist succeeded atomically');
    await service.from('specialists').update({ status: 'published' }).eq('id', ids.specialistA);
    await service.from('verifications').update({ qualifications_checked: false }).eq('id', ids.verificationA);
    const badgeUpdate = await users.adminAal1.client.rpc('admin_set_manual_trust_badges', {
      p_specialist_id: ids.specialistA,
      p_badge_ids: [ids.badge, ids.badgeSecond],
    });
    const secondBadgeExists = Number(await queryLocalSql(stack, toolchain.dockerBin, env, `select count(*) from public.specialist_trust_badges where specialist_id='${ids.specialistA}'::uuid and badge_id='${ids.badgeSecond}'::uuid and source='manual';`)) === 1;
    recorder.record('ROLE-011', !badgeUpdate.error && secondBadgeExists, 'AAL2 named manual-badge assignment succeeded');
    const deleteApplication = await users.adminAal1.client.rpc('admin_delete_application', { p_application_id: ids.appDelete });
    recorder.record('ROLE-014', !deleteApplication.error && !(await rowExists(service, 'applications', ids.appDelete)), 'AAL2 named application deletion succeeded');
    const archiveApplication = await users.adminAal1.client.rpc('admin_transition_application', { p_application_id: ids.appLifecycle, p_expected_status: 'new', p_target_status: 'withdrawn' });
    const restoreApplication = await users.adminAal1.client.rpc('admin_transition_application', { p_application_id: ids.appLifecycle, p_expected_status: 'withdrawn', p_target_status: 'new' });
    recorder.record('ROLE-016', !archiveApplication.error && !restoreApplication.error && await rowValue(service, 'applications', ids.appLifecycle, 'status') === 'new', 'AAL2 application archive/restore state machine succeeded');
    const revisionAdminBefore = await service.from('specialist_revisions').select('updated_at,status').eq('id', ids.revisionAdmin).single();
    const adminRpc = await users.adminAal1.client.rpc('moderator_decide_revision_v2', {
      p_revision_id: ids.revisionAdmin, p_expected_updated_at: revisionAdminBefore.data?.updated_at,
      p_expected_status: revisionAdminBefore.data?.status, p_decision: 'approve',
      p_operation_id: randomUUID(), p_note: null,
    });
    if (adminRpc.error) {
      throw new Error(`AAL2 admin revision RPC failed: ${adminRpc.error.code ?? 'unknown'} ${adminRpc.error.message}`);
    }
    recorder.record('RPC-003', !adminRpc.error, 'real local AAL2 admin session completed approved revision decision');
  } else {
    const safeReason = `local TOTP automation unavailable: ${aal2.reason}`.replace(/[A-Z0-9_-]{20,}/giu, '[redacted]');
    recorder.record('ROLE-005', false, '', safeReason);
    recorder.record('ROLE-010', false, '', safeReason);
    recorder.record('ROLE-011', false, '', safeReason);
    recorder.record('ROLE-014', false, '', safeReason);
    recorder.record('ROLE-016', false, '', safeReason);
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

  recorder.record('STORAGE-001', Boolean(fixtures.ownerUpload.error), 'direct owner upload denied; bounded server gateway owns submission writes');
  const foreignPath = `submissions/${users.userA.id}/foreign/foreign.webp`;
  const foreignUpload = await users.userB.client.storage.from('profile-media').upload(foreignPath, webp, { contentType: 'image/webp' });
  recorder.record('STORAGE-002', Boolean(foreignUpload.error) && (await storageBytes(service, 'profile-media', foreignPath)) === null, 'foreign-folder upload denied and no object persisted');
  const foreignRead = await users.userB.client.storage.from('profile-media').download(canonicalPath);
  recorder.record('STORAGE-003', Boolean(foreignRead.error), 'foreign private-object read denied');
  const canonicalBytesBeforeForeignMutation = await storageBytes(service, 'profile-media', canonicalPath);
  const foreignUpdate = await users.userB.client.storage.from('profile-media').update(canonicalPath, webpReplacement, { contentType: 'image/webp' });
  const afterForeignUpdate = await storageBytes(service, 'profile-media', canonicalPath);
  recorder.record('STORAGE-004', Boolean(foreignUpdate.error) && sameBytes(afterForeignUpdate, canonicalBytesBeforeForeignMutation), 'foreign object update denied and bytes unchanged');
  const foreignDelete = await users.userB.client.storage.from('profile-media').remove([canonicalPath]);
  const afterForeignDelete = await storageBytes(service, 'profile-media', canonicalPath);
  recorder.record('STORAGE-005', sameBytes(afterForeignDelete, canonicalBytesBeforeForeignMutation), 'foreign object delete denied and canonical bytes remain');
  const svgPath = `submissions/${users.userA.id}/formats/image.svg`;
  const svgUpload = await users.userA.client.storage.from('profile-media').upload(svgPath, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { contentType: 'image/svg+xml' });
  recorder.record('STORAGE-006', Boolean(svgUpload.error) && (await storageBytes(service, 'profile-media', svgPath)) === null, 'SVG upload denied by bucket MIME contract without persisting object');
  const pngPath = `submissions/${users.userA.id}/gallery/${randomUUID()}.png`;
  const pngUpload = await users.userA.client.storage.from('profile-media').upload(pngPath, png, { contentType: 'image/png' });
  recorder.record('STORAGE-007', Boolean(pngUpload.error) && (await storageBytes(service, 'profile-media', pngPath)) === null, 'direct PNG upload boundary evaluated');
  const jpegPath = `submissions/${users.userA.id}/gallery/${randomUUID()}.jpg`;
  const jpegUpload = await users.userA.client.storage.from('profile-media').upload(jpegPath, jpeg, { contentType: 'image/jpeg' });
  recorder.record('STORAGE-008', Boolean(jpegUpload.error) && (await storageBytes(service, 'profile-media', jpegPath)) === null, 'direct JPEG upload boundary evaluated');
  const invalidPath = `submissions/${users.userA.id}/gallery/${randomUUID()}.webp`;
  const invalidUpload = await users.userA.client.storage.from('profile-media').upload(invalidPath, Buffer.from('not-an-image'), { contentType: 'image/webp' });
  recorder.record('STORAGE-009', Boolean(invalidUpload.error) && (await storageBytes(service, 'profile-media', invalidPath)) === null, 'content-validation boundary evaluated without retaining output');
  const canonicalUpdate = await users.userA.client.storage.from('profile-media').update(canonicalPath, webpReplacement, { contentType: 'image/webp' });
  const afterCanonicalUpdate = await storageBytes(service, 'profile-media', canonicalPath);
  recorder.record('STORAGE-010', Boolean(canonicalUpdate.error) && sameBytes(afterCanonicalUpdate, canonicalBytesBeforeForeignMutation), 'referenced canonical object replacement boundary evaluated with byte comparison');
  const oversizedPath = `submissions/${users.userA.id}/gallery/${randomUUID()}.webp`;
  const oversized = await users.userA.client.storage.from('profile-media').upload(oversizedPath, Buffer.alloc(5 * 1024 * 1024 + 1), { contentType: 'image/webp' });
  recorder.record('STORAGE-011', Boolean(oversized.error) && (await storageBytes(service, 'profile-media', oversizedPath)) === null, 'upload above configured bucket limit denied without persisting object');
  const anonMedia = await anon.storage.from('profile-media').download(canonicalPath);
  recorder.record('STORAGE-012', Boolean(anonMedia.error), 'anonymous private profile-media read denied');
  const anonAvatar = await anon.storage.from('avatars').download(avatarPath);
  recorder.record('STORAGE-013', !anonAvatar.error && anonAvatar.data?.size > 0, 'public synthetic avatar read succeeded');
  const moderatorAvatarPath = `synthetic/moderator-${stack.projectId}.webp`;
  const moderatorAvatar = await users.moderator.client.storage.from('avatars').upload(moderatorAvatarPath, webp, { contentType: 'image/webp' });
  recorder.record('STORAGE-014', !moderatorAvatar.error && (await storageBytes(service, 'avatars', moderatorAvatarPath)) !== null, 'moderator synthetic avatar upload succeeded');

  const referencedDelete = await users.userA.client.storage.from('profile-media').remove([sourcePath]);
  const afterReferencedDelete = await storageBytes(service, 'profile-media', sourcePath);
  recorder.record('MEDIA-001', sameBytes(afterReferencedDelete, webp), 'referenced submission deletion boundary evaluated by persisted bytes');
  const ownerSourceUpdate = await users.userA.client.storage.from('profile-media').update(sourcePath, webpReplacement, { contentType: 'image/webp' });
  const sourceAfterOwnerUpdate = await storageBytes(service, 'profile-media', sourcePath);
  recorder.record('MEDIA-013', Boolean(ownerSourceUpdate.error) && sameBytes(sourceAfterOwnerUpdate, webp), 'owner same-path submission overwrite denied with byte comparison');
  const foreignSourceRead = await users.userB.client.storage.from('profile-media').download(sourcePath);
  recorder.record('MEDIA-014', Boolean(foreignSourceRead.error), 'foreign submission read denied');
  const foreignSourceUpdate = await users.userB.client.storage.from('profile-media').update(sourcePath, webpReplacement, { contentType: 'image/webp' });
  const sourceAfterForeignUpdate = await storageBytes(service, 'profile-media', sourcePath);
  recorder.record('MEDIA-015', Boolean(foreignSourceUpdate.error) && sameBytes(sourceAfterForeignUpdate, webp), 'foreign submission update denied with byte comparison');
  await users.userB.client.storage.from('profile-media').remove([sourcePath]);
  recorder.record('MEDIA-016', sameBytes(await storageBytes(service, 'profile-media', sourcePath), webp), 'foreign submission deletion denied with byte comparison');
  const traversalPath = `submissions/${users.userA.id}/avatar/${randomUUID()}/../../published/escape.webp`;
  const traversalUpload = await users.userA.client.storage.from('profile-media').upload(traversalPath, webp, { contentType: 'image/webp', upsert: false });
  recorder.record('MEDIA-017', Boolean(traversalUpload.error) && (await storageBytes(service, 'profile-media', traversalPath)) === null, 'non-contract traversal-shaped upload path denied');
  const publishedPathPattern = /^published\/[a-f0-9-]{36}\/(?:applications|revisions|backfill-applications|backfill-specialists)\/[a-f0-9-]{36}\/(?:avatar|gallery-[0-9]+)\/[a-f0-9]{64}\.webp$/iu;
  const specialistAvatar = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  recorder.record('MEDIA-002', publishedPathPattern.test(String(specialistAvatar ?? '')), 'published specialist media namespace evaluated');
  const publicSpecialist = await anon.from('published_specialists').select('avatar_path').eq('id', ids.specialistA).maybeSingle();
  recorder.record('MEDIA-003', !publicSpecialist.error && publishedPathPattern.test(String(publicSpecialist.data?.avatar_path ?? '')), 'public projection media namespace evaluated');

  const canonicalHash = createHash('sha256').update(webp).digest('hex');
  const controlledPath = `published/${users.userA.id}/applications/${ids.appA}/avatar/${canonicalHash}.webp`;
  const ownerCanonical = await users.userA.client.storage.from('profile-media').upload(controlledPath, webp, { contentType: 'image/webp', upsert: false });
  recorder.record('MEDIA-004', Boolean(ownerCanonical.error) && (await storageBytes(service, 'profile-media', controlledPath)) === null, 'owner canonical-namespace insertion denied');
  const moderatorCanonical = await users.moderator.client.storage.from('profile-media').upload(controlledPath, webp, { contentType: 'image/webp', upsert: false });
  recorder.record('MEDIA-005', Boolean(moderatorCanonical.error) && (await storageBytes(service, 'profile-media', controlledPath)) === null, 'moderator client canonical-namespace insertion denied');
  const moderatorReferenceSubstitution = await users.moderator.client
    .from('specialists')
    .update({ avatar_path: controlledPath })
    .eq('id', ids.specialistA);
  const pathAfterModeratorSubstitution = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  recorder.record('MEDIA-018', Boolean(moderatorReferenceSubstitution.error) && pathAfterModeratorSubstitution === specialistAvatar, 'moderator client canonical-looking reference substitution denied');
  const serviceCanonical = await service.storage.from('profile-media').upload(controlledPath, webp, { contentType: 'image/webp', upsert: false });
  const serviceOverwrite = await service.storage.from('profile-media').upload(controlledPath, webpReplacement, { contentType: 'image/webp', upsert: false });
  const controlledBytes = await storageBytes(service, 'profile-media', controlledPath);
  recorder.record('MEDIA-006', !serviceCanonical.error && Boolean(serviceOverwrite.error) && sameBytes(controlledBytes, webp), 'controlled writer no-overwrite semantics verified');

  const applicationPublisherAcl = (await queryLocalSql(stack, toolchain.dockerBin, env, `
    select exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='approve_application_with_canonical_media_v2'
        and oidvectortypes(p.proargtypes)='uuid, uuid, timestamp with time zone, text, jsonb, jsonb'
        and not has_function_privilege('anon',p.oid,'EXECUTE')
        and not has_function_privilege('authenticated',p.oid,'EXECUTE')
    );
  `)) === 't';
  const applicationPublication = await publishCanonicalMediaSet({
    storage: service.storage,
    ownerId: users.userA.id,
    entityType: 'applications',
    entityId: ids.appA,
    avatarPath: sourcePath,
  });
  const applicationReviewedAt = await rowValue(service, 'applications', ids.appA, 'updated_at');
  await service.from('applications').update({ internal_notes: 'Synthetic owner-visible review race marker' }).eq('id', ids.appA);
  const applicationPublish = await service.rpc('approve_application_with_canonical_media_v2', {
    application_uuid: ids.appA,
    reviewer_uuid: users.moderator.id,
    expected_updated_at: applicationReviewedAt,
    note: null,
    avatar_descriptor: applicationPublication.avatar,
    gallery_descriptors: applicationPublication.gallery,
  });
  const applicationStatus = await rowValue(service, 'applications', ids.appA, 'status');
  const applicationPathAfterStale = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  recorder.record('MEDIA-019', Boolean(applicationPublish.error) && applicationStatus !== 'approved' && Boolean(applicationReviewedAt), 'stale application review rejected after the reviewed row changed');
  const applicationFreshUpdatedAt = await rowValue(service, 'applications', ids.appA, 'updated_at');
  const applicationFreshAttempts = await Promise.all([0, 1].map(() => service.rpc('approve_application_with_canonical_media_v2', {
      application_uuid: ids.appA,
      reviewer_uuid: users.moderator.id,
      expected_updated_at: applicationFreshUpdatedAt,
      note: null,
      avatar_descriptor: applicationPublication.avatar,
      gallery_descriptors: applicationPublication.gallery,
    })));
  const applicationSuccessCount = applicationFreshAttempts.filter((attempt) => !attempt.error).length;
  const applicationFreshStatus = await rowValue(service, 'applications', ids.appA, 'status');
  const applicationPublishedPath = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  recorder.record('MEDIA-009', applicationPublisherAcl && applicationSuccessCount === 1 && applicationFreshStatus === 'approved' && applicationPublishedPath === applicationPublication.avatar.canonical_path && applicationPathAfterStale === specialistAvatar, 'service-only application publication completed only for the reviewed row version');
  recorder.record('MEDIA-021', applicationSuccessCount === 1 && applicationFreshStatus === 'approved' && applicationPublishedPath === applicationPublication.avatar.canonical_path, 'concurrent application publication replay serialized to one decision');

  const publishedBeforeDelete = applicationPublishedPath;
  const publishedBytesBeforeDelete = await storageBytes(service, 'profile-media', String(publishedBeforeDelete ?? ''));
  await users.userA.client.storage.from('profile-media').remove([sourcePath]);
  const publishedAfterDelete = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  const publishedBytesAfterDelete = await storageBytes(service, 'profile-media', String(publishedAfterDelete ?? ''));
  recorder.record('MEDIA-007', sameBytes(await storageBytes(service, 'profile-media', sourcePath), webp) && publishedAfterDelete === publishedBeforeDelete && sameBytes(publishedBytesAfterDelete, publishedBytesBeforeDelete), 'direct source deletion denied and published canonical bytes remained stable');

  const revisionPublisherAcl = (await queryLocalSql(stack, toolchain.dockerBin, env, `
    select exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='apply_specialist_revision_with_canonical_media_v2'
        and oidvectortypes(p.proargtypes)='uuid, uuid, timestamp with time zone, text, jsonb, jsonb'
        and not has_function_privilege('anon',p.oid,'EXECUTE')
        and not has_function_privilege('authenticated',p.oid,'EXECUTE')
    );
  `)) === 't';
  const revisionSource = `submissions/${users.userA.id}/avatar/${randomUUID()}.webp`;
  await uploadRegisteredSubmission(service, users.userA.id, revisionSource, webpReplacement);
  await insertFixture(service, 'specialist_revisions', {
    id: ids.revisionMedia,
    specialist_id: ids.specialistA,
    owner_id: users.userA.id,
    payload: fixtures.revisionPayload(users.userA.id, 'Media', revisionSource),
    status: 'pending',
  });
  const beforeRevisionPath = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  const directRevisionApproval = await users.moderator.client.rpc('apply_specialist_revision', { revision_uuid: ids.revisionMedia, approve: true, note: null });
  const afterDirectRevisionPath = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  const directRevisionStatus = await rowValue(service, 'specialist_revisions', ids.revisionMedia, 'status');
  recorder.record('MEDIA-008', Boolean(directRevisionApproval.error) && directRevisionStatus === 'pending' && afterDirectRevisionPath === beforeRevisionPath, 'client approval of changed mutable media failed closed');
  const revisionReviewedAt = await rowValue(service, 'specialist_revisions', ids.revisionMedia, 'updated_at');
  const replacementRevisionSource = `submissions/${users.userA.id}/avatar/${randomUUID()}.webp`;
  await uploadRegisteredSubmission(service, users.userA.id, replacementRevisionSource, webp);
  await service.from('specialist_revisions').update({ payload: fixtures.revisionPayload(users.userA.id, 'Media replacement', replacementRevisionSource) }).eq('id', ids.revisionMedia);
  const replacementRevisionPublication = await publishCanonicalMediaSet({
    storage: service.storage,
    ownerId: users.userA.id,
    entityType: 'revisions',
    entityId: ids.revisionMedia,
    avatarPath: replacementRevisionSource,
  });
  const revisionPublish = await service.rpc('apply_specialist_revision_with_canonical_media_v2', {
    revision_uuid: ids.revisionMedia,
    reviewer_uuid: users.moderator.id,
    expected_updated_at: revisionReviewedAt,
    note: null,
    avatar_descriptor: replacementRevisionPublication.avatar,
    gallery_descriptors: replacementRevisionPublication.gallery,
  });
  const afterRevisionPath = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  const revisionStatus = await rowValue(service, 'specialist_revisions', ids.revisionMedia, 'status');
  recorder.record('MEDIA-020', Boolean(revisionPublish.error) && revisionStatus === 'pending' && afterRevisionPath === beforeRevisionPath && Boolean(revisionReviewedAt), 'stale revision review rejected after owner media changed');
  const revisionFreshUpdatedAt = await rowValue(service, 'specialist_revisions', ids.revisionMedia, 'updated_at');
  const revisionFreshAttempts = await Promise.all([0, 1].map(() => service.rpc('apply_specialist_revision_with_canonical_media_v2', {
      revision_uuid: ids.revisionMedia,
      reviewer_uuid: users.moderator.id,
      expected_updated_at: revisionFreshUpdatedAt,
      note: null,
      avatar_descriptor: replacementRevisionPublication.avatar,
      gallery_descriptors: replacementRevisionPublication.gallery,
    })));
  const revisionSuccessCount = revisionFreshAttempts.filter((attempt) => !attempt.error).length;
  const afterFreshRevisionPath = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  const freshRevisionStatus = await rowValue(service, 'specialist_revisions', ids.revisionMedia, 'status');
  recorder.record('MEDIA-010', revisionPublisherAcl && revisionSuccessCount === 1 && freshRevisionStatus === 'approved' && afterFreshRevisionPath === replacementRevisionPublication.avatar.canonical_path && afterFreshRevisionPath !== beforeRevisionPath, 'service-only revision publication changed the canonical reference only for the reviewed row version');
  recorder.record('MEDIA-022', revisionSuccessCount === 1 && freshRevisionStatus === 'approved' && afterFreshRevisionPath === replacementRevisionPublication.avatar.canonical_path, 'concurrent revision publication replay serialized to one decision');

  const raceRevisionSource = `submissions/${users.userA.id}/avatar/${randomUUID()}.webp`;
  await uploadRegisteredSubmission(service, users.userA.id, raceRevisionSource, webpReplacement);
  await insertFixture(service, 'specialist_revisions', {
    id: ids.revisionRace,
    specialist_id: ids.specialistA,
    owner_id: users.userA.id,
    payload: fixtures.revisionPayload(users.userA.id, 'Decision race', raceRevisionSource),
    status: 'pending',
  });
  const raceReviewedAt = await rowValue(service, 'specialist_revisions', ids.revisionRace, 'updated_at');
  const racePathBefore = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  const racePublication = await publishCanonicalMediaSet({
    storage: service.storage,
    ownerId: users.userA.id,
    entityType: 'revisions',
    entityId: ids.revisionRace,
    avatarPath: raceRevisionSource,
  });
  const raceAttempts = await Promise.all([
    service.rpc('apply_specialist_revision_with_canonical_media_v2', {
      revision_uuid: ids.revisionRace,
      reviewer_uuid: users.moderator.id,
      expected_updated_at: raceReviewedAt,
      note: null,
      avatar_descriptor: racePublication.avatar,
      gallery_descriptors: racePublication.gallery,
    }),
    users.moderator.client.rpc('moderator_decide_revision_v2', {
      p_revision_id: ids.revisionRace,
      p_expected_updated_at: raceReviewedAt,
      p_expected_status: 'pending',
      p_decision: 'reject',
      p_operation_id: randomUUID(),
      p_note: 'Synthetic concurrent rejection',
    }),
  ]);
  const raceSuccessCount = raceAttempts.filter((attempt) => !attempt.error).length;
  const raceStatus = await rowValue(service, 'specialist_revisions', ids.revisionRace, 'status');
  const racePathAfter = await rowValue(service, 'specialists', ids.specialistA, 'avatar_path');
  const raceStateValid = raceStatus === 'approved'
    ? racePathAfter === racePublication.avatar.canonical_path
    : raceStatus === 'rejected' && racePathAfter === racePathBefore;
  recorder.record('MEDIA-023', raceSuccessCount === 1 && raceStateValid, 'overlapping revision approval and rejection serialized to one internally consistent decision');
  const unusedPath = `submissions/${users.userA.id}/avatar/${randomUUID()}.webp`;
  const unusedUpload = await uploadRegisteredSubmission(service, users.userA.id, unusedPath, webp);
  const unusedDelete = await users.userA.client.storage.from('profile-media').remove([unusedPath]);
  recorder.record('MEDIA-011', !unusedUpload.error && sameBytes(await storageBytes(service, 'profile-media', unusedPath), webp), `direct unused-submission delete changed zero objects${unusedDelete.error ? ' with explicit denial' : ''}; trusted cleanup is tested separately`);
  recorder.record('MEDIA-012', controlledBytes !== null && createHash('sha256').update(controlledBytes).digest('hex') === canonicalHash, 'canonical path content hash verified without logging content');

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

  const revokedApplication = await service.from('applications').select('workflow_version,status').eq('id', ids.appRevoked).single();
  const { error: revokeError } = await service.from('moderators').delete().eq('user_id', users.moderator.id);
  if (revokeError) throw new Error(`Synthetic moderator revocation failed: ${revokeError.message}`);
  const afterRevoke = await users.moderator.client.rpc('moderator_decide_application_v2', {
    p_application_id: ids.appRevoked,
    p_expected_version: revokedApplication.data?.workflow_version,
    p_expected_status: revokedApplication.data?.status,
    p_decision: 'reject',
    p_operation_id: randomUUID(),
    p_internal_note: 'Synthetic revoked-role decision',
    p_applicant_message: null,
  });
  recorder.record('ROLE-006', Boolean(afterRevoke.error) && await rowValue(service, 'applications', ids.appRevoked, 'status') === 'screening', 'revoked local moderator token no longer passes the current-role mutation check');
}

async function executeRun(runNumber, guard, env) {
  const recorder = createRecorder();
  let stack;
  let cleanup;
  try {
    stack = await createLocalStack({ runNumber, repoRoot, ...guard.toolchain, env });
    if (!stack.projectId.startsWith(requiredProjectPrefix)) throw new Error('Disposable project prefix guard failed');
    const diagnostics = await runLocalDatabaseDiagnostics(stack, guard.toolchain, env);
    const { service, users } = await createSyntheticUsers(stack);
    const fixtures = await buildFixtures(stack, service, users, guard.toolchain, env);
    await runCatalogCases(recorder, stack, guard.toolchain, env);
    await runP007Cases(recorder, stack, service, users, fixtures, guard.toolchain, env);
    await runP008Cases(recorder, stack, service, users, fixtures, guard.toolchain, env);
    await runP009Cases(recorder, stack, service, users, fixtures, guard.toolchain, env, enableAal2);
    await runBehaviorCases(recorder, stack, service, users, fixtures, guard.toolchain, env);
    const results = recorder.finalize();
    const counts = Object.fromEntries(['PASS','XFAIL','XPASS','FAIL','SKIP'].map((name) => [name, results.filter((entry) => entry.result === name).length]));
    return {
      runNumber,
      projectId: stack.projectId,
      ports: stack.ports,
      results,
      counts,
      diagnostics,
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
  assert.deepEqual(first.diagnostics, second.diagnostics, 'Independent runs produced different database diagnostic counts');
}

function printSummary(first, second) {
  const format = (run) => `PASS=${run.counts.PASS} XFAIL=${run.counts.XFAIL} XPASS=${run.counts.XPASS} FAIL=${run.counts.FAIL} SKIP=${run.counts.SKIP}`;
  console.log('AL-AMIN_ROLE_MATRIX_LOCAL_ONLY');
  console.log(`RUN_1 ${format(first)}`);
  console.log(`RUN_2 ${format(second)}`);
  console.log(`DB_LINT ERROR=${first.diagnostics.lint.ERROR} WARN=${first.diagnostics.lint.WARN} INFO=${first.diagnostics.lint.INFO}`);
  console.log(`DB_SECURITY_ADVISORS ERROR=${first.diagnostics.advisors.ERROR} WARN=${first.diagnostics.advisors.WARN} INFO=${first.diagnostics.advisors.INFO}`);
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
