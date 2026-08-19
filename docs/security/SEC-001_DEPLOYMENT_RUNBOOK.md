# SEC-001 Deployment Runbook

Date: 2026-08-11

Status: `RETAINED_AS_REHEARSAL_EVIDENCE_REQUIRES_PRELAUNCH_REDESIGN`

Change: immutable canonical published media

## Pre-launch correction

There is currently no hosted AL-AMIN application, deployed source revision or
public application traffic. The live remote Supabase project is a backend, not
a deployed Next.js application. Therefore this runbook must not be used as an
immediate SEC-001 deployment procedure: its source-deploy, version-marker,
public-canary and traffic-observation assumptions do not exist yet.

The applicable recovery, target, migration, backfill and enforcement controls
must be incorporated into a dependency-ordered consolidated pre-launch backend
hardening plan after the remaining P0 fixes are complete. Hosting and source
provenance gates return at the first application deployment. See
`SEC-001_PRELAUNCH_REASSESSMENT.md`.

This is retained owner-operated rehearsal evidence. It does not authorize
remote access, deployment, backfill, or Phase B. Recovery Level 3 and the
applicable P0-12 controls are proven locally; any future consolidated pre-launch
backend cutover still requires explicit owner authorization.

Do not run `scripts/release/sec001/START_SEC001_RELEASE.bat` against the remote
backend in its current form. A future reviewed wrapper may reuse its external
checkpoint, artifact/target verification, hidden credential prompts, advisory
lock, aggregate backfill gates and Phase B confirmation. Dashboard SQL paste
and bypassing the approved future wrapper remain forbidden.

## Preconditions

All conditions are mandatory before Phase A:

1. The exact AL-AMIN production project is independently confirmed by the
   human owner and operator without sharing a project ref or credential.
2. The source commit and every file in
   `SEC-001_DEPLOYMENT_ARTIFACT_MANIFEST.json` match SHA-256 exactly.
3. Same-day metadata-only compatibility checks confirm that Phase A's schemas,
   tables, columns, policies, functions, roles, buckets, and extension
   assumptions still match the adjudicated live catalog.
4. A recent database recovery point covering the deployment window exists,
   its retention/RPO is accepted, and an isolated restore has been completed.
5. A separate Storage-object recovery artifact and an isolated hash/count
   restore have been completed. A database backup or restored database is not
   evidence that Storage object bytes can be recovered.
6. Critical Auth/Storage/platform configuration required for recovery is
   inventoried without secrets and has a tested manual reconfiguration plan.
7. The exact production migration mechanism records the two forward versions
   without rewriting the 18 historical migrations. The operator identity and
   audit trail are approved.
8. A verified source build/release artifact is tied to the frozen commit, and
   an exact hosting deployment command plus rollback target are approved.
9. The dry-run-first backfill has an executable owner wrapper, restricted
   runtime identity, batch/checkpoint handling, redacted output, and an exact
   invocation. The reviewed core alone is not a production command.
10. Change owner, database owner, Storage owner, source deploy owner, observer,
    stop authority, and forward-fix owner are named for the window.
11. Monitoring and the observation window are active before source deploy.
12. No Phase B command is scheduled until its separate gate is satisfied.

If any condition is absent or `UNKNOWN`, stop before Phase A.

## Deployment order

The only approved order is:

0. Run the preflight and freeze moderation approvals/backfill.
1. Pass the database, Storage, and configuration recovery gate.
2. Apply only Phase A,
   `202608110001_sec001_immutable_published_media.sql`, through the approved
   version-recording production migration mechanism.
3. Verify Phase A objects, policies, function ACLs, triggers, legacy reads,
   and absence of broadened client mutation.
4. Deploy the exact Phase-A-compatible source artifact.
5. Run a synthetic canary: unique submission, application approval, revision
   rejection/approval, canonical read, and direct client mutation denials.
6. Re-open new moderation decisions only if the canary passes. From this point
   every new approval must create immutable canonical media.
