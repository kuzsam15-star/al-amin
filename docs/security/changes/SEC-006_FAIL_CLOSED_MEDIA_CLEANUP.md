# SEC-006 Fail-Closed Media Cleanup

## Security issue

- **Finding ID:** SEC-006.
- **Title:** Recoverable fail-closed media cleanup.
- **Severity / launch blocker:** High / yes.
- **Roadmap task:** P0-08.
- **Invariant:** no Storage object is deleted unless a trusted worker holds an exact-object lease and a current authoritative database check proves that the object has no active, workflow or retention reference.
- **Dependencies:** verified baseline, SEC-001 canonical/provenance model, P0-07 worker pattern, Recovery Level 3.
- **Status:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`.

## Threat model

### Assets and actors

Assets are active canonical media, pending/reviewed submissions, prior canonical versions, database references, SEC-001 provenance, public-profile availability and recovery consistency. Actors are anon, owner, another user, moderator, admin, trusted service backend, cleanup worker, stale/compromised worker and a caller replaying a cleanup request.

### Before-state dependency map

```text
failed submit / revision replace / reject / admin delete
  -> service-role helper
  -> three non-authoritative snapshots (query errors ignored)
  -> only pending revisions counted
  -> batch Storage remove(paths)
  -> Storage result ignored
```

The direct owner Storage DELETE policy used the same snapshot-style helper. There was no grace period, object-generation identity, job/lease, retry state, provenance retention or lock shared with reference writers.

### Attacks and failures

- active canonical, pending, reviewed, shared or foreign media deletion;
- stale check followed by a new reference (TOCTOU);
- bucket/path substitution, traversal, encoding and prefix collision;
- duplicate jobs and concurrent workers;
- crash before delete, after delete or before acknowledgement;
- Storage failure after DB state change, missing object and ambiguous provider result;
- changed object generation, owner or size;
- deletion of SEC-001 old sources before verified cutover/recovery;
- client invocation of a generic privileged delete;
- future media-reference field invisible to cleanup;
- raw object-path leakage in logs/evidence.

### Secure invariants

- only `profile-media` exact `submissions/<owner>/<avatar|gallery>/<uuid>.webp` objects can be automatic candidates;
- canonical, provenance-source, unknown, shared and currently referenced objects are never automatically deleted;
- a candidate records Storage object ID, owner, updated generation and size where present;
- 24-hour grace applies to failed-submit orphans; other allowlisted unused submissions use seven days;
- claim uses `FOR UPDATE SKIP LOCKED`, a bounded lease and at most five attempts;
- reference writers and cleanup share a path advisory-lock namespace; a `deleting` job blocks a new reference;
- authorization rechecks registry, all references, provenance and exact object identity immediately before one-object Storage deletion;
- uncertainty, query error, metadata mismatch or unknown namespace means no delete;
- missing exact object can complete only after the same authoritative checks;
- active canonical and SEC-001 source objects remain retention protected.

## Media-reference inventory

| Source | Fields | Role | Cleanup rule |
| --- | --- | --- | --- |
| `applications` | `main_image_path`, `gallery_paths[]` | active/moderation application media | any row blocks |
| `specialists` | `avatar_path`, `gallery_paths[]` | published/draft profile media | any row blocks |
| `specialist_revisions` | `payload.avatar_path`, `payload.gallery_paths[]` | pending/changes-requested workflow | active workflow rows block; approved source provenance blocks separately |
| `private.published_media_assets` | `canonical_path` | canonical provenance | permanent automatic-cleanup block |
| `private.published_media_assets` | `source_path` | SEC-001 reviewed source/rollback evidence | pre-launch retention block |
| published views | projections of `specialists` | public contract | no independent reference; base reference blocks |
| Storage metadata | bucket/name/object ID/owner/generation/size | exact object identity | must match candidate |

No account-profile media column or independent authoritative path in audit/event metadata was found. The registry contains eight versioned sources and fails closed when a new media-like column appears without registration.

## Implemented architecture

```text
trusted workflow dereference/failure
  -> enqueue_media_cleanup_v1 (exact owned object + allowlisted reason)
  -> private.media_cleanup_jobs (grace / identity / status)
  -> claim_media_cleanup_jobs_v1 (SKIP LOCKED + lease)
  -> authorize_media_cleanup_delete_v1
       registry + advisory lock + all references + provenance + generation
  -> service worker Storage.remove([exact_path])
  -> ack_media_cleanup_job_v1 verifies object absence and references again
```

`fail_media_cleanup_job_v1` returns provider failures to bounded retry or manual review. A successful delete followed by an ACK crash leaves a leased `deleting` job; after lease expiry, a worker rechecks the missing exact object and completes idempotently. Storage and PostgreSQL are deliberately modeled as a saga, not falsely described as ACID.

Request paths now enqueue only. Direct owner Storage DELETE is removed. The worker module accepts failure hooks only as an in-process test dependency; no route/RPC/client payload can activate them. Logs contain reason/count or safe codes, never raw paths or user IDs.

## Before and after evidence

- **Red environment:** two independent disposable local Supabase stacks.
- **Red result:** each `140 PASS / 30 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP`; 18 new XFAIL were P008-001..018 mapped only to SEC-006.
- **After result:** each `158 PASS / 12 unrelated XFAIL / 0 XPASS / 0 FAIL / 0 SKIP`; all 18 SEC-006 cases PASS.
- **Failure coverage:** query/registry fail closed, stale reference cancellation, parallel claim, provider failure, crash after delete, exact missing-object ACK, duplicate enqueue/replay, future-field regression.
- **Recovery:** Level 3 backup/restore already covers database and Storage. Automatic deletion remains disabled for recovery-dependent classes.

## Residual and deferred cleanup

Automatic cleanup is intentionally limited to provably unused submission objects. Canonical objects, previous canonical versions, SEC-001 old sources, recovery-protected objects, unknown provenance and multiple-reference objects remain `manual_review`/retained. Scheduling/hosting of the worker belongs to the first deployment design; absence of a scheduler leaks storage but cannot delete data.

## Deployment and rollback

Remote Supabase was not contacted. Consolidated pre-launch deployment must perform a read-only registry/drift preflight, apply migrations in order, deploy server callers, keep the worker disabled for an observation window, then enable a conservative batch. Safe rollback is to disable the worker while retaining the ledger and revoked client DELETE policy. Never roll back by restoring broad client DELETE or deleting old SEC-001 sources.

## Commit

- **Planned message:** `fix(security): make media cleanup fail closed`
- **Branch:** `security/hardening`
- **Production release:** blocked pending consolidated pre-launch backend deployment.
