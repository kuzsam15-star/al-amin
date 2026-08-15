# P0-07 Local Verification

## Verdict

`ATOMIC_APPLICATION_WORKFLOWS_LOCAL_FIX_READY`

SEC-007 and SEC-008 are `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`. The atomic workflow/outbox portion of SEC-018 is locally verified, but SEC-018 remains `PARTIALLY_IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT` because AAL1 queue-read and broader audit/monitoring coverage remain open.

## Scope and safety

- Starting commit: `96a2dfd63548b9f2f2051531c41ca821db27c743`.
- Tests used only two fresh disposable local Supabase projects per harness invocation.
- The verified no-data baseline was replayed first, followed by all existing forward migrations and `20260814005517_p007_atomic_application_workflows.sql`.
- No remote Supabase project, production credential, production row, real recipient or external email transport was used.
- Historical migrations, `supabase/bootstrap/baseline.sql`, its manifest and `supabase/schema.sql` were not modified.

## Red phase

Two independent pre-fix runs matched exactly:

| Result | Run 1 | Run 2 |
| --- | ---: | ---: |
| PASS | 125 | 125 |
| XFAIL | 27 | 27 |
| XPASS | 0 | 0 |
| FAIL | 0 | 0 |
| SKIP | 0 | 0 |

P007-001 confirmed that direct authenticated application INSERT was already denied. P007-002 through P007-016 reproduced the missing active-owner invariant, durable submission idempotency, operation-level decision replay, atomic event/audit/outbox evidence, failure rollback, worker leases/retry and least-privilege function contract. Those fifteen failures mapped only to SEC-007/008/018.

## Implemented contract

1. `submit_application_v1` serializes submissions by owner, enforces one active application, replays an exact key/payload and rejects key reuse with different payload.
2. Application and revision decisions lock the aggregate, require expected state/version and use one operation ID for state, domain event, public event where applicable, audit and outbox.
3. Canonical SEC-001 publication remains a no-overwrite Storage saga; v3 database wrappers make the publication decision idempotent and atomic after verified copy. A failed DB commit may leave only an unreferenced immutable orphan, never a published inconsistent reference.
4. Event actor/role and email recipient/template/status are server/database-owned. Browser roles cannot insert events, audit rows or outbox rows.
5. Email enqueue is exactly once per business operation. Multiple workers claim disjoint rows with `FOR UPDATE SKIP LOCKED`, leases recover stale claims and ACK is worker-bound with bounded retry/permanent failure.
6. Provider I/O occurs after commit. External delivery is at-least-once; a provider success followed by ACK interruption can cause a later duplicate delivery. This residual is documented and not mislabeled exactly-once.

## Final clean-room results

| Result | Run 1 | Run 2 |
| --- | ---: | ---: |
| PASS | 140 | 140 |
| XFAIL | 12 | 12 |
| XPASS | 0 | 0 |
| FAIL | 0 | 0 |
| SKIP | 0 | 0 |

The runs had identical case IDs, classifications and SEC mappings. All P007-002..016 cases changed from XFAIL to PASS. No unrelated case produced XPASS. `AUDIT-004` remains an approved XFAIL mapped to SEC-010/018.

## Failure and worker verification

- Transaction rollback was exercised after state/domain-event/audit stages; failed operations left no application state or operation artifacts.
- Concurrent submit produced at most one active row.
- Concurrent conflicting decisions produced one winner and one complete side-effect set.
- Exact replay returned the committed result; changed-payload replay and stale transitions conflicted.
- Two workers claimed disjoint rows; an expired lease was recovered; retryable and permanent failures followed bounded states.
- Fake transport tests proved provider success then ACK, retryable provider failure, and send-before-ACK interruption without real email.

## Other verification

- Database lint: `0 ERROR / 0 WARN / 0 INFO`.
- Local security advisors: `4 ERROR / 8 WARN / 1 INFO`; no unexpected P0-07 delta.
- Node tests: `141/141 PASS`.
- TypeScript: PASS.
- ESLint: 0 errors; 12 pre-existing warnings.
- Disposable cleanup: PASS after every completed run.

## Deployment implication

This is local evidence only. The remote Supabase project remains unchanged. A consolidated pre-launch backend window must first run read-only duplicate/outbox preflight, then apply forward migrations in order and verify the same invariants. Existing duplicates or incompatible leased rows require separate owner-approved reconciliation; the migration fails closed rather than deleting data.