7. Run aggregate legacy inventory and review every anomaly category.
8. Run backfill dry-run with no writes.
9. Apply the backfill in controlled batches only after dry-run approval.
10. Verify complete canonical coverage and a zero-change second pass.
11. Complete the observation window without a stop signal.
12. Apply Phase B,
    `202608110002_sec001_enforce_canonical_published_media.sql`.
13. Run post-Phase-B verification and closeout evidence.

Source must never precede Phase A. Phase B must never precede complete
backfill. After Phase B, the application must never be rolled back to the old
publication implementation.

## Recovery gate

Required evidence:

- database: backup/PITR timestamp, retention window, accepted RPO/RTO, backup
  completion, isolated restore result, schema/function/grant reconciliation,
  and named restore owner;
- Storage: independent object inventory/copy/versioned artifact, encrypted and
  access-controlled retention, restored object count/size/hash reconciliation,
  and a proven procedure to restore objects without overwriting good bytes;
- configuration: redacted inventory and reconstruction checklist for Auth
  providers/redirects/session settings, Storage buckets/limits/MIME settings,
  hosting variables, and operational access; secret values are never evidence;
- application: last-known-good build identifier and the frozen SEC-001 build
  artifact tied to exact commits.

PITR is mandatory when a daily-backup RPO does not cover the approved change
window. If a daily backup is sufficient, that RPO must be explicitly accepted
and the isolated restore must still pass. Supabase restore-to-new-project is a
database recovery mechanism; Storage objects/settings and several platform
settings require separate recovery evidence.

No backup or restore is performed by this runbook. Missing or untested restore
evidence is a hard stop, not a residual-risk note.

## Compatibility matrix

| Database / application state | Classification | Approval availability | Recovery rule |
|---|---|---|---|
| Old DB + old app | `SAFE` pre-change | Existing behavior; SEC-001 remains open | Abort normally before Phase A |
| Old DB + new app | `BLOCKED` | New publication RPCs are absent | Restore old app before traffic; apply Phase A first |
| Phase A DB + old app | `DEGRADED-BUT-SAFE` | Reads/uploads may work; legacy approvals fail closed | Keep Phase A; approvals paused; deploy compatible app forward |
| Phase A DB + new app | `SAFE` | New approvals canonical | App rollback only to a reviewed Phase-A-compatible build |
| Partial backfill + new app | `DEGRADED-BUT-SAFE` | New approvals canonical; legacy rows mixed | Stop/resume backfill; never revert canonical rows |
| Complete backfill + new app | `SAFE` | New and legacy references canonical | Verify zero-change second pass, then observe |
| Phase B DB + new app | `SAFE` | Canonical constraints enforced | Forward-fix only for DB/publication defects |
| Phase B DB + old app | `BLOCKED` | Old publication attempts violate enforced contract | App rollback forbidden; pause approvals and forward-fix |

Neither Phase A nor Phase B is destructively rolled back. Never restore owner
overwrite privileges, delete canonical media, or revert canonical references.

## Production-shape assumptions

The live metadata evidence confirms object interfaces, not present-day rows or
media. Same-day preflight must validate these assumptions without outputting
user data:

- `applications`, `specialists`, `specialist_revisions`, `moderators`, and
  managed `storage.objects` exist with the required columns and types;
- `profile-media` is the publication bucket and its policy names/definitions
  have no unreviewed drift;
- `applications.owner_id`, `main_image_path`, `gallery_paths`, `status`, and
  `updated_at`, plus the equivalent specialist/revision fields, retain their
  adjudicated types and nullability;
- every non-null legacy path belongs unambiguously to its referencing owner;
- every approved/published path is either a valid canonical path with active
  provenance or a recoverable legacy source object;
- no production-only path family exists outside the tracked legacy patterns;
- current production app/build compatibility is known before Phase A;
- migration history can record the forward versions without reinterpreting the
  archived files.

Unknown path families, ambiguous ownership, missing source, incompatible
catalog drift, or unknown deployed source version are blockers.

## Dry-run inventory contract

