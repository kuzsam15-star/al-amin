# P0-07 Atomic Application Workflows

## Security issue

- **Finding IDs:** SEC-007, SEC-008, SEC-018.
- **Title:** Atomic applications, decisions, audit evidence and email events.
- **Severity / launch blocker:** SEC-007 and SEC-008 High; SEC-018 Medium; all are pre-launch blockers.
- **Roadmap task:** P0-07.
- **Security invariant:** one accepted business operation has one locked, idempotent database transaction that commits its state, authoritative domain event, audit evidence and email outbox entry together.
- **Owner:** database and application owners.
- **Dependencies:** verified no-data baseline; SEC-001 canonical publication; SEC-002 owner projection; SEC-003 named moderation actions; SEC-004 feedback gateway.
- **Status:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT` for SEC-007/008; SEC-018 is `PARTIALLY_IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`. Remote deployment is not approved.

## Threat model

### Assets and trust boundaries

The protected assets are the application/revision state, published specialist state, moderation truth, domain history, audit attribution and email delivery intent. Browser clients, moderator sessions, the trusted Next.js server, PostgreSQL and the external email provider are separate trust boundaries.

### Actors

- anonymous and authenticated clients;
- application/profile owners;
- moderator AAL1 and administrator AAL2 sessions;
- trusted service backend and email worker;
- a normal account replaying or racing requests;
- accidental concurrent workers or moderator actions.

### Attacks and failures

- simultaneous or retried application submissions;
- duplicate keys with different payloads and different keys for one active business application;
- approve/reject, approve/approve and stale decision races;
- replay after a client timeout or revoked role;
- client-supplied actor, status, recipient, event or audit fields;
- partial failure after state, domain event, audit or outbox stages;
- canonical media copy succeeding before a database decision fails;
- duplicate worker claims, stale claims, bounded retry exhaustion and crash after provider send before ACK;
- direct writes to applications, application events, audit or outbox;
- future protected columns becoming writable through a generic payload.

### Secure invariants

- one active application per owner for `new`, `screening`, `info_required`, `changes_requested`, `call_required` and `call_scheduled`;
- an exact idempotency key/payload replay returns the committed result; key reuse with another payload conflicts;
- actor, role, transition, recipient, template and audit action are server/database-owned;
- decisions lock the aggregate and require expected state/version;
- state, event, audit and outbox enqueue commit or roll back together;
- canonical Storage work remains a fail-closed saga: verified no-overwrite copy first, then one database transaction; an unreferenced canonical orphan is safe and cleanup is separate;
- email is never sent in the database transaction; enqueue is exactly-once per business operation and external delivery is at-least-once;
- workers claim with `FOR UPDATE SKIP LOCKED`, leases and bounded attempts; network send occurs outside a transaction;
- direct client mutation and future-field inheritance fail closed.

### Confirmed before-state dependency map

```text
ApplicationForm
  -> POST /api/applications
  -> process-local Map check
  -> service-role direct INSERT/UPDATE
  -> application trigger -> application_events (service actor can be NULL)
  -> application trigger -> email_notifications
  -> processEmailQueue (best-effort)

Moderator action
  -> optional SEC-001 canonical no-overwrite Storage copy
  -> SEC-003 row-lock RPC
  -> application/revision state and publication
  -> legacy event/email triggers
  -> SEC-003 audit helper
  -> processEmailQueue (best-effort)

Email worker
  -> claim_email_notifications (SKIP LOCKED, no lease)
  -> provider network request
  -> direct outbox UPDATE as ACK/failure
