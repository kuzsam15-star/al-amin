import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  acquireLocalLock, advance, assertInventoryGate, assertObservationGate,
  assertPhaseBGate, assertProjectIdentity, assertUnexpectedPhaseAState,
  createCheckpoint, finish, fingerprintIdentity, readCheckpoint,
  recordBackfillProgress, releaseLocalLock, validateCheckpoint,
  verifyArtifactManifest, writeCheckpoint,
} from '../scripts/release/sec001/lib/release-state.mjs';

const commit = '2861305e2c83725d26ea01a5ca474d19b440a6c5';
const manifestHash = 'A'.repeat(64);
const identity = { projectRef: 'synthetic-local', region: 'local', dbHost: 'db.synthetic-local.local', catalogMarker: 'synthetic-v1', bucketNames: ['avatars', 'profile-media'], apiUrl: 'https://synthetic-local.supabase.co', sourceVersionUrl: 'https://release.example.invalid/version' };
const projectFingerprint = fingerprintIdentity(identity);
const zeroCounts = { changedSecondPass: 0, legacyRemaining: 0, missing: 0, corrupt: 0, conflict: 0, unsupported: 0, blocked: 0 };

function checkpoint() { return createCheckpoint({ sourceCommit: commit, artifactManifestHash: manifestHash, projectFingerprint }); }
function toObservation(cp) {
  for (const state of ['PREFLIGHT_PASSED','PHASE_A_APPLIED','SOURCE_DEPLOY_CONFIRMED','CANARY_PASSED','INVENTORY_REVIEWED','BACKFILL_IN_PROGRESS']) cp = advance(cp, state);
  cp = recordBackfillProgress(cp, { planned: 1, applied: 1, remaining: 0 });
  cp.counters = { ...cp.counters, ...zeroCounts };
  cp = advance(cp, 'BACKFILL_COMPLETE');
  assertObservationGate({ elapsedMinutes: 30, applicationApprovals: 2, revisionApprovals: 1, canonicalizationErrors: 0, mediaServingErrors: 0, securityErrors: 0, unresolvedAlerts: 0 });
  return advance(cp, 'OBSERVATION_PASSED');
}

test('SEC-001 release state machine completes two independent deterministic rehearsals', async () => {
  const classifications = [];
  for (let run = 1; run <= 2; run += 1) {
    const root = await mkdtemp(join(tmpdir(), `sec001-release-unit-${run}-`));
    try {
      const checkpointPath = join(root, 'checkpoint.json');
      const lockPath = join(root, 'release.lock');
      const sessionId = `run-${run}`;
      await acquireLocalLock(lockPath, { owner: 'synthetic', sessionId });
      let cp = toObservation(checkpoint());
      assertPhaseBGate(cp, zeroCounts, 'APPLY PHASE B');
      cp = advance(cp, 'PHASE_B_APPLIED');
      cp = advance(cp, 'POST_VERIFY_PASSED');
      cp = finish(cp);
      await writeCheckpoint(checkpointPath, cp, process.cwd());
      const restored = await readCheckpoint(checkpointPath, process.cwd());
      assert.equal(restored.state, 'COMPLETE');
      classifications.push(restored.history.map((entry) => entry.state));
      await releaseLocalLock(lockPath, sessionId);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  assert.deepEqual(classifications[1], classifications[0]);
});

test('the frozen SEC-001 release bundle fails closed on the exact reviewed pre-launch source drift', async () => {
  const manifestPath = 'docs/security/SEC-001_RELEASE_ARTIFACT_MANIFEST.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.artifacts.length, 42);
  const mismatches = [];
  for (const artifact of manifest.artifacts) {
    let bytes = await readFile(artifact.path);
    if (artifact.canonicalTextEol === 'LF') {
      bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n?/gu, '\n'), 'utf8');
    }
    const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    if (actual !== artifact.sha256) mismatches.push(artifact.id);
  }
  assert.deepEqual(mismatches.sort(), [
    'admin-actions',
    'admin-page',
    'deployment-runbook',
    'media-source-route',
    'media-upload-route',
    'media-view-route',
    'published-media',
    'state-machine',
  ]);
  await assert.rejects(
    verifyArtifactManifest(process.cwd(), manifestPath),
    /ARTIFACT_HASH_MISMATCH_/u,
  );
});