SEC-001R adds one exact compatibility family observed by aggregate-only live evidence:
`submissions/<legacy-scope-uuid>/<main|gallery-N>-<object-uuid>.<png|jpg|jpeg|webp>`.
The first UUID is opaque and MUST NOT be treated as owner identity. The runner
builds a complete in-memory registry from approved application and published
specialist references. An exact path is eligible only when all its references
resolve to one DB owner. Unknown/root families and multi-owner references stop
before Storage access. Same-owner reuse is counted and may canonicalize into
separate entity/slot destinations.

The future owner wrapper may output only aggregate counts and error categories:

- total approved/published references examined;
- legacy references and already-canonical references by table and slot type;
- missing source, corrupt/malformed source, unsupported format;
- ambiguous owner, foreign path, conflicting or missing provenance;
- canonical object conflict, duplicate content, and blocked rows;
- planned, applied, remaining, retry, and unchanged counts.

It must not output owner IDs, row IDs, object paths, emails, profile content,
media bytes, hashes linked to a user, tokens, signed URLs, or credentials.

Thresholds:

- legacy count may be non-zero only when two dry runs agree and the owner
  approves the exact aggregate scope;
- missing/corrupt/unsupported/foreign/ambiguous/conflicting/blocked counts must
  be zero before apply;
- duplicate content is review-required and cannot be auto-merged;
- any count change between approved dry-run and apply is an immediate stop;
- Phase B requires zero legacy and zero unresolved anomalies.

## Backfill operational plan

The reviewed core pages database inventory in groups of 500, is idempotent by
re-inventory, uses no-overwrite canonical upload, performs optimistic database
cutover, and retains old source media. P0-12 adds the owner wrapper and durable
redacted checkpoint outside Git.

The future wrapper must start with one canary row, then batches of 10 and a
maximum provisional batch of 25 with concurrency `1`. Observe at least one
monitoring interval between the canary and first batch. These are conservative
defaults, not throughput claims; decrease them on latency/errors and increase
only after separately measured evidence and owner approval.

Integrity, authorization, ownership, missing-source, hash, canonical conflict,
or database-precondition errors have an error budget of zero and stop the run.
For a clearly transient network/platform error, retry the same item at most
twice with bounded backoff; then stop the batch. Resume only by a fresh dry-run
and reconciliation. The wrapper must record only an opaque checkpoint and
aggregate counters in a restricted temporary location, remove credentials and
checkpoint after signed closeout, and never delete old source media.

## Phase B gate

All conditions are required:

- legacy mutable references = `0`;
- missing/corrupt/unsupported/ambiguous/conflicting rows = `0`;
- active published references without matching active provenance = `0`;
- active provenance without an existing canonical Storage object = `0`;
- canonical object metadata/hash verification failures = `0`;
- backfill second pass planned/applied changes = `0`;
- new approval canary produces canonical media and all client mutation denials
  pass;
- the observation window has no unresolved regression or stop signal.

Phase B itself transactionally rechecks legacy/provenance constraints and
fails closed, but it does not prove Storage byte recovery, the second-pass
result, or monitoring. Those external gate results must be signed by the owner
before the mutation command is released.

## Post-deployment verification

After Phase A, verify exact migration version/hash, required objects and ACLs,
legacy profile rendering, and unchanged denial surface. After source deploy,
verify canonical path shape, no-overwrite, active provenance, public serving,
and owner/foreign/anon/moderator-client mutation denial. After backfill, verify
zero legacy references, complete provenance and object existence, intact old
sources, public media, and zero-change second pass. After Phase B, verify both
constraints are validated, legacy writes fail, canonical publication succeeds,
and public serving remains intact.

All production checks must be pre-reviewed, aggregate/redacted, and scoped to
the approved canary or catalog metadata. They must not expose row content,
user identifiers, object paths, media, or credentials.

## Monitoring and emergency stop

Monitor redacted aggregate rates for canonicalization/upload/verification,
approval failures, media load failures, Storage 4xx/5xx, database constraint
errors, direct canonical mutation attempts, missing-media reports, queue age,
backfill remaining/errors, and unexpected source deletion.

