# SEC-001 Release Operations

Date: 2026-08-13

Status: `READY_FOR_CONTROLLED_PRODUCTION_DEPLOYMENT`

Production execution: **not performed and not authorized by this document**.

## 1. Release architecture

The owner starts one launcher, `scripts/release/sec001/START_SEC001_RELEASE.bat`.
It resumes an external checkpoint and exposes only the next legal stage. The
shared Node state machine is also exercised by the disposable Supabase
deployment rehearsal. PowerShell supplies the human workflow and hidden
prompts; a pinned PostgreSQL client container supplies isolated database access.

The release uses the immutable Phase A and Phase B forward migrations, the
reviewed application source, and the existing dry-run-first backfill core. It
does not use linked Supabase CLI state, Dashboard SQL paste operations, or a
new CI/CD platform.

## 2. State and checkpoint

The only forward sequence is:

1. `NOT_STARTED`
2. `PREFLIGHT_PASSED`
3. `PHASE_A_APPLIED`
4. `SOURCE_DEPLOY_CONFIRMED`
5. `CANARY_PASSED`
6. `INVENTORY_REVIEWED`
7. `BACKFILL_IN_PROGRESS`
8. `BACKFILL_COMPLETE`
9. `OBSERVATION_PASSED`
10. `PHASE_B_APPLIED`
11. `POST_VERIFY_PASSED`
12. `COMPLETE`

Terminal safe states are `FAILED_SAFE` and `ABORTED_SAFE`. `COMPLETE` is not a
manual transition. The checkpoint contains only a release UUID, timestamps,
state history, aggregate counters, source commit, manifest hash, and target
fingerprint. It contains no host, project ref, row ID, object path or secret.
Atomic replacement writes prevent a partially written checkpoint.

## 3. Project identity guard

The target fingerprint is SHA-256 over normalized:

- owner-confirmed project ref;
- region;
- database host;
- a known catalog marker;
- sorted expected bucket names.
- the project-bound API host and HTTPS source-version host.

The owner-approved identity package remains outside Git under an owner-only ACL.
The wrapper recomputes the fingerprint and checks baseline tables, Storage
catalog presence, Phase A state, source version marker, and expected bucket
contract. A display name such as `amanat` is never sufficient. Any mismatch is
`FAILED_SAFE` before mutation.

## 4. Frozen artifacts

`docs/security/SEC-001_RELEASE_ARTIFACT_MANIFEST.json` freezes SHA-256 for both
migrations, runtime publication source, backfill core/runner, state machine,
PowerShell/Bash wrapper, deployment runbook, and recovery evidence. The runtime
HEAD is frozen into the external checkpoint because a Git commit cannot contain
its own hash. Every production mutation revalidates the manifest and checkpoint.

## 5. Identity model

| Identity | Exact capability | Lifetime / custody | Revocation |
|---|---|---|---|
| Database migration | connect to the one production DB as the verified owner of the affected schemas/functions and execute only reviewed Phase A/B DDL | owner-held DB credential, entered hidden only for a migration/verification window | discard prompt value; rotate/reset only under separate owner decision if exposure is suspected |
| Backfill | read approved application/specialist references, read/copy `profile-media`, call the one service-only cutover RPC | temporary individually revocable secret API credential; owner-held; one backfill window | owner deletes the temporary credential immediately after zero-change verification |
| Source deployment | deploy the frozen commit through the existing hosting control plane | human-only existing hosting admin session; never received by wrapper | existing hosting session and access lifecycle |
| Read-only verification | catalog and aggregate metadata only | temporary catalog-only audit identity where possible | revoke and delete after post-verification |

No persistent broad service credential is committed or requested in chat. A
temporary backfill credential is broad by platform necessity, so its short
lifetime, hidden stdin transport, aggregate-only output, explicit deletion and
single-purpose wrapper are mandatory compensating controls.

## 6. Stage gates

### Preflight

Requires clean `security/hardening`, no Git remote, recovery Level 3 evidence,
valid frozen hashes, owner-confirmed target fingerprint, expected pre-Phase-A
catalog, pinned local tools, adequate disk/network, and no conflicting lock.
It is read-only.

### Phase A and source

The exact Phase A SQL is applied under a session advisory lock. The checkpoint
advances only after catalog markers, functions and triggers verify and Phase B
constraints remain absent. The owner then deploys the exact checkpoint commit
through existing hosting. A read-only version marker must return that commit.

### Canary

An owner-operated synthetic production canary is a separately approved P0-13
mutation. It must prove canonical creation with no overwrite, valid public
render, and client denial of canonical update/delete. No real user record or
media is used.

### Inventory and backfill

Inventory emits aggregate counts only: total legacy, already canonical,
missing, corrupt, conflict, unsupported and blocked. Any integrity anomaly is a
hard stop. Backfill uses batches 1, 10, then at most 25, concurrency 1, and a
checkpoint after every batch. It never deletes an old source. A failure retains
`BACKFILL_IN_PROGRESS` for safe resume.

A second dry run is mandatory. Changes, legacy references, missing, corrupt,
conflict, unsupported and blocked must all equal zero.

### Observation and Phase B

The MVP observation gate is at least 30 minutes (one deliberate monitoring
interval), at least two successful new application approvals, at least one
successful revision approval, and zero canonicalization, media-serving or
security errors and zero unresolved alerts. The sample exercises both
publication paths rather than relying on elapsed time alone.

Phase B additionally requires `CANARY_PASSED`, the exact checkpoint/manifest,
all seven zero counters, and the case-sensitive phrase `APPLY PHASE B`. After
Phase B, constraints, policies, denial of legacy/client canonical writes,
public render and a new approval are verified. Rollback is forward-fix only.

## 7. Abort and resume matrix

| State | Safe abort | Resume rule |
|---|---|---|
| Before Phase A | exit; no production change | repeat full preflight |
| After Phase A | keep compatible Phase A; do not apply Phase B | verify Phase A then deploy frozen source |
| After source/canary | leave compatible source/Phase A in place | reverify version marker and canary |
| Inventory anomaly | no backfill starts | resolve through separately reviewed evidence; rerun inventory |
| Backfill in progress | stop after current atomic target; retain checkpoint; never delete source | reverify target/hashes, then continue at batch size <=25 |
| Backfill complete / before Phase B | safe pause | zero-change pass and observation must be fresh |
| After Phase B | no old-application rollback | forward-fix only; preserve evidence and activate incident procedure |

Stale locks and checkpoints are never automatically removed or trusted. They
require owner review of the redacted log and production state.

## 8. Logging and owner actions

The owner actions are limited to launching the BAT, choosing the approved
identity package, confirming the target fingerprint, entering hidden short-lived
secrets, deploying the shown source commit, accepting canary/inventory evidence,
typing `APPLY PHASE B`, and deleting the temporary backfill credential.

The local JSONL log allows timestamps, stage, hashes, aggregate counts,
PASS/FAIL, durations and safe error codes. Passwords, tokens, API keys, emails,
UUIDs, media paths/bytes, signed URLs and user content are forbidden.

## 9. Authorization boundary

P0-12 proves the tooling and its local rehearsals. It does not set
`ALAMIN_SEC001_PRODUCTION_APPROVED`, create an identity package, create or use a
production credential, connect to production, deploy source, run a canary, or
apply SQL. Those are explicit owner-controlled P0-13 actions.