test('SEC-001 release failure injections fail closed', async (t) => {
  await t.test('wrong project fingerprint', () => assert.throws(() => assertProjectIdentity('F'.repeat(64), identity), /PROJECT_IDENTITY_MISMATCH/u));
  await t.test('source commit mismatch', () => assert.throws(() => validateCheckpoint(checkpoint(), { sourceCommit: '0'.repeat(40) }), /SOURCE_COMMIT_MISMATCH/u));
  await t.test('Phase A already applied unexpectedly', () => assert.throws(() => assertUnexpectedPhaseAState({ checkpointState: 'PREFLIGHT_PASSED', catalogPhaseA: true }), /PHASE_A_STATE_MISMATCH/u));
  await t.test('backfill missing object', () => assert.throws(() => assertInventoryGate({ missing: 1, corrupt: 0, conflict: 0, unsupported: 0, blocked: 0 }), /INVENTORY_MISSING_NONZERO/u));
  await t.test('backfill conflict', () => assert.throws(() => assertInventoryGate({ missing: 0, corrupt: 0, conflict: 1, unsupported: 0, blocked: 0 }), /INVENTORY_CONFLICT_NONZERO/u));
  await t.test('interrupted batch remains resumable', () => {
    let cp = checkpoint();
    for (const state of ['PREFLIGHT_PASSED','PHASE_A_APPLIED','SOURCE_DEPLOY_CONFIRMED','CANARY_PASSED','INVENTORY_REVIEWED','BACKFILL_IN_PROGRESS']) cp = advance(cp, state);
    cp = recordBackfillProgress(cp, { planned: 11, applied: 1, remaining: 10 });
    assert.equal(cp.state, 'BACKFILL_IN_PROGRESS'); assert.equal(cp.counters.remaining, 10);
  });
  await t.test('Phase B attempted early', () => assert.throws(() => assertPhaseBGate(checkpoint(), zeroCounts, 'APPLY PHASE B'), /PHASE_B_ATTEMPTED_EARLY/u));
  await t.test('Phase B weak confirmation', () => assert.throws(() => assertPhaseBGate(toObservation(checkpoint()), zeroCounts, 'yes'), /PHASE_B_EXPLICIT_CONFIRMATION_REQUIRED/u));
  await t.test('stale checkpoint', () => {
    const cp = checkpoint(); cp.updatedAt = '2020-01-01T00:00:00.000Z';
    assert.throws(() => validateCheckpoint(cp, {}, { now: new Date('2026-08-13T00:00:00Z') }), /STALE_CHECKPOINT_REVIEW_REQUIRED/u);
  });
  await t.test('stale lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sec001-stale-lock-'));
    try {
      const path = join(root, 'release.lock');
      await writeFile(path, JSON.stringify({ sessionId: 'old', expiresAt: '2020-01-01T00:00:00Z' }));
      await assert.rejects(acquireLocalLock(path, { owner: 'new', sessionId: 'new', now: new Date('2026-08-13T00:00:00Z') }), /STALE_LOCK_REVIEW_REQUIRED/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  await t.test('wrong artifact hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sec001-artifact-'));
    try {
      await writeFile(join(root, 'artifact.txt'), 'safe');
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ artifacts: [{ id: 'x', path: 'artifact.txt', sha256: '0'.repeat(64) }] }));
      await assert.rejects(verifyArtifactManifest(root, 'manifest.json'), /ARTIFACT_HASH_MISMATCH_x/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