Stop immediately on wrong project, hash mismatch, unknown path format,
canonical overwrite, broken profile/media, database update before verified
copy, unexpected 403/5xx increase, client canonical mutation success, source
deletion, material dry-run/apply count drift, credential exposure, or an unmet
Phase B precondition. Any integrity/security event is zero-tolerance. Ordinary
denied client mutation can continue only when it matches the expected canary
and does not affect legitimate traffic.

## Rollback / forward-fix decision tree

- **Before Phase A:** abort; no application/database change.
- **After Phase A:** keep additive objects and stricter submission policy;
  pause approvals; deploy the reviewed compatible source forward. Do not
  restore owner UPDATE/upsert.
- **After source deploy:** app rollback is allowed only to a frozen build proven
  Phase-A-compatible. Otherwise pause approvals and forward-fix.
- **During backfill:** stop; already canonical rows and all old sources remain;
  fresh dry-run, remediate, then resume.
- **After backfill:** do not revert paths or delete objects; forward-fix the
  wrapper/RPC and reverify before Phase B.
- **After Phase B:** app or database rollback to the old contract is forbidden;
  pause approvals and use a narrow reviewed forward migration/source fix.

## Production access separation

**Human owner action:** confirm project, backup/recovery evidence, access
identity, observation window, anomaly counts, Phase B approval, and emergency
stop. **Automatable safe action:** local hash verification, read-only aggregate
catalog gate, redacted inventory, canary checks, and local rehearsal.
**Code/agent action:** prepare/review immutable artifacts and report results;
no production credential or unsupervised mutation. **Must remain manual:**
secret entry, production migration release, hosting release approval, backfill
apply authorization, and Phase B authorization.

Never send an AI a database URL/password, service/secret key, access token,
JWT, signed URL, backup, production row, or media. Owner-controlled Dashboard
may be used for independently reviewed metadata checks or SQL only when the
deployment stage explicitly authorizes it. A reviewed script may receive a
short-lived credential from Viktor's local secret channel; it must not persist
or print it.

## Controlled command plan status

The local preflight and rehearsal commands are frozen:

```powershell
# SAFE READ — local candidate only
git branch --show-current
git rev-parse HEAD
git status --short
$manifest = Get-Content docs/security/SEC-001_DEPLOYMENT_ARTIFACT_MANIFEST.json -Raw | ConvertFrom-Json
$manifest.artifacts | ForEach-Object {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.path).Hash
  if ($actual -ne $_.sha256) { throw "SEC-001 artifact hash mismatch: $($_.path)" }
}

# LOCAL MUTATION — disposable Docker/Supabase only; never remote
$env:ALAMIN_SECURITY_LOCAL_ONLY = '1'
node tests/security/sec001-deployment-rehearsal.mjs
Remove-Item Env:ALAMIN_SECURITY_LOCAL_ONLY
```

Expected output is
`SEC001_DEPLOYMENT_REHEARSAL_PASS RUN1=20 RUN2=20 FAIL=0`; any other result is
a stop. The runner sanitizes remote variables and destroys only its projects.

The existing `scripts/release/sec001/START_SEC001_RELEASE.bat` must not be used
against the remote backend as written. Its assumed hosting step does not exist.
Applicable controls may be reused only in a redesigned and reviewed
consolidated pre-launch backend release. Raw `psql`, Dashboard paste,
`supabase db push`, linked mode, or a guessed hosting command remains forbidden.
P0-12 did not set the approval flag, create an identity package, request a
secret, or contact production.

## Completion evidence

SEC-001 is `LOCAL_VERIFIED_AWAITING_CONSOLIDATED_PRELAUNCH_BACKEND_RELEASE`.
Recovery and applicable local release-operation rows are proven; live evidence
remains pending. It may be marked fixed live only after the authorized
Phase A/inventory/backfill/zero-pass/Phase B backend sequence, full canonical
coverage and reviewer sign-off. Source provenance and public canaries belong to
the later first application deployment. Old source media remains retained until
separate SEC-006 lifecycle and SEC-013 restore evidence authorize deletion.
