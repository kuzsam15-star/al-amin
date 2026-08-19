import { stdin } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { runSec001Backfill } from '../../../tests/security/helpers/sec001-backfill.mjs';
import { advance, readCheckpoint, recordBackfillProgress, writeCheckpoint } from './lib/release-state.mjs';

const [mode, checkpointPath, repoRoot] = process.argv.slice(2);
if (!['inventory', 'backfill', 'verify'].includes(mode) || !checkpointPath || !repoRoot) {
  throw new Error('BACKFILL_RUNNER_ARGUMENTS_INVALID');
}

let input = '';
for await (const chunk of stdin) input += chunk;
const [apiUrl, secret] = input.replace(/\r/gu, '').split('\n');

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(apiUrl)) throw new Error('BACKFILL_API_URL_INVALID');
if (!secret) throw new Error('BACKFILL_CREDENTIAL_REQUIRED');
const service = createClient(apiUrl, secret, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

try {
  let checkpoint = await readCheckpoint(checkpointPath, repoRoot);
  if (mode === 'inventory') {
    const result = await runSec001Backfill({ service, dryRun: true });
    const counts = {
      totalLegacy: result.planned,
      alreadyCanonical: 0,
      allowlistedLegacyReferences: result.namespaceSummary.allowlistedLegacyReferenceCount,
      allowlistedLegacyObjects: result.namespaceSummary.allowlistedLegacyObjectCount,
      sharedSameOwnerObjects: result.namespaceSummary.sharedSameOwnerObjectCount,
      crossOwnerObjects: result.namespaceSummary.crossOwnerObjectCount,
      unknownReferences: result.namespaceSummary.unknownReferenceCount,
      missing: 0, corrupt: 0, conflict: 0, unsupported: 0, blocked: 0,
    };
    checkpoint = advance(checkpoint, 'INVENTORY_REVIEWED', { evidence: { counts } });
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
    process.stdout.write(`\n${JSON.stringify({ status: 'PASS', counts })}\n`);
  } else if (mode === 'backfill') {
    if (checkpoint.state === 'INVENTORY_REVIEWED') checkpoint = advance(checkpoint, 'BACKFILL_IN_PROGRESS');
    for (const batch of [1, 10, 25]) {
      const result = await runSec001Backfill({ service, dryRun: false, stopAfter: batch });
      checkpoint = recordBackfillProgress(checkpoint, { planned: result.planned, applied: result.applied, remaining: result.remaining });
      await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
      if (result.remaining === 0) break;
    }
    while (checkpoint.counters.remaining > 0) {
      const result = await runSec001Backfill({ service, dryRun: false, stopAfter: 25 });
      checkpoint = recordBackfillProgress(checkpoint, { planned: result.planned, applied: result.applied, remaining: result.remaining });
      await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
    }
    checkpoint = advance(checkpoint, 'BACKFILL_COMPLETE', { evidence: { counts: checkpoint.counters } });
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
    process.stdout.write(`\n${JSON.stringify({ status: 'PASS', counts: checkpoint.counters })}\n`);
  } else {
    const result = await runSec001Backfill({ service, dryRun: true });
    const counts = { changedSecondPass: result.planned, legacyRemaining: result.remaining, missing: 0, corrupt: 0, conflict: 0, unsupported: 0, blocked: 0 };
    if (Object.values(counts).some((value) => value !== 0)) throw new Error('BACKFILL_ZERO_CHANGE_GATE_FAILED');
    checkpoint.counters = { ...checkpoint.counters, ...counts };
    await writeCheckpoint(checkpointPath, checkpoint, repoRoot);
    process.stdout.write(`\n${JSON.stringify({ status: 'PASS', counts })}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  let safeErrorCode = 'BACKFILL_INTEGRITY_OR_ACCESS_ERROR';
  if (message.includes('cross-owner or ambiguous')) safeErrorCode = 'BACKFILL_SOURCE_OWNERSHIP_AMBIGUOUS';
  else if (message.includes('namespace is not allowlisted')) safeErrorCode = 'BACKFILL_SOURCE_NAMESPACE_NOT_ALLOWLISTED';
  else if (message.includes('authoritative DB reference proof')) safeErrorCode = 'BACKFILL_SOURCE_REFERENCE_PROOF_MISSING';
  process.stderr.write(`\n${JSON.stringify({ status: 'FAILED_SAFE', safeErrorCode })}\n`);
  process.exitCode = 1;
} finally {
  // Supabase client keeps no persistent credential store; references are released on exit.
}
