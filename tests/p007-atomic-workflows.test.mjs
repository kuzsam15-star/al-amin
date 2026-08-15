import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { processClaimedEmails } from '../src/lib/email/worker-core.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const row = { id: 'synthetic-notification', event_type: 'application_submitted', recipient_email: 'fixture@example.invalid', subject: 'Synthetic', template_data: {}, attempts: 1 };

test('P0-07 migration exposes only named, fixed-path transactional primitives', async () => {
  const migration = await read('supabase/forward-migrations/20260814005517_p007_atomic_application_workflows.sql');
  for (const name of ['submit_application_v1','moderator_decide_application_v2','moderator_decide_revision_v2','claim_email_notifications_v2','ack_email_notification_v2']) {
    assert.match(migration, new RegExp(`function public\\.${name}\\(`));
  }
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /applications_one_active_per_owner_idx/);
  assert.match(migration, /set search_path = pg_catalog/g);
  assert.match(migration, /revoke insert,update,delete on table public\.application_events/);
  assert.match(migration, /revoke insert,update,delete on table public\.audit_log/);
  assert.match(migration, /revoke insert,update,delete on table public\.email_notifications/);
});

test('P0-07 application route uses an explicit idempotency key and narrow RPC', async () => {
  const [route, form] = await Promise.all([
    read('src/app/api/applications/route.ts'), read('src/components/ApplicationForm.tsx'),
  ]);
  assert.match(route, /submit_application_v1/);
  assert.match(route, /idempotency-key/);
  assert.doesNotMatch(route, /recentRequests/);
  assert.doesNotMatch(route, /from\("applications"\)\.(?:insert|update)/);
  assert.match(form, /Idempotency-Key/);
  assert.match(form, /idempotencyKeyRef/);
});

test('fake transport success is acknowledged only after provider completion', async () => {
  const calls = [];
  const result = await processClaimedEmails({
    rows: [row], workerId: 'synthetic-worker',
    transport: async () => { calls.push('send'); return { providerMessageId: 'synthetic-provider-id' }; },
    acknowledge: async (value) => { calls.push(value.succeeded ? 'ack-success' : 'ack-failure'); return { retry: false }; },
  });
  assert.deepEqual(calls, ['send','ack-success']);
  assert.deepEqual(result, { sent: 1, failed: 0, retrying: 0 });
});

test('fake provider failure is acknowledged for bounded retry without message content', async () => {
  let acknowledgement;
  const error = Object.assign(new Error('synthetic provider detail'), { retryable: true });
  const result = await processClaimedEmails({
    rows: [row], workerId: 'synthetic-worker', transport: async () => { throw error; },
    acknowledge: async (value) => { acknowledgement = value; return { retry: true }; },
  });
  assert.equal(acknowledgement.errorCode, 'provider_retryable');
  assert.equal('message' in acknowledgement, false);
  assert.deepEqual(result, { sent: 0, failed: 0, retrying: 1 });
});

test('send-before-ack failure leaves lease recovery to the database worker contract', async () => {
  let acknowledgements = 0;
  await assert.rejects(processClaimedEmails({
    rows: [row], workerId: 'synthetic-worker',
    transport: async () => ({ providerMessageId: 'synthetic-provider-id' }),
    acknowledge: async () => { acknowledgements += 1; throw new Error('synthetic ack interruption'); },
  }), /synthetic ack interruption/);
  assert.equal(acknowledgements, 1);
});
