import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { processMediaCleanupBatch } from '../../../../src/lib/media-cleanup-worker.mjs';
import { queryLocalSql } from './local-stack.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const quote = (value) => String(value).replaceAll("'", "''");
const scalar = async (stack, toolchain, env, sql) => queryLocalSql(stack, toolchain.dockerBin, env, sql);

async function upload(client, ownerId) {
  const path = `submissions/${ownerId}/avatar/${randomUUID()}.webp`;
  const bytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#246853' } }).webp().toBuffer();
  const result = await client.storage.from('profile-media').upload(path, bytes, { contentType: 'image/webp', upsert: false });
  if (result.error) throw new Error('SEC-006 synthetic upload failed');
  return { path, bytes };
}

async function enqueue(service, ownerId, path, reason = 'owner_unused_submission') {
  return service.rpc('enqueue_media_cleanup_v1', {
    p_owner_id: ownerId, p_object_path: path, p_reason: reason, p_source_operation_id: randomUUID(),
  });
}

async function makeDue(stack, toolchain, env, jobId) {
  await scalar(stack, toolchain, env, `update private.media_cleanup_jobs set not_before=now()-interval '1 second' where id='${quote(jobId)}'::uuid;`);
}

async function jobStatus(stack, toolchain, env, jobId) {
  return scalar(stack, toolchain, env, `select status from private.media_cleanup_jobs where id='${quote(jobId)}'::uuid;`);
}

