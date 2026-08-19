import { createHash, randomUUID } from 'node:crypto';
import { queryLocalSql } from './local-stack.mjs';

const quote = (value) => String(value).replaceAll("'", "''");

function applicationRow(ownerId, categoryId, label) {
  return {
    id: randomUUID(),
    owner_id: ownerId,
    contract_version: 2,
    full_name: `Synthetic ${label}`,
    contact: 'p007-fixture@example.invalid',
    country: 'Synthetic Country',
    city: 'Synthetic City',
    category_text: 'Synthetic Category',
    category_id: categoryId,
    additional_category_ids: [],
    specialization: 'Synthetic atomic workflow',
    experience_years: 5,
    profile_summary: 'Synthetic atomic workflow summary',
    description: 'Synthetic local-only application description long enough to satisfy the verified contract.',
    help_topics: [{ title: 'Synthetic help', description: 'Synthetic local-only help description.' }],
    work_offers: [{ title: 'Synthetic offer', mode: 'online' }],
    services: 'Synthetic offer',
    main_image_path: `submissions/${ownerId}/avatar/${randomUUID()}.webp`,
    consent_truthful: true,
    consent_personal_data: true,
    status: 'new',
  };
}

function submissionPayload(row) {
  return Object.fromEntries([
    'contract_version', 'full_name', 'contact', 'country', 'city', 'category_text',
    'category_id', 'additional_category_ids', 'specialization', 'experience_years',
    'profile_summary', 'description', 'help_topics', 'work_offers', 'services',
    'main_image_path', 'consent_truthful', 'consent_personal_data',
  ].map((key) => [key, row[key]]));
}

