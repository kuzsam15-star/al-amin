import { assertResourceRuntimeConfigured, RESOURCE_LIMITS } from './resource-limits.mjs';

export const MEDIA_CLEANUP_SAFE_CODES = Object.freeze({
  storageDeleteFailed: 'storage_delete_failed',
  acknowledgementFailed: 'acknowledgement_failed',
  unknownFailure: 'unknown_provider_failure',
});

function assertWorkerInput(workerId, limit) {
  if (typeof workerId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(workerId)) throw new Error('cleanup worker identity is invalid');
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error('cleanup batch limit is invalid');
}

export async function processMediaCleanupBatch({ supabase, workerId, limit = RESOURCE_LIMITS.mediaWorkerBatchSize, failureHook }) {
  assertResourceRuntimeConfigured();
  if (limit > RESOURCE_LIMITS.mediaWorkerBatchSize) throw new Error('cleanup configured batch limit exceeded');
  assertWorkerInput(workerId, limit);
  await failureHook?.('before-claim', null);
  const claimed = await supabase.rpc('claim_media_cleanup_jobs_v1', {
    p_limit: limit, p_worker_id: workerId, p_lease_seconds: 120,
  });
  if (claimed.error) throw new Error('cleanup claim failed');
  const summary = { claimed: claimed.data?.length ?? 0, completed: 0, deferred: 0, failed: 0 };
  for (const job of claimed.data ?? []) {
    try {
      await failureHook?.('after-claim', job.job_id);
      await failureHook?.('before-reference-check', job.job_id);
      const authorized = await supabase.rpc('authorize_media_cleanup_delete_v1', {
        p_job_id: job.job_id, p_worker_id: workerId,
      });
      if (authorized.error || !authorized.data?.[0]) throw new Error('cleanup authorization failed');
      const decision = authorized.data[0];
      await failureHook?.('after-reference-check', job.job_id);
      if (!decision.delete_allowed && !decision.object_missing) { summary.deferred += 1; continue; }
      await failureHook?.('before-storage-delete', job.job_id);
      if (decision.delete_allowed) {
        const removed = await supabase.storage.from(decision.bucket_id).remove([decision.object_path]);
        if (removed.error) {
          await supabase.rpc('fail_media_cleanup_job_v1', {
            p_job_id: job.job_id, p_worker_id: workerId,
            p_safe_error_code: MEDIA_CLEANUP_SAFE_CODES.storageDeleteFailed,
          });
          summary.failed += 1;
          continue;
        }
      }
      await failureHook?.('after-storage-delete', job.job_id);
      await failureHook?.('before-acknowledgement', job.job_id);
      const acknowledged = await supabase.rpc('ack_media_cleanup_job_v1', {
        p_job_id: job.job_id, p_worker_id: workerId,
      });
      if (acknowledged.error || acknowledged.data !== true) throw new Error('cleanup acknowledgement failed');
      await failureHook?.('after-acknowledgement', job.job_id);
      summary.completed += 1;
    } catch (error) {
      if (failureHook && error?.code === 'ALAMIN_SIMULATED_CRASH') throw error;
      await supabase.rpc('fail_media_cleanup_job_v1', {
        p_job_id: job.job_id, p_worker_id: workerId,
        p_safe_error_code: MEDIA_CLEANUP_SAFE_CODES.unknownFailure,
      });
      summary.failed += 1;
    }
  }
  return summary;
}
