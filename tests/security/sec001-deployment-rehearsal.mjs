import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { publishCanonicalMedia } from '../../src/lib/published-media.mjs';
import { runSec001Backfill } from './helpers/sec001-backfill.mjs';
import { redactCommandError, runCommand } from './role-matrix/helpers/command.mjs';
import { applyForwardMigration, cleanupLocalStack, createLocalStack, queryLocalSql } from './role-matrix/helpers/local-stack.mjs';
import {
  acquireLocalLock, advance, assertObservationGate, assertPhaseBGate, createCheckpoint,
  finish, readCheckpoint, recordBackfillProgress, releaseLocalLock, writeCheckpoint,
} from '../../scripts/release/sec001/lib/release-state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const requiredBaselineHash = 'CF61CDB37D9B82B3AFFFF035A0EAF68B1FABC2022C261F87027AE95583C153E1';
const phaseA = '202608110001_sec001_immutable_published_media.sql';
const legacyContractForwardFix = '20260811000150_sec001_legacy_contract_backfill_compatibility.sql';
const phaseB = '202608110002_sec001_enforce_canonical_published_media.sql';
const remainingForwardMigrations = [
  '20260813154850_sec002_owner_safe_applications_projection.sql',
  '20260813163013_sec003_moderator_admin_boundary.sql',
  '20260813202524_sec004_safe_feedback_gateway.sql',
  '20260814005517_p007_atomic_application_workflows.sql',
  '20260816020000_sec006_fail_closed_media_cleanup.sql',
  '20260817090000_p009_catalog_identity_privileged_reads.sql',
  '20260817103731_p010_resource_auth_release_controls.sql',
];
const results = [];

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'X-ALAMIN-TEST': 'synthetic-local-only' } },
};

function record(run, id, passed) {
  results.push({ run, id, result: passed ? 'PASS' : 'FAIL' });
  if (!passed) throw new Error(`SEC-001 deployment rehearsal failed: ${id}`);
}

function sanitizedEnvironment() {
  const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' };
  for (const name of [
    'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_ID', 'SUPABASE_PROJECT_REF',
    'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'DATABASE_URL', 'POSTGRES_PASSWORD', 'PGPASSWORD',
  ]) delete env[name];
  return env;
}

async function firstExecutable(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    try { await access(candidate, fsConstants.X_OK); return candidate; } catch {}
  }
  throw new Error('Pinned local toolchain is unavailable');
}

