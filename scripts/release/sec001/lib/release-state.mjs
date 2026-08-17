import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const STATES = Object.freeze([
  'NOT_STARTED', 'PREFLIGHT_PASSED', 'PHASE_A_APPLIED',
  'SOURCE_DEPLOY_CONFIRMED', 'CANARY_PASSED', 'INVENTORY_REVIEWED',
  'BACKFILL_IN_PROGRESS', 'BACKFILL_COMPLETE', 'OBSERVATION_PASSED',
  'PHASE_B_APPLIED', 'POST_VERIFY_PASSED', 'COMPLETE',
  'FAILED_SAFE', 'ABORTED_SAFE',
]);

const nextState = new Map([
  ['NOT_STARTED', 'PREFLIGHT_PASSED'],
  ['PREFLIGHT_PASSED', 'PHASE_A_APPLIED'],
  ['PHASE_A_APPLIED', 'SOURCE_DEPLOY_CONFIRMED'],
  ['SOURCE_DEPLOY_CONFIRMED', 'CANARY_PASSED'],
  ['CANARY_PASSED', 'INVENTORY_REVIEWED'],
  ['INVENTORY_REVIEWED', 'BACKFILL_IN_PROGRESS'],
  ['BACKFILL_IN_PROGRESS', 'BACKFILL_COMPLETE'],
  ['BACKFILL_COMPLETE', 'OBSERVATION_PASSED'],
  ['OBSERVATION_PASSED', 'PHASE_B_APPLIED'],
  ['PHASE_B_APPLIED', 'POST_VERIFY_PASSED'],
]);

