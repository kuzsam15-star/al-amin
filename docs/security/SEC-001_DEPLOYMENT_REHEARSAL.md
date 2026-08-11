# SEC-001 Deployment Rehearsal

Date: 2026-08-11

Status: `INDEPENDENTLY_REVIEWED_LOCAL_READY_FOR_CONTROLLED_DEPLOYMENT`

## Scope and isolation

Two independent local rehearsals used different disposable project IDs,
ports, Auth users, database rows, and Storage objects. Each started from the
verified no-data pre-hardening baseline with no forward migration applied.
Only synthetic `example.invalid` identities and generated image bytes were
used. Run-specific values and credentials stayed in memory and were destroyed
with each project.

## Legacy production-shape fixture

Each run created only synthetic equivalents of:

- approved applications and a published specialist with mutable avatar paths;
- a mutable legacy gallery;
- pending and rejected applications/revisions;
- one mixed canonical-avatar plus legacy-gallery record;
- an orphan submission;
- a missing source, corrupt source, duplicate content, and canonical conflict.

No production row, identifier, object path, media, or credential was copied.

## Rehearsal sequence and evidence

| Gate | Run 1 | Run 2 |
|---|---|---|
| Verified baseline replay | PASS | PASS |
| Legacy public projection before Phase A | PASS | PASS |
| Phase A | PASS | PASS |
| Phase B before backfill | FAIL CLOSED; transaction left 0 enforcement constraints | Same |
| Dry-run | 6 planned, 0 changed | Same |
| Missing source | FAIL CLOSED; row unchanged | Same |
| Storage copy then stale DB precondition | FAIL CLOSED; row unchanged | Same |
| Corrupt source | FAIL CLOSED; row unchanged | Same |
| Interrupted apply | 1 applied; 3 remained after prior recovery | Same |
| Canonical same-path/different-bytes conflict | STOP; row unchanged | Same |
| Resume | 3 applied; 0 remained | Same |
| Second apply | 0 planned / 0 applied | Same |
| Mixed canonical/legacy item | Atomic final canonical state | Same |
| Pending/rejected records | Unchanged | Same |
| Old sources/orphan | Retained | Same |
| Phase B after backfill | PASS | PASS |
| Phase B second apply | PASS | PASS |
| Foreign owner/provenance substitution | DENIED | DENIED |
| Delete dereferenced source after cutover | Canonical bytes remain readable | Same |
| Client canonical delete | DENIED; bytes remain | Same |
| Project-specific cleanup | PASS | PASS |

The stable deployment-rehearsal classifier was **19 PASS / 0 FAIL** in each
run. The subsequent full role matrix used two additional fresh projects and
matched at **73 PASS / 23 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**. All 23 XFAIL
entries retain their prior non-SEC-001 finding mapping.

## Backfill behavior

`runSec001Backfill` performs metadata inventory of approved applications and
published specialists, then:

1. defaults to dry-run and validates source ownership, availability,
   decodability, format, size, pixel limit, and canonical output in memory;
2. validates and content-addresses each legacy source;
3. uploads canonical WebP with no-overwrite semantics;
4. invokes one service-only RPC with the exact inventoried avatar/gallery
   values as optimistic preconditions;
5. changes the row only after descriptor and Storage verification;
6. permits safe interruption and re-inventory-based resume;
7. treats a second apply as zero work;
8. never deletes an old source.

The core receives credentials only through an explicit runtime client. It does
not load `.env.local`, persist checkpoints/credentials, or print identifiers,
paths, tokens, hashes tied to users, or media bytes.

## Failure sequencing

| Scenario | Safety assessment | Detection | Required response |
|---|---|---|---|
| Phase A applied; source deployment fails | Safe for existing rows; new approvals must remain paused | Source health/canary fails | Keep Phase A, pause approvals, deploy compatible source forward |
| New source deployed before Phase A | Unsafe/fail-closed publication outage | RPC/function missing | Roll source forward only after Phase A; runbook forbids this order |
| Backfill partially fails | Safe if stopped: completed rows canonical, failed row unchanged, old source retained | Aggregate error category and remaining count | Stop, remediate, re-run dry-run, resume |
| Backfill complete; Phase B fails | No data rollback required; enforcement incomplete | Transaction error; constraints absent | Keep canonical rows/source, correct cause with forward fix, retry Phase B |
| Phase B applied; application rolled back to old source | Unsafe/incompatible; old source cannot publish legacy paths | Publication canary/RPC failure | Do not roll back application alone; forward-fix with Phase-B-compatible source |

Database failure after successful Storage copy can leave an unreferenced
content-addressed object, never a database reference to unverified bytes.
Later identical retry safely reuses it after hash verification. Destructive
Storage rollback is forbidden.

## Rollback policy by stage

- **Before Phase A:** no change; normal abort is allowed.
- **After Phase A:** keep additive security objects; pause approval and deploy a
  reviewed compatible source. Do not restore owner overwrite.
- **After source deploy:** application rollback is allowed only to a version
  explicitly compatible with the active Phase A schema.
- **During/after backfill:** stop and resume; do not revert canonical database
  references or delete canonical/legacy objects.
- **After Phase B:** database and application rollback are forward-fix only;
  older publication code is incompatible by design.

## Production implication

This rehearsal proves the local mechanics and failure policy, not production
readiness by itself. P0-03C must approve backup/restore evidence, exact live
catalog compatibility, deployment identities, change owners, monitoring,
inventory counts, maintenance controls, and post-deployment evidence before
any production operation is authorized.