export async function runP008Cases(recorder, stack, service, users, fixtures, toolchain, env) {
  const probe = await upload(users.userA.client, users.userA.id);
  const directDelete = await users.userA.client.storage.from('profile-media').remove([probe.path]);
  const directBytes = await service.storage.from('profile-media').download(probe.path);
  recorder.record('P008-001', !directBytes.error,
    `direct client cleanup changed zero stored objects${directDelete.error ? ' with an explicit denial' : ''}`);

  const contractCount = Number(await scalar(stack, toolchain, env, `
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('enqueue_media_cleanup_v1','claim_media_cleanup_jobs_v1',
      'authorize_media_cleanup_delete_v1','ack_media_cleanup_job_v1','fail_media_cleanup_job_v1');
  `));
  recorder.record('P008-002', contractCount===5 && (await scalar(stack, toolchain, env, `select to_regclass('private.media_cleanup_jobs') is not null;`))==='t',
    'private ledger and five narrow primitives are present');
  const clientLedger = await users.userA.client.from('media_cleanup_jobs').select('id');
  recorder.record('P008-003', Boolean(clientLedger.error), 'private ledger is outside the client Data API surface');
  const cleanupSource = await readFile(join(repoRoot, 'src', 'lib', 'media-cleanup.ts'), 'utf8');
  recorder.record('P008-004', !cleanupSource.includes('.remove(') && cleanupSource.includes('enqueue_media_cleanup_v1'),
    'request cleanup enqueues only and contains no inline Storage remove');

  const pathValidation = (await scalar(stack, toolchain, env, `select
    private.is_exact_cleanup_submission_path('${quote(users.userA.id)}'::uuid,'${quote(probe.path)}')
    and not private.is_exact_cleanup_submission_path('${quote(users.userA.id)}'::uuid,'')
    and not private.is_exact_cleanup_submission_path('${quote(users.userA.id)}'::uuid,'submissions/${quote(users.userA.id)}/avatar/../x.webp')
    and not private.is_exact_cleanup_submission_path('${quote(users.userA.id)}'::uuid,'submissions/${quote(users.userA.id)}/avatar/%2e%2e.webp')
    and not private.is_exact_cleanup_submission_path('${quote(users.userA.id)}'::uuid,'published/${quote(users.userA.id)}/x.webp');`))==='t';
  recorder.record('P008-005', pathValidation, 'strict exact submission path validator rejected unsafe classes');

  await scalar(stack, toolchain, env, `select private.assert_media_reference_registry_v1();`);
  const registry = Number(await scalar(stack, toolchain, env, `select count(*) from private.media_reference_registry;`))===8;
  const sourceRefs = String(await scalar(stack, toolchain, env, `select active_count+workflow_count+retention_count from private.media_reference_counts_v1('${quote(fixtures.sourcePath)}');`));
  recorder.record('P008-006', registry && Number(sourceRefs)>0, 'authoritative registry and combined reference check are active');
  const workflowRefs = Number(await scalar(stack, toolchain, env, `select workflow_count from private.media_reference_counts_v1('${quote(fixtures.canonicalPath)}');`));
  recorder.record('P008-007', workflowRefs>0, 'revision workflow media is protected regardless of client snapshot state');
  recorder.record('P008-008', Number(sourceRefs)>1, 'multiple independent references protect a shared source');

  const first = await enqueue(service, users.userA.id, probe.path);
  const second = await enqueue(service, users.userA.id, probe.path);
  recorder.record('P008-009', !first.error && !second.error && first.data===second.data, 'exact candidate enqueue replay returned one job');
  const foreign = await enqueue(service, users.userB.id, probe.path);
  const canonical = await enqueue(service, users.userA.id, fixtures.canonicalPath);
  const fixedBucket = (await scalar(stack, toolchain, env, `select pg_get_constraintdef(oid) like '%profile-media%' from pg_constraint where conname='media_cleanup_jobs_bucket_id_check';`))==='t';
  recorder.record('P008-010', Boolean(foreign.error) && Boolean(canonical.error) && fixedBucket,
    'cross-owner, canonical namespace and non-profile-media candidates are outside the contract');

  await makeDue(stack, toolchain, env, first.data);
  const workerA=randomUUID(); const workerB=randomUUID();
  const claims=await Promise.all([
    service.rpc('claim_media_cleanup_jobs_v1',{p_limit:1,p_worker_id:workerA,p_lease_seconds:120}),
    service.rpc('claim_media_cleanup_jobs_v1',{p_limit:1,p_worker_id:workerB,p_lease_seconds:120}),
  ]);
  const claimedRows=claims.flatMap((entry)=>entry.data??[]);
  const leaseWorker=claims[0].data?.length ? workerA : workerB;
  await scalar(stack,toolchain,env,`update private.media_cleanup_jobs set lease_until=now()-interval '1 second' where id='${quote(first.data)}'::uuid and worker_id='${quote(leaseWorker)}'::uuid;`);
  const recoveryWorker=randomUUID();
  const recovered=await service.rpc('claim_media_cleanup_jobs_v1',{p_limit:1,p_worker_id:recoveryWorker,p_lease_seconds:120});
  recorder.record('P008-011', claims.every((entry)=>!entry.error) && claimedRows.length===1 && claimedRows[0].job_id===first.data
    && !recovered.error && recovered.data?.length===1 && recovered.data[0].job_id===first.data,
    'parallel workers produced one lease owner and an expired lease was recovered once');
  await service.rpc('fail_media_cleanup_job_v1',{p_job_id:first.data,p_worker_id:recoveryWorker,p_safe_error_code:'synthetic_retry'});

  const stale=await upload(users.userA.client,users.userA.id); const staleJob=await enqueue(service,users.userA.id,stale.path);
  await makeDue(stack,toolchain,env,staleJob.data);
  const originalGallery=await service.from('applications').select('gallery_paths').eq('id',fixtures.ids.appA).single();
  const linked=[...(originalGallery.data?.gallery_paths??[]),stale.path];
  await service.from('applications').update({gallery_paths:linked}).eq('id',fixtures.ids.appA);
  const staleWorker=randomUUID(); await service.rpc('claim_media_cleanup_jobs_v1',{p_limit:1,p_worker_id:staleWorker,p_lease_seconds:120});
  const staleDecision=await service.rpc('authorize_media_cleanup_delete_v1',{p_job_id:staleJob.data,p_worker_id:staleWorker});
  const staleBytes=await service.storage.from('profile-media').download(stale.path);
  recorder.record('P008-012', !staleDecision.error && staleDecision.data?.[0]?.safe_code==='referenced' && !staleBytes.error,
    'reference added after enqueue cancelled deletion');
  await service.from('applications').update({gallery_paths:originalGallery.data?.gallery_paths??[]}).eq('id',fixtures.ids.appA);

  const failed=await upload(users.userA.client,users.userA.id); const failedJob=await enqueue(service,users.userA.id,failed.path);
  await makeDue(stack,toolchain,env,failedJob.data); const failureWorker=randomUUID();
  await service.rpc('claim_media_cleanup_jobs_v1',{p_limit:1,p_worker_id:failureWorker,p_lease_seconds:120});
  const failedAuth=await service.rpc('authorize_media_cleanup_delete_v1',{p_job_id:failedJob.data,p_worker_id:failureWorker});
  const failedState=await service.rpc('fail_media_cleanup_job_v1',{p_job_id:failedJob.data,p_worker_id:failureWorker,p_safe_error_code:'storage_delete_failed'});
  const failedBytes=await service.storage.from('profile-media').download(failed.path);
  const mismatch=await upload(users.userA.client,users.userA.id); const mismatchJob=await enqueue(service,users.userA.id,mismatch.path);
  await scalar(stack,toolchain,env,`update private.media_cleanup_jobs set expected_size=coalesce(expected_size,0)+1,not_before=now()-interval '1 second' where id='${quote(mismatchJob.data)}'::uuid;`);
  const mismatchWorker=randomUUID(); await service.rpc('claim_media_cleanup_jobs_v1',{p_limit:1,p_worker_id:mismatchWorker,p_lease_seconds:120});
  const mismatchDecision=await service.rpc('authorize_media_cleanup_delete_v1',{p_job_id:mismatchJob.data,p_worker_id:mismatchWorker});
  const mismatchBytes=await service.storage.from('profile-media').download(mismatch.path);
  const bounded=await upload(users.userA.client,users.userA.id); const boundedJob=await enqueue(service,users.userA.id,bounded.path);
  await scalar(stack,toolchain,env,`update private.media_cleanup_jobs set attempt_count=4,not_before=now()-interval '1 second' where id='${quote(boundedJob.data)}'::uuid;`);
  const boundedWorker=randomUUID(); await service.rpc('claim_media_cleanup_jobs_v1',{p_limit:1,p_worker_id:boundedWorker,p_lease_seconds:120});
  await service.rpc('authorize_media_cleanup_delete_v1',{p_job_id:boundedJob.data,p_worker_id:boundedWorker});
  const boundedState=await service.rpc('fail_media_cleanup_job_v1',{p_job_id:boundedJob.data,p_worker_id:boundedWorker,p_safe_error_code:'unknown_provider_failure'});
  recorder.record('P008-013', !failedAuth.error && failedAuth.data?.[0]?.delete_allowed===true && failedState.data==='pending' && !failedBytes.error
    && !mismatchDecision.error && mismatchDecision.data?.[0]?.safe_code==='object_identity_mismatch' && !mismatchBytes.error
    && boundedState.data==='manual_review',
    'provider failure remained retryable, metadata mismatch stopped deletion and max attempts reached manual review');

  const missing=await upload(users.userA.client,users.userA.id); const missingJob=await enqueue(service,users.userA.id,missing.path);
  await makeDue(stack,toolchain,env,missingJob.data); const missingWorker=randomUUID();
  await service.rpc('claim_media_cleanup_jobs_v1',{p_limit:1,p_worker_id:missingWorker,p_lease_seconds:120});
  await service.rpc('authorize_media_cleanup_delete_v1',{p_job_id:missingJob.data,p_worker_id:missingWorker});
  await service.storage.from('profile-media').remove([missing.path]);
  const missingAck=await service.rpc('ack_media_cleanup_job_v1',{p_job_id:missingJob.data,p_worker_id:missingWorker});
  recorder.record('P008-014', !missingAck.error && missingAck.data===true && (await jobStatus(stack,toolchain,env,missingJob.data))==='completed',
    'verified exact-object absence acknowledged idempotently');

  const retention=Number(await scalar(stack,toolchain,env,`select retention_count from private.media_reference_counts_v1('${quote(fixtures.sourcePath)}');`));
  const canonicalRetention=Number(await scalar(stack,toolchain,env,`select retention_count from private.media_reference_counts_v1('${quote(fixtures.canonicalPath)}');`));
  recorder.record('P008-015', retention>0 && canonicalRetention>0, 'SEC-001 sources and canonical provenance remain retention protected');

  let futureBlocked=true;
  try {
    await scalar(stack,toolchain,env,`begin; alter table public.applications add column future_media_path text; do $block$ begin
      begin perform private.assert_media_reference_registry_v1(); raise exception 'registry allowed future field';
      exception when sqlstate '55000' then null; end;
    end $block$; rollback;`);
  } catch { futureBlocked=false; }
  recorder.record('P008-016', futureBlocked, 'unregistered future media field caused the registry gate to fail closed');

  const secureFunctions=Number(await scalar(stack,toolchain,env,`
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('enqueue_media_cleanup_v1','claim_media_cleanup_jobs_v1','authorize_media_cleanup_delete_v1','ack_media_cleanup_job_v1','fail_media_cleanup_job_v1')
      and p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=pg_catalog%'
      and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE');
  `));
  recorder.record('P008-017',secureFunctions===5,'all cleanup primitives are fixed-path service-only functions');

  await makeDue(stack,toolchain,env,failedJob.data);
  const run=await processMediaCleanupBatch({supabase:service,workerId:randomUUID(),limit:10});
  const replay=await processMediaCleanupBatch({supabase:service,workerId:randomUUID(),limit:10});
  const finalBytes=await service.storage.from('profile-media').download(failed.path);
  recorder.record('P008-018',run.completed>=1 && replay.claimed===0 && finalBytes.error && (await jobStatus(stack,toolchain,env,failedJob.data))==='completed',
    'trusted worker deleted one exact object, acknowledged it and replayed safely');
}