function iso(now = new Date()) { return new Date(now).toISOString(); }
function sha256(value) { return createHash('sha256').update(value).digest('hex').toUpperCase(); }
function fail(code) { throw new Error(code); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function fingerprintIdentity(identity) {
  const required = ['projectRef', 'region', 'dbHost', 'catalogMarker', 'bucketNames', 'apiUrl', 'sourceVersionUrl'];
  if (!identity || required.some((key) => !identity[key])) fail('PROJECT_IDENTITY_INCOMPLETE');
  const api = new URL(identity.apiUrl);
  const version = new URL(identity.sourceVersionUrl);
  if (api.protocol !== 'https:' || api.hostname !== `${String(identity.projectRef).trim().toLowerCase()}.supabase.co`) fail('PROJECT_API_IDENTITY_MISMATCH');
  if (version.protocol !== 'https:') fail('SOURCE_VERSION_URL_NOT_HTTPS');
  if (!String(identity.dbHost).toLowerCase().includes(String(identity.projectRef).trim().toLowerCase())) fail('DATABASE_HOST_PROJECT_REF_MISMATCH');
  const normalized = {
    projectRef: String(identity.projectRef).trim().toLowerCase(),
    region: String(identity.region).trim().toLowerCase(),
    dbHost: String(identity.dbHost).trim().toLowerCase(),
    catalogMarker: String(identity.catalogMarker).trim(),
    bucketNames: [...identity.bucketNames].map(String).sort(),
    apiHost: api.hostname,
    sourceVersionHost: version.hostname,
  };
  return sha256(JSON.stringify(stable(normalized)));
}

export function assertProjectIdentity(expectedFingerprint, observedIdentity) {
  if (!/^[A-F0-9]{64}$/u.test(expectedFingerprint ?? '')) fail('EXPECTED_PROJECT_FINGERPRINT_INVALID');
  if (fingerprintIdentity(observedIdentity) !== expectedFingerprint) fail('PROJECT_IDENTITY_MISMATCH');
  return true;
}

export function createCheckpoint({ sourceCommit, artifactManifestHash, projectFingerprint, now = new Date() }) {
  for (const [name, value] of Object.entries({ sourceCommit, artifactManifestHash, projectFingerprint })) {
    if (!/^[A-Fa-f0-9]{40,64}$/u.test(value ?? '')) fail(`CHECKPOINT_${name.toUpperCase()}_INVALID`);
  }
  const at = iso(now);
  return {
    schemaVersion: 1,
    releaseId: `sec001-${randomUUID()}`,
    state: 'NOT_STARTED',
    lastSuccessfulStep: null,
    sourceCommit: sourceCommit.toLowerCase(),
    artifactManifestHash: artifactManifestHash.toUpperCase(),
    projectFingerprint: projectFingerprint.toUpperCase(),
    createdAt: at,
    updatedAt: at,
    history: [],
    counters: { totalLegacy: null, alreadyCanonical: null, missing: null, corrupt: null, conflict: null, unsupported: null, blocked: null, changedSecondPass: null, legacyRemaining: null },
  };
}

export function validateCheckpoint(checkpoint, expected, { now = new Date(), maxAgeMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  if (!checkpoint || checkpoint.schemaVersion !== 1 || !STATES.includes(checkpoint.state)) fail('CHECKPOINT_INVALID');
  if (Date.parse(checkpoint.updatedAt) > new Date(now).getTime() + 60_000) fail('CHECKPOINT_FUTURE_TIMESTAMP');
  if (new Date(now).getTime() - Date.parse(checkpoint.updatedAt) > maxAgeMs) fail('STALE_CHECKPOINT_REVIEW_REQUIRED');
  if (expected.sourceCommit && checkpoint.sourceCommit !== expected.sourceCommit.toLowerCase()) fail('SOURCE_COMMIT_MISMATCH');
  if (expected.artifactManifestHash && checkpoint.artifactManifestHash !== expected.artifactManifestHash.toUpperCase()) fail('ARTIFACT_MANIFEST_MISMATCH');
  if (expected.projectFingerprint && checkpoint.projectFingerprint !== expected.projectFingerprint.toUpperCase()) fail('PROJECT_IDENTITY_MISMATCH');
  return checkpoint;
}

export function advance(checkpoint, target, { evidence = {}, now = new Date() } = {}) {
  if (target === 'COMPLETE') fail('COMPLETE_IS_AUTOMATIC_ONLY');
  if (nextState.get(checkpoint.state) !== target) fail('INVALID_RELEASE_TRANSITION');
  const updated = structuredClone(checkpoint);
  updated.state = target;
  updated.lastSuccessfulStep = target;
  updated.updatedAt = iso(now);
  updated.history.push({ state: target, at: updated.updatedAt, evidence: stable(evidence) });
  return updated;
}

export function finish(checkpoint, { now = new Date() } = {}) {
  if (checkpoint.state !== 'POST_VERIFY_PASSED') fail('COMPLETE_PREREQUISITES_NOT_MET');
  const updated = structuredClone(checkpoint);
  updated.state = 'COMPLETE';
  updated.lastSuccessfulStep = 'COMPLETE';
  updated.updatedAt = iso(now);
  updated.history.push({ state: 'COMPLETE', at: updated.updatedAt, evidence: { automatic: true } });
  return updated;
}

export function failSafe(checkpoint, code, { now = new Date() } = {}) {
  const updated = structuredClone(checkpoint);
  updated.state = 'FAILED_SAFE';
  updated.updatedAt = iso(now);
  updated.history.push({ state: 'FAILED_SAFE', at: updated.updatedAt, evidence: { safeErrorCode: String(code).replace(/[^A-Z0-9_-]/gu, '_') } });
  return updated;
}

export function abortSafe(checkpoint, reasonCode, { now = new Date() } = {}) {
  if (['COMPLETE', 'FAILED_SAFE'].includes(checkpoint.state)) fail('ABORT_NOT_AVAILABLE');
  const updated = structuredClone(checkpoint);
  updated.state = 'ABORTED_SAFE';
  updated.updatedAt = iso(now);
  updated.history.push({ state: 'ABORTED_SAFE', at: updated.updatedAt, evidence: { safeReasonCode: String(reasonCode).replace(/[^A-Z0-9_-]/gu, '_') } });
  return updated;
}

export function assertInventoryGate(counts) {
  for (const key of ['missing', 'corrupt', 'conflict', 'unsupported', 'blocked']) {
    if (!Number.isInteger(counts?.[key]) || counts[key] !== 0) fail(`INVENTORY_${key.toUpperCase()}_NONZERO`);
  }
  return true;
}

export function assertObservationGate(metrics) {
  if (!metrics || metrics.elapsedMinutes < 30) fail('OBSERVATION_TIME_INSUFFICIENT');
  if (metrics.applicationApprovals < 2) fail('OBSERVATION_APPLICATION_SAMPLE_INSUFFICIENT');
  if (metrics.revisionApprovals < 1) fail('OBSERVATION_REVISION_SAMPLE_INSUFFICIENT');
  if (metrics.canonicalizationErrors !== 0 || metrics.mediaServingErrors !== 0 || metrics.securityErrors !== 0 || metrics.unresolvedAlerts !== 0) fail('OBSERVATION_ERRORS_PRESENT');
  return true;
}

export function assertPhaseBGate(checkpoint, counts, confirmation) {
  if (checkpoint.state !== 'OBSERVATION_PASSED') fail('PHASE_B_ATTEMPTED_EARLY');
  if (confirmation !== 'APPLY PHASE B') fail('PHASE_B_EXPLICIT_CONFIRMATION_REQUIRED');
  for (const key of ['changedSecondPass', 'legacyRemaining', 'missing', 'corrupt', 'conflict', 'unsupported', 'blocked']) {
    if (counts?.[key] !== 0) fail(`PHASE_B_${key.toUpperCase()}_NONZERO`);
  }
  return true;
}

export function recordBackfillProgress(checkpoint, counters, { now = new Date() } = {}) {
  if (checkpoint.state !== 'BACKFILL_IN_PROGRESS') fail('BACKFILL_PROGRESS_OUTSIDE_STAGE');
  for (const key of ['planned', 'applied', 'remaining']) {
    if (!Number.isInteger(counters?.[key]) || counters[key] < 0) fail('BACKFILL_COUNTER_INVALID');
  }
  const updated = structuredClone(checkpoint);
  updated.updatedAt = iso(now);
  updated.counters = { ...updated.counters, ...counters };
  updated.history.push({ state: 'BACKFILL_IN_PROGRESS', at: updated.updatedAt, evidence: { counts: stable(counters) } });
  return updated;
}

export async function verifyArtifactManifest(repoRoot, manifestPath) {
  const manifestAbsolute = resolve(repoRoot, manifestPath);
  const manifest = JSON.parse(await readFile(manifestAbsolute, 'utf8'));
  const checked = [];
  for (const artifact of manifest.artifacts ?? []) {
    const absolute = resolve(repoRoot, artifact.path);
    if (relative(repoRoot, absolute).startsWith('..')) fail('ARTIFACT_PATH_OUTSIDE_REPOSITORY');
    let bytes = await readFile(absolute);
    if (artifact.canonicalTextEol === 'LF') {
      bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n?/gu, '\n'), 'utf8');
    }
    const actual = sha256(bytes);
    if (actual !== String(artifact.sha256).toUpperCase()) fail(`ARTIFACT_HASH_MISMATCH_${artifact.id ?? 'UNKNOWN'}`);
    checked.push({ id: artifact.id, sha256: actual });
  }
  return { manifestHash: sha256(await readFile(manifestAbsolute)), checked };
}