```

The current submit duplicate check is process-local and is set only after the write. No database active-owner invariant exists. SEC-003 already serializes several decision rows, but it does not provide an operation-level idempotency record or a complete domain-event/audit/outbox contract. The outbox claim can remain `processing` forever after a worker crash.

## Product contract assumptions

- One owner may have at most one active application. Rejected, approved and withdrawn applications are terminal for this uniqueness rule.
- A returned `changes_requested` or `info_required` row is resubmitted in place; a rejected row does not prevent a later new application.
- Current email event types and recipient derivation remain unchanged.
- Moderators retain the current AAL1 decision subset; sensitive administrator actions remain AAL2 under SEC-010.
- External email exactly-once delivery is not claimed because the configured provider has no proven idempotent-send contract.

## Implemented database and source changes

- Forward migration `20260814005517_p007_atomic_application_workflows.sql` adds the active-owner invariant, operation/idempotency ledgers, authoritative private domain events, operation IDs on audit/application events/outbox, named submit/decision/publication RPCs and leased outbox claim/ACK functions.
- Direct client event/audit/outbox mutation is revoked. Application submission uses an exact allowlist inside `submit_application_v1`; future fields fail closed.
- The application form preserves one UUID idempotency key across transport retry. The server route derives the owner from the authenticated session, hashes the validated payload and calls the service-only RPC instead of direct DML.
- Moderator application/revision decisions use locked expected-state primitives. SEC-001 canonical no-overwrite copy remains before the database decision, while v3 publication wrappers make the database state/event/audit/outbox commit operation-aware and replay-safe.
- The worker uses a random lease token, `FOR UPDATE SKIP LOCKED`, stale-lease recovery and lease-checked ACK. Fake transport tests cover success, provider failure and send-before-ACK interruption without sending email.

## Before state

- **Environment:** two independent disposable local Supabase projects only.
- **Confirmed secure before-state:** P007-001 direct authenticated INSERT is already denied by the prior grant closure.
- **Expected failures:** P007-002 through P007-016 map only to SEC-007/008/018.
- **Safety:** synthetic `example.invalid` fixtures; no remote ref, credentials, production data or real email.
- **Red evidence:** both independent before-state runs produced **125 PASS / 27 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**. Fifteen new XFAIL (`P007-002..016`) mapped only to SEC-007/008/018; P007-001 was already secure and remained PASS.

## Test plan

- concurrent submit cardinality and exact/different-payload idempotency;
- active-status uniqueness and permitted terminal resubmission;
- application and revision replay/stale/conflicting decisions;
- deterministic rollback after state/domain-event/audit/outbox stages;
- direct client mutation denial and future-field fail-closed behavior;
- disjoint worker claims, stale lease recovery, bounded retry and permanent failure;
- fake provider success, failure and send-before-ACK crash semantics;
- two complete role-matrix runs, database lint/advisors, Node tests, typecheck, ESLint and candidate secret/PII scan.

## Local result

- Two independent final clean-room runs each produced **140 PASS / 12 unrelated XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**.
- All fifteen target XFAIL became PASS; the other twelve classifications and mappings were unchanged.
- Database lint: `0 ERROR / 0 WARN / 0 INFO`. Security advisors: `4 ERROR / 8 WARN / 1 INFO`, unchanged and unrelated to this delta.
- Node tests: `141/141 PASS`; typecheck PASS; ESLint 0 errors with 12 pre-existing warnings.
- `AUDIT-004` intentionally remains XFAIL for SEC-010/018 because privileged queue-read/AAL2 policy and the broader all-actions audit/operations scope are not closed here.
- No external email was sent. Exactly-once external delivery is not claimed: atomic enqueue is exactly once, while provider delivery is at-least-once with documented residual duplicate risk after send-before-ACK failure.

## Rollback and deployment prerequisites

The remote backend is untouched. Before the consolidated pre-launch deployment, an owner-operated read-only preflight must find no duplicate active applications and no incompatible outbox rows. The safe fallback is to leave new callers disabled and forward-fix the versioned primitives; rollback must not reopen direct client writes or remove audit evidence. Existing inconsistent data, if any, requires a separate approved reconciliation and is never deleted automatically.

## Commit

- **Planned message:** `fix(security): make application workflows atomic`
- **Branch:** `security/hardening`
- **Production release status:** BLOCKED until consolidated pre-launch backend hardening.