const payloadHash = (payload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

async function scalar(stack, toolchain, env, sql) {
  return await queryLocalSql(stack, toolchain.dockerBin, env, sql);
}

async function countByOperation(stack, toolchain, env, table, operationId) {
  return Number(await scalar(stack, toolchain, env,
    `select count(*) from ${table} where operation_id='${quote(operationId)}'::uuid;`));
}

async function uploadSubmission(service, row, bytes) {
  const uploaded = await service.storage.from('profile-media').upload(row.main_image_path, bytes, {
    contentType: 'image/webp', upsert: false,
  });
  if (uploaded.error) throw new Error('P0-07 synthetic submission media setup failed');
  const registered = await service.rpc('register_submission_media_v1', {
    p_owner_id: row.owner_id,
    p_object_path: row.main_image_path,
    p_sha256: createHash('sha256').update(bytes).digest('hex'),
    p_byte_count: bytes.byteLength,
  });
  if (registered.error || registered.data !== true) throw new Error('P0-07 synthetic submission media registration failed');
}

async function contractAvailable(stack, toolchain, env) {
  return Number(await scalar(stack, toolchain, env, `
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'submit_application_v1','moderator_decide_application_v2',
      'moderator_decide_revision_v2','claim_email_notifications_v2',
      'ack_email_notification_v2','approve_application_with_canonical_media_v3',
      'apply_specialist_revision_with_canonical_media_v3'
    );
  `)) === 7;
}

async function recordBeforeState(recorder, service, users, fixtures) {
  const direct = applicationRow(users.submitter.id, fixtures.ids.category, 'P007 direct client');
  await uploadSubmission(service, direct, fixtures.mediaBytes);
  const directAttempt = await users.submitter.client.from('applications').insert(direct);
  recorder.record('P007-001', Boolean(directAttempt.error), 'direct authenticated application INSERT boundary evaluated');
  if (!directAttempt.error) await service.from('applications').update({ status: 'rejected' }).eq('id', direct.id);

  const left = applicationRow(users.submitter.id, fixtures.ids.category, 'P007 concurrent left');
  const right = applicationRow(users.submitter.id, fixtures.ids.category, 'P007 concurrent right');
  await uploadSubmission(service, left, fixtures.mediaBytes);
  await uploadSubmission(service, right, fixtures.mediaBytes);
  const attempts = await Promise.all([
    service.from('applications').insert(left),
    service.from('applications').insert(right),
  ]);
  const ids = [left.id, right.id];
  const { count } = await service.from('applications').select('id', { count: 'exact', head: true }).in('id', ids);
  recorder.record('P007-002', attempts.filter((entry) => !entry.error).length === 1 && count === 1, 'concurrent direct backend inserts were bounded by the active-owner invariant');
  const cleanup = await service.from('applications').update({ status: 'rejected' }).in('id', ids);
  if (cleanup.error) {
    throw new Error(`P0-07 synthetic active-application fixture cleanup failed: ${cleanup.error.code ?? 'unknown'} ${cleanup.error.message ?? 'unknown'}`);
  }
}

function recordUnavailable(recorder) {
  for (const id of [
    'P007-003','P007-004','P007-005','P007-006','P007-007','P007-008',
    'P007-009','P007-010','P007-011','P007-012','P007-013','P007-014',
    'P007-015','P007-016',
  ]) recorder.record(id, false, 'pre-fix atomic workflow contract is absent');
}

export async function runP007Cases(recorder, stack, service, users, fixtures, toolchain, env) {
  await recordBeforeState(recorder, service, users, fixtures);
  if (!(await contractAvailable(stack, toolchain, env))) {
    recordUnavailable(recorder);
    return;
  }

  const submitted = applicationRow(users.submitter.id, fixtures.ids.category, 'P007 submitted');
  await uploadSubmission(service, submitted, fixtures.mediaBytes);
  const payload = submissionPayload(submitted);
  const key = randomUUID();
  const operation = await service.rpc('submit_application_v1', {
    p_owner_id: users.submitter.id,
    p_application_id: null,
    p_idempotency_key: key,
    p_payload_hash: payloadHash(payload),
    p_payload: payload,
  });
  const applicationId = operation.data?.application_id;
  const operationId = operation.data?.operation_id;
  if (operation.error || !applicationId || !operationId) {
    throw new Error(`P0-07 synthetic submit primitive failed: ${operation.error?.code ?? 'missing-result'} ${operation.error?.message ?? 'missing result'}`);
  }

  const replay = await service.rpc('submit_application_v1', {
    p_owner_id: users.submitter.id,
    p_application_id: null,
    p_idempotency_key: key,
    p_payload_hash: payloadHash(payload),
    p_payload: payload,
  });
  recorder.record('P007-003', !replay.error && replay.data?.application_id === applicationId && replay.data?.replayed === true,
    'same application idempotency key returned the committed result');

  const changedPayload = { ...payload, city: 'Synthetic Changed City' };
  const conflictingReplay = await service.rpc('submit_application_v1', {
    p_owner_id: users.submitter.id,
    p_application_id: null,
    p_idempotency_key: key,
    p_payload_hash: payloadHash(changedPayload),
    p_payload: changedPayload,
  });
  recorder.record('P007-004', Boolean(conflictingReplay.error), 'same key with a different payload was rejected');

  const futurePayload = { ...payload, future_protected_field: 'must-not-write' };
  const futureAttempt = await service.rpc('submit_application_v1', {
    p_owner_id: users.p007Failure.id,
    p_application_id: null,
    p_idempotency_key: randomUUID(),
    p_payload_hash: payloadHash(futurePayload),
    p_payload: futurePayload,
  });
  recorder.record('P007-005', Boolean(futureAttempt.error), 'unknown future application field failed closed');

  const submitCounts = await Promise.all([
    countByOperation(stack, toolchain, env, 'private.domain_events', operationId),
    countByOperation(stack, toolchain, env, 'public.application_events', operationId),
    countByOperation(stack, toolchain, env, 'public.audit_log', operationId),
    countByOperation(stack, toolchain, env, 'public.email_notifications', operationId),
  ]);
  const submitActor = Number(await scalar(stack, toolchain, env, `
    select count(*) from private.domain_events
    where operation_id='${quote(operationId)}'::uuid
      and actor_id='${quote(users.submitter.id)}'::uuid and actor_role='owner';
  `));
  recorder.record('P007-006', submitCounts.every((count) => count === 1) && submitActor === 1,
    'application row, domain event, owner event, audit and outbox share one operation');

  const failureRow = applicationRow(users.p007Failure.id, fixtures.ids.category, 'P007 failure');
  await uploadSubmission(service, failureRow, fixtures.mediaBytes);
  const failurePayload = submissionPayload(failureRow);
  const submitFailureStages = ['after_validation','after_state','after_event','after_outbox','after_domain_event','after_audit'];
  const submitFailures = [];
  for (const stage of submitFailureStages) {
    try {
      await scalar(stack, toolchain, env, `
        begin;
        set local role service_role;
        set local app.p007_test_mode='on';
        set local app.p007_test_fail_stage='${stage}';
        select public.submit_application_v1(
          '${quote(users.p007Failure.id)}'::uuid, null, '${randomUUID()}'::uuid,
          '${payloadHash(failurePayload)}', '${quote(JSON.stringify(failurePayload))}'::jsonb
        );
        commit;
      `);
      submitFailures.push(false);
    } catch { submitFailures.push(true); }
  }
  const failureRows = Number(await scalar(stack, toolchain, env,
    `select count(*) from public.applications where owner_id='${quote(users.p007Failure.id)}'::uuid;`));
  const failureArtifacts = Number(await scalar(stack, toolchain, env, `
    select (select count(*) from private.domain_events where actor_id='${quote(users.p007Failure.id)}'::uuid)
      + (select count(*) from public.audit_log where actor_id='${quote(users.p007Failure.id)}'::uuid);
  `));
  if (!submitFailures.every(Boolean)) {
    throw new Error(`P0-07 submit failure hook did not fire: ${submitFailureStages.filter((_, index) => !submitFailures[index]).join(',')}`);
  }
  recorder.record('P007-007', submitFailures.every(Boolean) && failureRows === 0 && failureArtifacts === 0,
    'faults at every submission stage rolled back state, domain event, audit and outbox');

  const decisionRow = applicationRow(users.p007Decision.id, fixtures.ids.category, 'P007 decision');
  await uploadSubmission(service, decisionRow, fixtures.mediaBytes);
  await service.from('applications').insert(decisionRow);
  const decisionState = await service.from('applications').select('workflow_version,status').eq('id', decisionRow.id).single();
  const decisionOperation = randomUUID();
  const decision = await users.moderator.client.rpc('moderator_decide_application_v2', {
    p_application_id: decisionRow.id,
    p_expected_version: decisionState.data?.workflow_version,
    p_expected_status: decisionState.data?.status,
    p_decision: 'reject',
    p_operation_id: decisionOperation,
    p_internal_note: 'Synthetic atomic rejection',
    p_applicant_message: null,
  });
  const decisionReplay = await users.moderator.client.rpc('moderator_decide_application_v2', {
    p_application_id: decisionRow.id,
    p_expected_version: decisionState.data?.workflow_version,
    p_expected_status: decisionState.data?.status,
    p_decision: 'reject',
    p_operation_id: decisionOperation,
    p_internal_note: 'Synthetic atomic rejection',
    p_applicant_message: null,
  });
  const decisionCounts = await Promise.all([
    countByOperation(stack, toolchain, env, 'private.domain_events', decisionOperation),
    countByOperation(stack, toolchain, env, 'public.application_events', decisionOperation),
    countByOperation(stack, toolchain, env, 'public.audit_log', decisionOperation),
    countByOperation(stack, toolchain, env, 'public.email_notifications', decisionOperation),
  ]);
  recorder.record('P007-008', !decision.error && !decisionReplay.error && decisionReplay.data?.replayed === true
    && decisionCounts.every((count) => count === 1), 'application decision replay preserved one atomic side-effect set');

  const raceRow = applicationRow(users.p007Race.id, fixtures.ids.category, 'P007 decision race');
  await uploadSubmission(service, raceRow, fixtures.mediaBytes);
  await service.from('applications').insert(raceRow);
  const raceState = await service.from('applications').select('workflow_version,status').eq('id', raceRow.id).single();
  const raceOperations = [randomUUID(), randomUUID()];
  const race = await Promise.all([
    users.moderator.client.rpc('moderator_decide_application_v2', {
      p_application_id: raceRow.id, p_expected_version: raceState.data?.workflow_version,
      p_expected_status: raceState.data?.status, p_decision: 'request_changes',
      p_operation_id: raceOperations[0], p_internal_note: null,
      p_applicant_message: 'Synthetic request for changes',
    }),
    users.moderator.client.rpc('moderator_decide_application_v2', {
      p_application_id: raceRow.id, p_expected_version: raceState.data?.workflow_version,
      p_expected_status: raceState.data?.status, p_decision: 'reject',
      p_operation_id: raceOperations[1], p_internal_note: null, p_applicant_message: null,
    }),
  ]);
  const winningOperation = race[race[0].error ? 1 : 0].data?.operation_id;
  const raceSideEffects = winningOperation ? await Promise.all([
    countByOperation(stack, toolchain, env, 'private.domain_events', winningOperation),
    countByOperation(stack, toolchain, env, 'public.audit_log', winningOperation),
    countByOperation(stack, toolchain, env, 'public.email_notifications', winningOperation),
  ]) : [];
  recorder.record('P007-009', race.filter((entry) => !entry.error).length === 1
    && raceSideEffects.length === 3 && raceSideEffects.every((count) => count === 1),
    'conflicting application decisions produced one winner and one side-effect set');

  const revisionOperation = randomUUID();
  const revisionState = await service.from('specialist_revisions').select('updated_at,status').eq('id', fixtures.ids.revisionB).single();
  const revision = await users.moderator.client.rpc('moderator_decide_revision_v2', {
    p_revision_id: fixtures.ids.revisionB,
    p_expected_updated_at: revisionState.data?.updated_at,
    p_expected_status: revisionState.data?.status,
    p_decision: 'reject',
    p_operation_id: revisionOperation,
    p_note: 'Synthetic revision rejection',
  });
  const revisionReplay = await users.moderator.client.rpc('moderator_decide_revision_v2', {
    p_revision_id: fixtures.ids.revisionB,
    p_expected_updated_at: revisionState.data?.updated_at,
    p_expected_status: revisionState.data?.status,
    p_decision: 'reject',
    p_operation_id: revisionOperation,
    p_note: 'Synthetic revision rejection',
  });
  const revisionCounts = await Promise.all([
    countByOperation(stack, toolchain, env, 'private.domain_events', revisionOperation),
    countByOperation(stack, toolchain, env, 'public.audit_log', revisionOperation),
    countByOperation(stack, toolchain, env, 'public.email_notifications', revisionOperation),
  ]);
  recorder.record('P007-010', !revision.error && !revisionReplay.error && revisionReplay.data?.replayed === true
    && revisionCounts.every((count) => count === 1), 'revision decision replay preserved one atomic side-effect set');

  const failureDecisionRow = applicationRow(users.p007Failure.id, fixtures.ids.category, 'P007 decision failure');
  await uploadSubmission(service, failureDecisionRow, fixtures.mediaBytes);
  await service.from('applications').insert(failureDecisionRow);
  const decisionFailureStages = ['after_state','after_event','after_outbox','after_audit','after_domain_event'];
  const decisionFailures = [];
  const decisionFailureOperations = [];
  for (const stage of decisionFailureStages) {
    const operationId = randomUUID();
    decisionFailureOperations.push(operationId);
    try {
      await scalar(stack, toolchain, env, `
        begin;
        set local app.p007_test_mode='on';
        set local app.p007_test_fail_stage='${stage}';
        set local request.jwt.claims='{"sub":"${quote(users.moderator.id)}","role":"authenticated","aal":"aal1"}';
        set local role authenticated;
        select public.moderator_decide_application_v2(
          '${failureDecisionRow.id}'::uuid, 0, 'new', 'reject',
          '${operationId}'::uuid, null, null
        );
        commit;
      `);
      decisionFailures.push(false);
    } catch { decisionFailures.push(true); }
  }
  const failureDecisionStatus = await service.from('applications').select('status').eq('id', failureDecisionRow.id).single();
  const failureDecisionArtifacts = await Promise.all([
    ...decisionFailureOperations.flatMap((operationId) => [
      countByOperation(stack, toolchain, env, 'private.domain_events', operationId),
      countByOperation(stack, toolchain, env, 'public.audit_log', operationId),
      countByOperation(stack, toolchain, env, 'public.email_notifications', operationId),
    ]),
  ]);
  if (!decisionFailures.every(Boolean)) {
    throw new Error(`P0-07 decision failure hook did not fire: ${decisionFailureStages.filter((_, index) => !decisionFailures[index]).join(',')}`);
  }
  recorder.record('P007-011', decisionFailures.every(Boolean) && failureDecisionStatus.data?.status === 'new'
    && failureDecisionArtifacts.every((count) => count === 0), 'decision faults at every stage rolled back state, event, audit and outbox');

  const queueRows = [0, 1, 2].map((index) => ({
    id: randomUUID(), event_type: 'application_submitted', user_id: users.submitter.id,
    recipient_email: 'queue-fixture@example.invalid', subject: 'Synthetic queue fixture',
    template_data: {}, idempotency_key: `p007-claim-${randomUUID()}`, max_attempts: 3,
  }));
  await service.from('email_notifications').update({
    status: 'sent', sent_at: new Date().toISOString(), claimed_at: null,
    lease_expires_at: null, worker_id: null,
  }).in('status', ['pending','failed','processing']);
  await service.from('email_notifications').insert(queueRows);
  const workerA = randomUUID();
  const workerB = randomUUID();
  const claimed = await Promise.all([
    service.rpc('claim_email_notifications_v2', { p_batch_size: 2, p_worker_id: workerA, p_lease_seconds: 60 }),
    service.rpc('claim_email_notifications_v2', { p_batch_size: 2, p_worker_id: workerB, p_lease_seconds: 60 }),
  ]);
  const claimedIds = claimed.flatMap((entry) => (entry.data ?? []).map((row) => row.id));
  recorder.record('P007-012', claimed.every((entry) => !entry.error) && claimedIds.length === 3
    && new Set(claimedIds).size === 3, 'concurrent workers claimed disjoint outbox rows');

  const staleId = queueRows[0].id;
  await service.from('email_notifications').update({ status: 'processing', worker_id: workerA, lease_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', staleId);
  const reclaimed = await service.rpc('claim_email_notifications_v2', { p_batch_size: 10, p_worker_id: workerB, p_lease_seconds: 60 });
  recorder.record('P007-013', !reclaimed.error && (reclaimed.data ?? []).some((row) => row.id === staleId && row.worker_id === workerB),
    'expired worker lease was recovered by another worker');

  const retryId = staleId;
  const retryAck = await service.rpc('ack_email_notification_v2', {
    p_notification_id: retryId, p_worker_id: workerB, p_succeeded: false,
    p_provider_message_id: null, p_error_code: 'synthetic_retryable', p_retryable: true,
  });
  await service.from('email_notifications').update({ next_attempt_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', retryId);
  const retryClaim = await service.rpc('claim_email_notifications_v2', { p_batch_size: 10, p_worker_id: workerA, p_lease_seconds: 60 });
  const retryRow = (retryClaim.data ?? []).find((row) => row.id === retryId);
  const permanentAck = retryRow ? await service.rpc('ack_email_notification_v2', {
    p_notification_id: retryId, p_worker_id: workerA, p_succeeded: false,
    p_provider_message_id: null, p_error_code: 'synthetic_permanent', p_retryable: false,
  }) : { error: new Error('retry row was not reclaimed') };
  const finalRetry = await service.from('email_notifications').select('status,permanent_failure,attempts').eq('id', retryId).single();
  recorder.record('P007-014', !retryAck.error && !permanentAck.error && finalRetry.data?.status === 'failed'
    && finalRetry.data?.permanent_failure === true && finalRetry.data?.attempts >= 2,
    'retryable failure was rescheduled and permanent failure was terminal');

  const directEvent = await users.submitter.client.from('application_events').insert({
    application_id: applicationId, actor_id: users.submitter.id, event_type: 'status_changed',
    message: 'Synthetic forbidden event', is_internal: false,
  });
  const directOutbox = await users.submitter.client.from('email_notifications').insert({
    event_type: 'application_submitted', user_id: users.submitter.id,
    recipient_email: 'forbidden@example.invalid', subject: 'Synthetic forbidden outbox',
    template_data: {}, idempotency_key: `forbidden-${randomUUID()}`,
  });
  recorder.record('P007-015', Boolean(directEvent.error) && Boolean(directOutbox.error),
    'authenticated client could not forge domain history or outbox rows');

  const functionSecurity = Number(await scalar(stack, toolchain, env, `
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'submit_application_v1','moderator_decide_application_v2',
      'moderator_decide_revision_v2','claim_email_notifications_v2','ack_email_notification_v2',
      'approve_application_with_canonical_media_v3','apply_specialist_revision_with_canonical_media_v3'
    ) and p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=pg_catalog%'
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and (p.proname in ('moderator_decide_application_v2','moderator_decide_revision_v2')
        or not has_function_privilege('authenticated',p.oid,'EXECUTE'));
  `));
  recorder.record('P007-016', functionSecurity === 7, 'P0-07 definer functions have fixed paths and least-privilege EXECUTE ACLs');
}