async function toolchain(env) {
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const supabaseBin = await firstExecutable([
    process.env.ALAMIN_SUPABASE_BIN,
    join(localAppData, 'Programs', 'SupabaseCLI', '2.113.0', 'supabase.exe'),
  ]);
  const dockerBin = await firstExecutable([
    process.env.ALAMIN_DOCKER_BIN,
    join(localAppData, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'),
    'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
  ]);
  env.Path = `${dirname(dockerBin)};${env.Path ?? env.PATH ?? ''}`;
  const version = (await runCommand(supabaseBin, ['--version'], { env })).stdout;
  const context = (await runCommand(dockerBin, ['context', 'show'], { env })).stdout.trim();
  const info = (await runCommand(dockerBin, ['info', '--format', '{{.OSType}}'], { env })).stdout.trim();
  if (!version.includes('2.113.0') || context !== 'desktop-linux' || info !== 'linux') {
    throw new Error('Pinned local-only toolchain guard failed');
  }
  return { supabaseBin, dockerBin };
}

async function applyReleasePhase({ stack, tools, env, name, allowFailure = false }) {
  if (!stack.dbUrl) throw new Error('Disposable database URL is unavailable');
  const databaseUrl = new URL(stack.dbUrl);
  const sqlPath = join(repoRoot, 'supabase', 'forward-migrations', name);
  const helperPath = join(repoRoot, 'scripts', 'release', 'sec001', 'Invoke-IsolatedReleasePsql.sh');
  const mode = name === phaseA ? 'phase-a' : name === legacyContractForwardFix ? 'legacy-fix' : 'phase-b';
  try {
    return await runCommand(tools.dockerBin, [
    'run', '--rm', '-i', '--tmpfs', '/run/secrets:rw,noexec,nosuid,nodev,size=64k',
    '--mount', `type=bind,src=${sqlPath},dst=/release/stage.sql,readonly`,
    '--mount', `type=bind,src=${helperPath},dst=/release/run.sh,readonly`,
    'postgres:17.6-bookworm', 'bash', '/release/run.sh',
    'host.docker.internal', 'supabase_admin', databaseUrl.pathname.slice(1),
    databaseUrl.port, mode,
  ], {
    env, input: `${decodeURIComponent(databaseUrl.password)}\n`, timeoutMs: 300_000, allowFailure,
    });
  } catch (error) {
    error.safeMessage = `LOCAL_RELEASE_CLIENT: ${redactCommandError(error)}`;
    throw error;
  }
}

async function guard(env) {
  if (process.env.ALAMIN_SECURITY_LOCAL_ONLY !== '1') throw new Error('ALAMIN_SECURITY_LOCAL_ONLY=1 is required');
  const baseline = await readFile(join(repoRoot, 'supabase', 'bootstrap', 'baseline.sql'));
  if (createHash('sha256').update(baseline).digest('hex').toUpperCase() !== requiredBaselineHash) {
    throw new Error('Verified bootstrap baseline changed');
  }
  const remotes = await runCommand('git', ['-c', `safe.directory=${repoRoot.replaceAll('\\', '/')}`, 'remote'], { cwd: repoRoot, env });
  if (remotes.stdout.trim()) throw new Error('Rehearsal refuses a repository with a Git remote');
  return await toolchain(env);
}

async function createOwners(service, stack, count) {
  const owners = [];
  for (let index = 0; index < count; index += 1) {
    const password = `L0cal!${randomBytes(18).toString('base64url')}`;
    const email = `sec001-${index}-${stack.projectId.slice(-8)}@example.invalid`;
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error('Synthetic Auth fixture creation failed');
    owners.push({ id: data.user.id, email, password });
  }
  return owners;
}

function sourcePath(ownerId, kind = 'avatar') {
  return `submissions/${ownerId}/${kind}/${randomUUID()}.webp`;
}

async function upload(service, path, bytes, upsert = false) {
  const { error } = await service.storage.from('profile-media').upload(path, bytes, {
    contentType: 'image/webp', upsert,
  });
  if (error) throw new Error('Synthetic Storage fixture upload failed');
}

function application(id, ownerId, mainImagePath, status = 'approved', galleryPaths = []) {
  return {
    id, owner_id: ownerId, full_name: 'Synthetic SEC-001 profile', contact: 'fixture@example.invalid',
    country: 'Synthetic Country', city: 'Synthetic City', category_text: 'Synthetic Category',
    specialization: 'Synthetic specialization', description: 'Synthetic local-only description long enough for the verified contract.',
    services: 'Synthetic offer', experience_years: 5, consent_truthful: true, consent_personal_data: true,
    contract_version: 2, profile_summary: 'Synthetic summary',
    help_topics: [{ title: 'Synthetic help', description: 'Synthetic local-only description.' }],
    work_offers: [{ title: 'Synthetic offer', mode: 'online' }],
    main_image_path: mainImagePath, gallery_paths: galleryPaths, status,
  };
}

function specialist(id, ownerId, applicationId, categoryId, avatarPath, galleryPaths = []) {
  return {
    id, owner_id: ownerId, application_id: applicationId, category_id: categoryId,
    slug: `sec001-${id.slice(-6)}`, full_name: 'Synthetic SEC-001 specialist', country: 'Synthetic Country',
    city: 'Synthetic City', specialization: 'Synthetic specialization', services: ['Synthetic offer'],
    service_mode: 'online', experience_years: 5, short_description: 'Synthetic summary',
    full_description: 'Synthetic local-only specialist description long enough for the verified contract.',
    public_contact: 'public-fixture@example.invalid', contract_version: 2,
    profile_summary: 'Synthetic summary', help_topics: [{ title: 'Synthetic help', description: 'Synthetic.' }],
    work_offers: [{ title: 'Synthetic offer', mode: 'online' }], avatar_path: avatarPath, gallery_paths: galleryPaths,
    status: 'published', published_at: new Date().toISOString(),
  };
}

async function row(service, table, id, fields) {
  const { data, error } = await service.from(table).select(fields).eq('id', id).single();
  if (error || !data) throw new Error(`Synthetic ${table} verification failed`);
  return data;
}

function sqlQuote(value) { return String(value).replaceAll("'", "''"); }

async function executeRehearsal(runNumber, tools, env) {
  let stack;
  let releaseDirectory;
  let lockHeld = false;
  const sessionId = `rehearsal-${runNumber}-${randomUUID()}`;
  try {
    releaseDirectory = await mkdtemp(join(tmpdir(), `alamin-sec001-release-${runNumber}-`));
    const checkpointPath = join(releaseDirectory, 'checkpoint.json');
    const lockPath = join(releaseDirectory, 'release.lock');
    await acquireLocalLock(lockPath, { owner: 'synthetic-rehearsal', sessionId });
    lockHeld = true;
    let checkpoint = createCheckpoint({
      sourceCommit: '2861305e2c83725d26ea01a5ca474d19b440a6c5',
      artifactManifestHash: 'A'.repeat(64), projectFingerprint: 'B'.repeat(64),
    });
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
    stack = await createLocalStack({
      runNumber, repoRoot, ...tools, env, projectPrefix: 'alamin-sec001-rehearsal', forwardMigrationNames: [],
    });
    const service = createClient(stack.apiUrl, stack.serviceRoleKey, clientOptions);
    const owners = await createOwners(service, stack, 9);
    const ids = {
      category: '11111111-1111-4111-8111-000000000001',
      valid: '11111111-1111-4111-8111-000000000010',
      missing: '11111111-1111-4111-8111-000000000020',
      corrupt: '11111111-1111-4111-8111-000000000030',
      conflict: '11111111-1111-4111-8111-000000000040',
      mixed: '11111111-1111-4111-8111-000000000050',
      pending: '11111111-1111-4111-8111-000000000060',
      rejected: '11111111-1111-4111-8111-000000000070',
      legacy: '11111111-1111-4111-8111-000000000080',
      legacyV1: '11111111-1111-4111-8111-000000000081',
      legacyConflict: '11111111-1111-4111-8111-000000000090',
      specialist: '11111111-1111-4111-8111-000000000110',
      legacySpecialist: '11111111-1111-4111-8111-000000000140',
      revisionPending: '11111111-1111-4111-8111-000000000120',
      revisionRejected: '11111111-1111-4111-8111-000000000130',
    };
    const bytes = await sharp({ create: { width: 10, height: 8, channels: 3, background: '#335577' } }).webp().toBuffer();
    const replacement = await sharp({ create: { width: 9, height: 11, channels: 3, background: '#773355' } }).webp().toBuffer();
    const paths = {
      valid: sourcePath(owners[0].id), missing: sourcePath(owners[1].id), corrupt: sourcePath(owners[2].id),
      conflict: sourcePath(owners[3].id), mixedAvatar: sourcePath(owners[4].id), mixedGallery: sourcePath(owners[4].id, 'gallery'),
      pending: sourcePath(owners[5].id), rejected: sourcePath(owners[6].id), orphan: sourcePath(owners[7].id),
      legacyFresh: sourcePath(owners[8].id),
      legacyV1: sourcePath(owners[8].id),
      legacyMain: `submissions/${randomUUID()}/main-${randomUUID()}.png`,
      legacyGallery: `submissions/${randomUUID()}/gallery-0-${randomUUID()}.jpg`,
    };
    await Promise.all([
      upload(service, paths.valid, bytes), upload(service, paths.missing, bytes), upload(service, paths.corrupt, bytes),
      upload(service, paths.conflict, bytes), upload(service, paths.mixedAvatar, bytes), upload(service, paths.mixedGallery, bytes),
      upload(service, paths.pending, bytes), upload(service, paths.rejected, bytes), upload(service, paths.orphan, bytes),
      upload(service, paths.legacyFresh, bytes), upload(service, paths.legacyV1, bytes),
      upload(service, paths.legacyMain, bytes), upload(service, paths.legacyGallery, bytes),
    ]);
    const { error: categoryError } = await service.from('categories').insert({
      id: ids.category, name: 'Synthetic SEC-001', slug: `sec001-${stack.projectId.slice(-8)}`, group_name: 'Synthetic', is_active: true,
    });
    if (categoryError) throw new Error('Synthetic category fixture failed');
    const applications = [
      application(ids.valid, owners[0].id, paths.valid), application(ids.missing, owners[1].id, paths.missing),
      application(ids.corrupt, owners[2].id, paths.corrupt), application(ids.conflict, owners[3].id, paths.conflict),
      application(ids.mixed, owners[4].id, paths.mixedAvatar, 'approved', [paths.mixedGallery]),
      application(ids.pending, owners[5].id, paths.pending, 'new'), application(ids.rejected, owners[6].id, paths.rejected, 'rejected'),
      application(ids.legacy, owners[8].id, paths.legacyFresh, 'approved', []),
      application(ids.legacyV1, owners[8].id, paths.legacyV1, 'approved', []),
    ];
    const { error: appError } = await service.from('applications').insert(applications);
    if (appError) throw new Error(`Synthetic application fixtures failed: ${appError.message}`);
    const { error: specialistError } = await service.from('specialists').insert([
      specialist(ids.specialist, owners[0].id, ids.valid, ids.category, paths.valid),
      specialist(ids.legacySpecialist, owners[8].id, ids.legacy, ids.category, paths.legacyFresh),
    ]);
    if (specialistError) throw new Error(`Synthetic specialist fixture failed: ${specialistError.message}`);
    await queryLocalSql(stack, tools.dockerBin, env, `
      begin;
      set local session_replication_role = replica;
      update public.applications
      set main_image_path='${sqlQuote(paths.legacyMain)}', gallery_paths=array['${sqlQuote(paths.legacyGallery)}']::text[]
      where id='${ids.legacy}'::uuid;
      update public.applications set contract_version=1 where id='${ids.legacyV1}'::uuid;
      update public.specialists
      set avatar_path='${sqlQuote(paths.legacyMain)}', gallery_paths=array['${sqlQuote(paths.legacyGallery)}']::text[]
      where id='${ids.legacySpecialist}'::uuid;
      commit;
    `);
    const revisionPayload = {
      contract_version: 2, full_name: 'Synthetic SEC-001 specialist', country: 'Synthetic Country',
      city: 'Synthetic City', category_id: ids.category, additional_category_ids: [],
      specialization: 'Synthetic specialization', experience_years: 5, profile_summary: 'Synthetic summary',
      help_topics: [{ title: 'Synthetic help', description: 'Synthetic local-only description.' }],
      work_offers: [{ title: 'Synthetic offer', mode: 'online' }],
      full_description: 'Synthetic local-only specialist description long enough for the verified contract.',
      avatar_path: paths.valid,
    };
    const { error: revisionError } = await service.from('specialist_revisions').insert([
      { id: ids.revisionPending, specialist_id: ids.specialist, owner_id: owners[0].id, payload: revisionPayload, status: 'pending' },
      { id: ids.revisionRejected, specialist_id: ids.specialist, owner_id: owners[0].id, payload: revisionPayload, status: 'rejected' },
    ]);
    if (revisionError) throw new Error(`Synthetic revision fixtures failed: ${revisionError.message}`);
    record(runNumber, 'BASELINE-LEGACY-READABLE', (await service.from('published_specialists').select('id').eq('id', ids.specialist)).data?.length === 1);
    checkpoint = advance(checkpoint, 'PREFLIGHT_PASSED', { evidence: { localOnly: true, artifactHashes: 'PASS' } });
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
    await applyReleasePhase({ stack, tools, env, name: phaseA });
    record(runNumber, 'PHASE-A-APPLIED', true);
    checkpoint = advance(checkpoint, 'PHASE_A_APPLIED', { evidence: { catalogVerification: 'PASS' } });
    checkpoint = advance(checkpoint, 'SOURCE_DEPLOY_CONFIRMED', { evidence: { localSourceCommit: checkpoint.sourceCommit } });

    const legacyV1Before = await row(service, 'applications', ids.legacyV1, 'contract_version,full_name,main_image_path');
    const legacyV1Descriptor = await publishCanonicalMedia({
      storage: service.storage, ownerId: owners[8].id, entityType: 'backfill-applications',
      entityId: ids.legacyV1, slot: 'avatar', sourcePath: paths.legacyV1,
    });
    const legacyV1Red = await service.rpc('backfill_canonical_published_media', {
      target_type: 'applications', target_uuid: ids.legacyV1,
      expected_avatar_path: paths.legacyV1, expected_gallery_paths: [],
      avatar_descriptor: legacyV1Descriptor, gallery_descriptors: [],
    });
    record(runNumber, 'LEGACY-V1-RED-PHASE-REPRODUCED',
      legacyV1Red.error?.code === 'P0001'
      && legacyV1Red.error?.message === 'Changed application content must use contract version 2'
      && (await row(service, 'applications', ids.legacyV1, 'main_image_path')).main_image_path === paths.legacyV1);

    await applyReleasePhase({ stack, tools, env, name: legacyContractForwardFix });
    await applyReleasePhase({ stack, tools, env, name: legacyContractForwardFix });
    const compatibilityMarker = await queryLocalSql(stack, tools.dockerBin, env, `
      select obj_description('public.require_application_contract_v2_on_content_write()'::regprocedure, 'pg_proc');
    `);
    record(runNumber, 'LEGACY-V1-FORWARD-FIX-APPLIED',
      compatibilityMarker === 'AL-AMIN SEC-001 legacy canonical backfill compatibility v1');

    const legacyV1Retry = await service.rpc('backfill_canonical_published_media', {
      target_type: 'applications', target_uuid: ids.legacyV1,
      expected_avatar_path: paths.legacyV1, expected_gallery_paths: [],
      avatar_descriptor: legacyV1Descriptor, gallery_descriptors: [],
    });
    const legacyV1After = await row(service, 'applications', ids.legacyV1, 'contract_version,full_name,main_image_path');
    record(runNumber, 'LEGACY-V1-CANONICAL-BACKFILL-PASS',
      !legacyV1Retry.error
      && legacyV1After.main_image_path === legacyV1Descriptor.canonical_path);
    record(runNumber, 'LEGACY-V1-BUSINESS-CONTRACT-PRESERVED',
      legacyV1After.contract_version === 1
      && legacyV1After.full_name === legacyV1Before.full_name);
    await assert.rejects(queryLocalSql(stack, tools.dockerBin, env, `
      begin;
      set local request.jwt.claims = '{"role":"service_role"}';
      update public.applications set full_name=full_name || ' blocked' where id='${ids.legacyV1}'::uuid;
      commit;
    `));
    record(runNumber, 'LEGACY-V1-NONMEDIA-BYPASS-DENIED',
      (await row(service, 'applications', ids.legacyV1, 'full_name')).full_name === legacyV1Before.full_name);

    const { error: conflictFixtureError } = await service.from('applications').insert(
      application(ids.legacyConflict, owners[7].id, paths.orphan, 'new'),
    );
    if (conflictFixtureError) throw new Error('Synthetic cross-owner fixture failed');
    await queryLocalSql(stack, tools.dockerBin, env, `
      begin;
      set local session_replication_role = replica;
      update public.applications set status='approved', main_image_path='${sqlQuote(paths.legacyMain)}'
      where id='${ids.legacyConflict}'::uuid;
      commit;
    `);
    await assert.rejects(runSec001Backfill({ service, dryRun: true }), /cross-owner or ambiguous/u);
    record(runNumber, 'LEGACY-CROSS-OWNER-BLOCKED', true);
    await queryLocalSql(stack, tools.dockerBin, env, `delete from public.applications where id='${ids.legacyConflict}'::uuid;`);

    const mixedCanonical = await publishCanonicalMedia({
      storage: service.storage, ownerId: owners[4].id, entityType: 'backfill-applications',
      entityId: ids.mixed, slot: 'avatar', sourcePath: paths.mixedAvatar,
    });
    await queryLocalSql(stack, tools.dockerBin, env, `
      insert into private.published_media_assets (
        canonical_path,owner_id,source_entity_type,source_entity_id,slot,source_path,
        source_sha256,canonical_sha256,canonical_bytes
      ) values (
        '${sqlQuote(mixedCanonical.canonical_path)}','${sqlQuote(owners[4].id)}'::uuid,'backfill-applications','${ids.mixed}'::uuid,
        'avatar','${sqlQuote(paths.mixedAvatar)}','${mixedCanonical.source_sha256}','${mixedCanonical.canonical_sha256}',${mixedCanonical.canonical_bytes}
      );
      begin;
      set local session_replication_role = replica;
      update public.applications set main_image_path='${sqlQuote(mixedCanonical.canonical_path)}' where id='${ids.mixed}'::uuid;
      commit;
    `);
    checkpoint = advance(checkpoint, 'CANARY_PASSED', { evidence: { canonicalCreate: 'PASS', publicRead: 'PASS', clientMutationDenied: 'PASS' } });
    const prematurePhaseB = await applyReleasePhase({ stack, tools, env, name: phaseB, allowFailure: true });
    const phaseBConstraintCount = await queryLocalSql(stack, tools.dockerBin, env, `
      select count(*) from pg_constraint where conname in ('applications_approved_media_canonical','specialists_published_media_canonical');
    `);
    record(runNumber, 'PHASE-B-BLOCKS-LEGACY', prematurePhaseB.code !== 0 && phaseBConstraintCount === '0');

    const dryRun = await runSec001Backfill({ service, dryRun: true });
    record(runNumber, 'DRY-RUN-NO-MUTATION', dryRun.planned === 8 && dryRun.applied === 0 && (await row(service, 'applications', ids.valid, 'main_image_path')).main_image_path === paths.valid);
    record(runNumber, 'LEGACY-ALLOWLIST-INVENTORY',
      dryRun.namespaceSummary.allowlistedLegacyReferenceCount === 4
      && dryRun.namespaceSummary.allowlistedLegacyObjectCount === 2
      && dryRun.namespaceSummary.crossOwnerObjectCount === 0);
    checkpoint = advance(checkpoint, 'INVENTORY_REVIEWED', { evidence: { counts: { totalLegacy: 8, alreadyCanonical: 0, missing: 0, corrupt: 0, conflict: 0, unsupported: 0, blocked: 0 } } });
    checkpoint = advance(checkpoint, 'BACKFILL_IN_PROGRESS');
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);

    const { error: removeMissingError } = await service.storage.from('profile-media').remove([paths.missing]);
    if (removeMissingError) throw new Error('Synthetic missing-source fixture preparation failed');
    await upload(service, paths.corrupt, Buffer.from('not-a-decodable-image'), true);
    const conflictCanonical = await publishCanonicalMedia({
      storage: service.storage, ownerId: owners[3].id, entityType: 'backfill-applications',
      entityId: ids.conflict, slot: 'avatar', sourcePath: paths.conflict,
    });
    await upload(service, conflictCanonical.canonical_path, replacement, true);

    await assert.rejects(runSec001Backfill({ service, dryRun: false }));
    record(runNumber, 'MISSING-SOURCE-FAIL-CLOSED', (await row(service, 'applications', ids.missing, 'main_image_path')).main_image_path === paths.missing);
    await upload(service, paths.missing, bytes);
    const missingDescriptor = await publishCanonicalMedia({
      storage: service.storage, ownerId: owners[1].id, entityType: 'backfill-applications',
      entityId: ids.missing, slot: 'avatar', sourcePath: paths.missing,
    });
    const mismatch = await service.rpc('backfill_canonical_published_media', {
      target_type: 'applications', target_uuid: ids.missing, expected_avatar_path: paths.valid,
      expected_gallery_paths: [], avatar_descriptor: missingDescriptor, gallery_descriptors: [],
    });
    record(runNumber, 'DB-CUTOVER-MISMATCH-ROLLBACK', Boolean(mismatch.error) && (await row(service, 'applications', ids.missing, 'main_image_path')).main_image_path === paths.missing);

    await assert.rejects(runSec001Backfill({ service, dryRun: false }));
    record(runNumber, 'CORRUPT-SOURCE-FAIL-CLOSED', (await row(service, 'applications', ids.corrupt, 'main_image_path')).main_image_path === paths.corrupt);
    await upload(service, paths.corrupt, bytes, true);
    const interrupted = await runSec001Backfill({ service, dryRun: false, stopAfter: 1 });
    record(runNumber, 'CHECKPOINT-INTERRUPTION', interrupted.applied === 1 && interrupted.remaining > 0);
    checkpoint = recordBackfillProgress(checkpoint, interrupted);
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);

    await assert.rejects(runSec001Backfill({ service, dryRun: false }), /conflicts/u);
    record(runNumber, 'CANONICAL-CONFLICT-FAIL-CLOSED', (await row(service, 'applications', ids.conflict, 'main_image_path')).main_image_path === paths.conflict);
    const { error: removeConflictError } = await service.storage.from('profile-media').remove([conflictCanonical.canonical_path]);
    if (removeConflictError) throw new Error('Synthetic conflict remediation failed');
    const resumed = await runSec001Backfill({ service, dryRun: false });
    record(runNumber, 'RESUME-COMPLETES', resumed.applied === 5 && resumed.remaining === 0);
    const idempotent = await runSec001Backfill({ service, dryRun: false });
    record(runNumber, 'SECOND-APPLY-ZERO', idempotent.planned === 0 && idempotent.applied === 0);
    checkpoint = recordBackfillProgress(checkpoint, { planned: 0, applied: 0, remaining: 0 });
    checkpoint.counters = { ...checkpoint.counters, changedSecondPass: 0, legacyRemaining: 0, missing: 0, corrupt: 0, conflict: 0, unsupported: 0, blocked: 0 };
    checkpoint = advance(checkpoint, 'BACKFILL_COMPLETE', { evidence: { secondPass: 'ZERO_CHANGE' } });

    const mixedAfter = await row(service, 'applications', ids.mixed, 'main_image_path,gallery_paths');
    record(runNumber, 'MIXED-STATE-ATOMIC', mixedAfter.main_image_path === mixedCanonical.canonical_path && mixedAfter.gallery_paths[0].startsWith(`published/${owners[4].id}/backfill-applications/`));
    const legacyApplicationAfter = await row(service, 'applications', ids.legacy, 'main_image_path,gallery_paths');
    const legacySpecialistAfter = await row(service, 'specialists', ids.legacySpecialist, 'avatar_path,gallery_paths');
    record(runNumber, 'VERIFIED-LEGACY-FAMILY-CANONICALIZED',
      legacyApplicationAfter.main_image_path.startsWith(`published/${owners[8].id}/backfill-applications/`)
      && legacyApplicationAfter.gallery_paths[0].startsWith(`published/${owners[8].id}/backfill-applications/`)
      && legacySpecialistAfter.avatar_path.startsWith(`published/${owners[8].id}/backfill-specialists/`)
      && legacySpecialistAfter.gallery_paths[0].startsWith(`published/${owners[8].id}/backfill-specialists/`));
    record(runNumber, 'PENDING-REJECTED-UNCHANGED',
      (await row(service, 'applications', ids.pending, 'main_image_path')).main_image_path === paths.pending
      && (await row(service, 'applications', ids.rejected, 'main_image_path')).main_image_path === paths.rejected
      && (await row(service, 'specialist_revisions', ids.revisionPending, 'payload')).payload.avatar_path === paths.valid
      && (await row(service, 'specialist_revisions', ids.revisionRejected, 'payload')).payload.avatar_path === paths.valid);

    const observation = { elapsedMinutes: 30, applicationApprovals: 2, revisionApprovals: 1, canonicalizationErrors: 0, mediaServingErrors: 0, securityErrors: 0, unresolvedAlerts: 0 };
    assertObservationGate(observation);
    checkpoint = advance(checkpoint, 'OBSERVATION_PASSED', { evidence: { metrics: observation } });
    assertPhaseBGate(checkpoint, checkpoint.counters, 'APPLY PHASE B');
    await applyReleasePhase({ stack, tools, env, name: phaseB });
    await applyReleasePhase({ stack, tools, env, name: phaseB });
    record(runNumber, 'PHASE-B-APPLIED-IDEMPOTENT', true);
    for (const name of remainingForwardMigrations) {
      await applyForwardMigration({ stack, repoRoot, dockerBin: tools.dockerBin, env, name });
    }
    record(runNumber, 'FULL-FROZEN-FORWARD-CHAIN', true);
    checkpoint = advance(checkpoint, 'PHASE_B_APPLIED', { evidence: { catalogVerification: 'PASS' } });
    const validAfter = await row(service, 'applications', ids.valid, 'main_image_path');
    const foreignSubstitution = await service.from('applications').update({ main_image_path: mixedAfter.main_image_path }).eq('id', ids.valid);
    record(runNumber, 'OWNER-PROVENANCE-CONSTRAINT', Boolean(foreignSubstitution.error) && (await row(service, 'applications', ids.valid, 'main_image_path')).main_image_path === validAfter.main_image_path);

    const { error: removeLegacyError } = await service.storage.from('profile-media').remove([paths.valid]);
    if (removeLegacyError) throw new Error('Synthetic old-source deletion failed');
    const { data: canonicalData } = await service.storage.from('profile-media').download(validAfter.main_image_path);
    record(runNumber, 'POST-CUTOVER-SOURCE-LOSS-SAFE', Boolean(canonicalData));
    const noRegression = await runSec001Backfill({ service, dryRun: false });
    record(runNumber, 'POST-CUTOVER-RETRY-IDEMPOTENT', noRegression.planned === 0);

    const oldSources = await Promise.all([
      paths.missing, paths.corrupt, paths.conflict, paths.mixedAvatar, paths.mixedGallery,
      paths.legacyV1, paths.legacyMain, paths.legacyGallery,
    ].map((path) => service.storage.from('profile-media').download(path)));
    const orphan = await service.storage.from('profile-media').download(paths.orphan);
    record(runNumber, 'OLD-SOURCES-NOT-AUTO-DELETED', oldSources.every((entry) => Boolean(entry.data)) && Boolean(orphan.data));

    const ownerClient = createClient(stack.apiUrl, stack.anonKey, clientOptions);
    const signedIn = await ownerClient.auth.signInWithPassword({ email: owners[0].email, password: owners[0].password });
    if (signedIn.error) throw new Error('Synthetic owner sign-in failed');
    const ownerDeleteCanonical = await ownerClient.storage.from('profile-media').remove([validAfter.main_image_path]);
    const afterOwnerDelete = await service.storage.from('profile-media').download(validAfter.main_image_path);
    record(runNumber, 'CLIENT-CANONICAL-DELETE-DENIED', (Boolean(ownerDeleteCanonical.error) || ownerDeleteCanonical.data?.length === 0) && Boolean(afterOwnerDelete.data));

    checkpoint = advance(checkpoint, 'POST_VERIFY_PASSED', { evidence: { roleMatrixSubset: 'PASS' } });
    checkpoint = finish(checkpoint);
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
    const persisted = await readCheckpoint(checkpointPath, repoRoot);
    record(runNumber, 'RELEASE-WRAPPER-COMPLETE', persisted.state === 'COMPLETE' && persisted.lastSuccessfulStep === 'COMPLETE');
    await releaseLocalLock(lockPath, sessionId);
    lockHeld = false;

    return { run: runNumber, count: results.filter((entry) => entry.run === runNumber).length };
  } finally {
    const cleanup = await cleanupLocalStack(stack, { supabaseBin: tools.supabaseBin, dockerBin: tools.dockerBin, env });
    if (!cleanup.ok) throw new Error(`SEC-001 cleanup residual: ${cleanup.residual.join(', ')}`);
    if (lockHeld && releaseDirectory) {
      try { await releaseLocalLock(join(releaseDirectory, 'release.lock'), sessionId); } catch {}
    }
    if (releaseDirectory) await rm(releaseDirectory, { recursive: true, force: true });
  }
}

try {
  const env = sanitizedEnvironment();
  const tools = await guard(env);
  const first = await executeRehearsal(1, tools, env);
  const second = await executeRehearsal(2, tools, env);
  const firstIds = results.filter((entry) => entry.run === 1).map((entry) => `${entry.id}:${entry.result}`);
  const secondIds = results.filter((entry) => entry.run === 2).map((entry) => `${entry.id}:${entry.result}`);
  assert.deepEqual(secondIds, firstIds);
  console.log(`SEC001_DEPLOYMENT_REHEARSAL_PASS RUN1=${first.count} RUN2=${second.count} FAIL=0`);
} catch (error) {
  console.error(`SEC001_DEPLOYMENT_REHEARSAL_BLOCKED: ${error?.safeMessage ?? redactCommandError(error)}`);
  process.exitCode = 1;
}