export function assertCheckpointOutsideRepository(checkpointPath, repoRoot) {
  if (!isAbsolute(checkpointPath)) fail('CHECKPOINT_PATH_MUST_BE_ABSOLUTE');
  const relation = relative(resolve(repoRoot), resolve(checkpointPath));
  if (!relation.startsWith('..') && !isAbsolute(relation)) fail('CHECKPOINT_MUST_BE_OUTSIDE_REPOSITORY');
  return true;
}

export async function writeCheckpoint(checkpointPath, checkpoint, repoRoot) {
  assertCheckpointOutsideRepository(checkpointPath, repoRoot);
  const temp = `${checkpointPath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, checkpointPath);
}

export async function readCheckpoint(checkpointPath, repoRoot) {
  assertCheckpointOutsideRepository(checkpointPath, repoRoot);
  return JSON.parse(await readFile(checkpointPath, 'utf8'));
}

export async function acquireLocalLock(lockPath, { owner, sessionId, now = new Date(), staleAfterMs = 4 * 60 * 60 * 1000 } = {}) {
  const payload = { owner, sessionId, createdAt: iso(now), expiresAt: iso(new Date(new Date(now).getTime() + staleAfterMs)) };
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`);
    await handle.close();
    return payload;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = JSON.parse(await readFile(lockPath, 'utf8'));
    if (Date.parse(existing.expiresAt) < new Date(now).getTime()) fail('STALE_LOCK_REVIEW_REQUIRED');
    fail('RELEASE_LOCK_HELD');
  }
}

export async function releaseLocalLock(lockPath, sessionId) {
  const existing = JSON.parse(await readFile(lockPath, 'utf8'));
  if (existing.sessionId !== sessionId) fail('RELEASE_LOCK_OWNER_MISMATCH');
  await unlink(lockPath);
}

export function assertUnexpectedPhaseAState({ checkpointState, catalogPhaseA }) {
  const expectedApplied = !['NOT_STARTED', 'PREFLIGHT_PASSED'].includes(checkpointState);
  if (Boolean(catalogPhaseA) !== expectedApplied) fail('PHASE_A_STATE_MISMATCH');
  return true;
}

export function safeReleaseLog(event) {
  const allowed = ['timestamp', 'stage', 'result', 'durationMs', 'safeErrorCode', 'hashes', 'counts'];
  return Object.fromEntries(allowed.filter((key) => event[key] !== undefined).map((key) => [key, stable(event[key])]));
}
