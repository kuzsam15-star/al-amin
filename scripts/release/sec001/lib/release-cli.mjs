import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  abortSafe, advance, assertInventoryGate, assertObservationGate, assertPhaseBGate,
  createCheckpoint, failSafe, finish, readCheckpoint, validateCheckpoint,
  rebindFrozenBundle, recordLegacyContractForwardFix, verifyArtifactManifest, writeCheckpoint,
} from './release-state.mjs';

function args(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) parsed[argv[index].replace(/^--/u, '')] = argv[index + 1];
  return parsed;
}

const options = args(process.argv.slice(2));
const repoRoot = resolve(options.repo ?? process.cwd());
const checkpointPath = options.checkpoint;
const action = options.action;

async function evidence() { return options.evidence ? JSON.parse(await readFile(options.evidence, 'utf8')) : {}; }
async function fileSha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex').toUpperCase();
}

try {
  if (action === 'init') {
    const verified = await verifyArtifactManifest(repoRoot, options.manifest);
    const checkpoint = createCheckpoint({
      sourceCommit: options.commit,
      artifactManifestHash: verified.manifestHash,
      projectFingerprint: options.fingerprint,
    });
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
    process.stdout.write(JSON.stringify({ status: 'PASS', state: checkpoint.state, releaseId: checkpoint.releaseId }));
  } else {
    let checkpoint = await readCheckpoint(checkpointPath, repoRoot);
    validateCheckpoint(checkpoint, {});
    const data = await evidence();
    if (action === 'rebind-bundle') {
      const verified = await verifyArtifactManifest(repoRoot, options.manifest);
      const previousHash = await fileSha256(resolve(repoRoot, options['previous-manifest']));
      const sourceCommit = String(options.commit ?? '').toLowerCase();
      if (checkpoint.artifactManifestHash === verified.manifestHash
          && checkpoint.sourceCommit === sourceCommit) {
        process.stdout.write(JSON.stringify({ status: 'PASS', state: checkpoint.state, releaseId: checkpoint.releaseId }));
        process.exit(0);
      }
      checkpoint = rebindFrozenBundle(checkpoint, {
        previousArtifactManifestHash: previousHash,
        artifactManifestHash: verified.manifestHash,
        sourceCommit,
      });
    } else if (action === 'record-legacy-contract-forward-fix') {
      checkpoint = recordLegacyContractForwardFix(checkpoint);
    } else if (action === 'gate-phase-b') {
      assertPhaseBGate(checkpoint, data.counts, data.confirmation);
      process.stdout.write(JSON.stringify({ status: 'PASS', state: checkpoint.state, releaseId: checkpoint.releaseId }));
      process.exit(0);
    } else if (action === 'advance') {
      if (options.state === 'INVENTORY_REVIEWED') assertInventoryGate(data.counts);
      if (options.state === 'OBSERVATION_PASSED') assertObservationGate(data.metrics);
      if (options.state === 'PHASE_B_APPLIED') assertPhaseBGate(checkpoint, data.counts, data.confirmation);
      checkpoint = advance(checkpoint, options.state, { evidence: data });
    } else if (action === 'finish') checkpoint = finish(checkpoint);
    else if (action === 'abort') checkpoint = abortSafe(checkpoint, options.code ?? 'OWNER_ABORT');
    else if (action === 'fail') checkpoint = failSafe(checkpoint, options.code ?? 'FAILED_SAFE');
    else throw new Error('UNKNOWN_RELEASE_ACTION');
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
    process.stdout.write(JSON.stringify({ status: 'PASS', state: checkpoint.state, releaseId: checkpoint.releaseId }));
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'FAILED_SAFE', safeErrorCode: error.message }));
  process.exitCode = 1;
}
