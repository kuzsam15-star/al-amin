# SEC-001 Production Readiness

Date: 2026-08-13

Starting commit: `d498bbbb5a2d3cc7c675add9cb68c424b8406387`

Verdict: `READY_FOR_CONTROLLED_PRODUCTION_DEPLOYMENT`

No production or remote Supabase action was performed. This gate evaluates
operational readiness only; it does not change the locally verified SEC-001
implementation and does not close the live finding.

## 1. Decision

The SEC-001 implementation remains independently verified locally. Recovery
Level 3 and the controlled release-operations boundary are now proven locally.
Production execution still requires a new, explicit owner approval in P0-13.
The former three release-operation gaps are closed as follows:

1. **Migration provenance:** exact SHA-256-checked Phase A/Phase B files are
   applied by an isolated pinned client; catalog markers and the external
   checkpoint record the verified state without replaying the 18-file archive.
2. **Source release provenance:** the checkpoint freezes the runtime Git SHA,
   the existing hosting owner deploys exactly that SHA, and a read-only version
   marker must match before canary.
3. **Backfill operations:** the dry-run-first core now has a short-lived
   identity model, redacted durable checkpoint, 1/10/25 sequential batching,
   zero-change second pass, observation gate and exact production invocation.

The owner wrapper, external checkpoint/identity model, frozen release manifest,
short-lived identity lifecycle, aggregate backfill gates, observation gate and
Phase B hard gate are specified in `SEC-001_RELEASE_OPERATIONS.md` and pass two
independent disposable rehearsals. This readiness result is not live closure.

## 2. Evidence reviewed

- SEC-001 change, local verification, adversarial review, deployment rehearsal,
  and deployment runbook;
- live metadata evidence and adjudication (no new live query was made);
- verified no-data bootstrap and both forward migrations;
- publication source, media paths, server-only Supabase client, role matrix,
  backfill core, and rehearsal runner;
- roadmap/finding evidence for SEC-012 release provenance and SEC-013
  backup/restore readiness;
- current official Supabase guidance: database restore-to-new-project does not
  copy Storage objects/settings and requires manual reconfiguration of several
  project settings; daily backups/PITR provide different recovery windows.

## 3. Deployment order

| Step | Action | Entry evidence | Stop condition | Actor |
|---:|---|---|---|---|
| 0 | Preflight and pause approvals | project/commit/hashes/owners/window verified | any mismatch or unknown | Human owner + release operator |
| 1 | Recovery gate | dated DB restore plus separate Storage/config restore proof | missing artifact, failed reconciliation, unacceptable RPO/RTO | Operations + DB/Storage owner |
| 2 | Phase A | exact migration hash; approved version-recording runner | schema drift, migration failure, wrong identity | DB owner |
| 3 | Phase A verification | exact objects/ACLs/triggers; legacy reads intact | missing object, broader mutation, broken read | Security + DB owner |
| 4 | Compatible source deploy | signed/pinned artifact and rollback target | build/hash mismatch, health failure | Source release owner |
| 5 | New-flow canary | canonical upload/publication/read and client denials | overwrite, broken profile, mutation success | App/Storage owner |
| 6 | Aggregate dry-run inventory | stable redacted counts and zero blocking anomalies | count drift or any blocked category | Backfill operator + reviewer |
| 7 | Backfill dry-run/apply | approved wrapper, checkpoint, batch and stop controls | integrity/auth/source/hash/DB error | Backfill operator |
| 8 | Coverage verification | zero legacy/anomaly, active provenance/object, second pass zero | any non-zero gate | Security + DB/Storage owner |
| 9 | Observation window | agreed duration and healthy metrics | any emergency stop signal | Observer + stop authority |
| 10 | Phase B | signed machine gate and exact hash | unmet gate or transaction failure | DB owner |
| 11 | Post-verify/closeout | constraints/canaries/serving/monitoring pass | unexplained regression | Security + change owner |

The order matches the final runbook. Phase A is additive/dual-compatible for
legacy reads but causes old publication code to fail closed, so approvals stay
paused until the matching source passes. Phase B is last.

## 4. Recovery gate

### Required artifacts

- a database recovery point created before Phase A, with timestamp, retention,
  completion state, recovery method, and named owner;
- an isolated database restore report with schema, functions, policies, grants,
  role/Auth-row scope, counts/hashes, duration, achieved RPO/RTO, and gaps;
- a separate encrypted, access-controlled Storage object recovery artifact;
- an isolated Storage restore report reconciling bucket metadata and restored
  object counts, bytes, and content hashes without exposing paths or media;
- a redacted configuration inventory and tested reconstruction checklist for
  Auth, Storage, hosting, redirects, session controls, and operational access;
- last-known-good and SEC-001 application build artifacts tied to commits.

PITR is required if the accepted recovery point must be inside the deployment
window and a daily backup cannot meet that RPO. PITR does not replace separate
Storage/config recovery. Evidence that a backup exists is insufficient; an
isolated restore must succeed.

### Current status

`READY`. Production-derived database/Auth/Storage recovery passed twice: 47
tables, five Auth users, and 36 Storage object hashes reconciled. Configuration
Level 3 passed twice with 67 classified fields, seven complete secret-source
mappings, 48 exact manual checklists, zero critical unknowns, and a successful
complete-project-loss walkthrough. RPO/RTO are approved. SEC-013 is
`RECOVERY_READINESS_PROVEN`; the release-operation gates below remain blocked.

## 5. Artifact freeze

`docs/security/SEC-001_DEPLOYMENT_ARTIFACT_MANIFEST.json` contains SHA-256 for:

- Phase A and Phase B;
- the backfill core and deployment rehearsal;
- every SEC-001 runtime source file changed by the implementation/review plus
  the active upload/source/view routes;
- the deployment runbook.

The manifest identifies commit
`d498bbbb5a2d3cc7c675add9cb68c424b8406387` and is a local candidate freeze,
not a release authorization. Any mismatch blocks deployment. The verified
pre-hardening baseline, manifest, schema.sql, and all 18 historical migrations
remain outside the release payload and must remain byte-identical.

## 6. Compatibility matrix

| State | Result | App rollback | DB rollback | Approvals |
|---|---|---|---|---|
| Old DB + old app | `SAFE` but vulnerable | normal pre-change | not applicable | existing flow, SEC-001 open |
| Phase A DB + old app | `DEGRADED-BUT-SAFE` | already old; do not use for approvals | no destructive rollback | paused |
| Phase A DB + new app | `SAFE` | only to reviewed Phase-A-compatible build | forward-fix | enabled after canary |
| Partial backfill + new app | `DEGRADED-BUT-SAFE` | same restriction | forward-fix | new approvals canonical |
| Complete backfill + new app | `SAFE` | same restriction | forward-fix | enabled |
| Phase B DB + new app | `SAFE` | only to Phase-B-compatible build | forward-fix only | enabled |
| Phase B DB + old app | `BLOCKED` | explicitly forbidden | explicitly forbidden | pause and forward-fix |

The unrequested but critical state old DB + new app is also `BLOCKED`: required
RPCs do not exist. The rollback policy never restores mutable owner overwrite,
deletes canonical/legacy media, or rewrites applied migrations.

## 7. Production assumptions and validation

| Assumption | Evidence | Confidence | Required preflight validation |
|---|---|---|---|
| Required public/auth/storage objects and column types still match | redacted live catalog captured before this stage | High historically; current drift unknown | same-day metadata-only catalog/hash comparison |
| Bucket is `profile-media`; canonical bucket remains private | live bucket metadata + tracked source | High historically | metadata-only bucket/config check |
| Existing published paths may be mutable legacy paths | confirmed live policy/source flow | Confirmed class; current count unknown | aggregate dry-run only |
| Every legacy path maps to one owner/reference | required by design, not proved for rows | Unknown | aggregate anomaly inventory; zero ambiguity |
| Source bytes exist and are decodable | not captured by metadata evidence | Unknown | owner-run redacted dry-run, no media output |
| No untracked production-only path family exists | Git and known flow only | Medium/unknown | path-family aggregate classifier; unknown family stops |
| Current deployed app is compatible with Phase A | no hosting/release artifact | Unknown | identify deployed build and compare exact contract |
| Forward versions can be recorded safely | no production runner/history plan | Unknown | owner-approved migration-history/release rehearsal |
| Recovery meets the change window | Level 2 DB/Auth/Storage PASS x2; Level 3 config PASS x2; approved RPO/RTO | High for capability | verify a fresh pre-change generation/checkpoint before Phase A |

No assumption that depends on production rows/media was tested here.

## 8. Dry-run and backfill contract

The only permitted output is aggregate metadata: examined/legacy/canonical,
missing, corrupt, unsupported, duplicate, ownership/provenance conflict,
canonical conflict, planned/applied/remaining/retry/unchanged. User/row IDs,
paths, emails, content, bytes, linked hashes, tokens, and signed URLs are
forbidden.

Allowed legacy count is whatever two identical dry runs produce and a human
approves. Every anomaly category must be zero before apply. Any dry-run/apply
count difference stops the deployment. A second apply must report zero planned
and zero applied before Phase B.

The conservative provisional run is one canary, then batches of 10, maximum
25, concurrency 1, with an observation interval between canary and batch.
Integrity/security errors have a zero error budget. A clearly transient
network/platform error may be retried twice with bounded backoff; a third
failure stops the batch. The old source is never deleted.

Current status: `READY_LOCAL`. The core and owner wrapper prove idempotent
re-inventory, 1/10/25 sequential batching, external checkpoint/resume and safe
cutover locally. Production counts and signals remain P0-13 evidence.

## 9. Machine-checkable Phase B gate

The final gate must emit only scalar aggregate counts and must require all of
these values to be zero:

- approved application legacy/unproven references;
- published specialist legacy/unproven references;
- active provenance without canonical Storage metadata;
- canonical references without active owner/entity provenance;
- missing/corrupt/unsupported/ambiguous/conflicting rows;
- canonical hash verification failures;
- second-pass planned/applied changes;
- new-flow canary failures and unresolved monitoring stop signals.

The Phase B SQL independently rechecks the two database legacy/provenance
conditions in one transaction and aborts before constraints. It cannot certify
Storage recovery, byte hashes, second-pass behavior, or monitoring, so owner
sign-off on the external scalar gate remains mandatory.

## 10. Production-safe verification

- **After Phase A:** exact version/hash, ledger/functions/triggers/policies/ACLs,
  old profile rendering, and no broadened mutation.
- **After source:** one synthetic canary uses canonical path/provenance, bytes
  remain after source dereference, client mutation is denied, public serving
  works, and errors/logs are redacted.
- **After backfill:** zero legacy and anomaly counts, object/provenance coverage,
  old source retained, public media health, and zero-change second pass.
- **After Phase B:** validated constraints, legacy write rejection, canonical
  approval success, public serving, and unchanged non-SEC-001 finding ledger.

These are future owner-approved checks. None was run against production here.

## 11. Monitoring and stop conditions

Observe approval/canonicalization/backfill failures, media load failures,
Storage 4xx/5xx, DB constraint errors, unexpected owner mutation attempts,
missing-media reports, and queue age. Stop immediately for project/hash drift,
unknown path family, overwrite, broken media, DB-before-copy behavior,
unexpected error spike, successful client canonical mutation, source deletion,
material count drift, credential exposure, or any non-zero Phase B gate.

Do not proceed to Phase B until at least 30 minutes, two application approvals,
one revision approval and zero unresolved error/alert signals are evidenced.
No monitoring stack was added; the criteria and owner checklist are
`READY_LOCAL`, while live signals remain `NOT_YET_PROVEN`.

## 12. Rollback / forward-fix summary

- before Phase A: abort normally;
- after Phase A: retain additive security objects, pause approvals, deploy a
  compatible source forward;
- after source: roll back only to a proven Phase-A-compatible build;
- during/after backfill: stop/resume; keep canonical references and all sources;
- after Phase B: no old-app or destructive DB rollback; forward-fix only.

No response may restore owner upsert/UPDATE, delete canonical/old source media,
or rewrite an applied migration.

## 13. Production access plan

| Action | Classification | Who |
|---|---|---|
| Confirm project, recovery artifacts, owners, window and approvals | `HUMAN OWNER ACTION` | Viktor/change owner |
| Verify local commit/hashes and run disposable rehearsal | `AUTOMATABLE SAFE ACTION` | Reviewed local runner |
| Collect pre-approved aggregate metadata/canary evidence | `AUTOMATABLE SAFE ACTION` under owner control | Restricted operator script |
| Enter short-lived secrets and authorize Phase A/source/backfill/Phase B | `MUST REMAIN MANUAL` | Viktor and named owners |
| Prepare/review artifacts and interpret redacted evidence | `CODEX/AGENT ACTION` | Agent without credentials |

Database URLs/passwords, service/secret keys, access/refresh tokens, JWTs,
signed URLs, backups, rows, and media must never be sent to AI/chat/Git/logs.

## 14. Readiness checklist

Status meanings: `READY` or `READY_LOCAL` is locally evidenced;
`NOT_YET_PROVEN` needs P0-13 human/live evidence; `BLOCKED` prevents Phase A.

| Gate | Required evidence | Status | Stop condition | Responsible actor |
|---|---|---|---|---|
| PRE-FLIGHT — Git/commit | clean `security/hardening` at frozen commit | `READY` | mismatch/diff | Release operator |
| PRE-FLIGHT — project identity | two-person correct-project confirmation | `NOT_YET_PROVEN` | ambiguity | Human owner |
| PRE-FLIGHT — catalog drift | same-day metadata compatibility | `NOT_YET_PROVEN` | incompatible/unknown drift | DB owner + reviewer |
| PRE-FLIGHT — roles/window | named owners, stop authority, window | `READY_LOCAL`; live assignment pending | missing owner/window | Change owner |
| RECOVERY — database | dated isolated restore and RPO/RTO | `READY` | stale/failed pre-change checkpoint | Operations/DB owner |
| RECOVERY — Storage | independent object restore/hash proof | `READY` | stale/failed pre-change checkpoint | Storage owner |
| RECOVERY — config | tested redacted reconstruction checklist | `READY` | manifest drift or critical unknown | Platform owner |
| PHASE A — artifact | exact frozen migration bytes | `READY` local | hash mismatch | DB owner |
| PHASE A — runner | exact audited migration plus catalog/checkpoint record | `READY_LOCAL` | hash/catalog mismatch | DB owner |
| SOURCE DEPLOY — artifact | checkpoint commit plus read-only version marker | `READY_LOCAL` | version mismatch | Release owner |
| SOURCE DEPLOY — rollback | Phase-A-compatible forward/rollback boundary | `READY_LOCAL` | old incompatible app | Release owner |
| DRY RUN — wrapper | exact restricted redacted inventory command | `READY_LOCAL` | wrapper/hash mismatch | Backfill operator |
| DRY RUN — counts | stable aggregate and zero anomalies | `NOT_YET_PROVEN` | count/anomaly drift | Operator + reviewer |
| BACKFILL — controls | identity, checkpoint, batching, monitoring | `READY_LOCAL` | control mismatch | Backfill/Operations owner |
| BACKFILL — complete | zero legacy and zero-change second pass | `NOT_YET_PROVEN` | non-zero | Reviewer |
| OBSERVATION | 30 min + 2 application + 1 revision + zero errors | `READY_LOCAL`; live evidence pending | unresolved signal | Operations owner |
| PHASE B | signed all-zero gate plus exact migration | `NOT_YET_PROVEN` | any non-zero/unknown | DB owner + Security |
| POST-VERIFY | canary, constraints, serving, monitoring | `NOT_YET_PROVEN` | regression | Security + app owner |
| CLOSEOUT | independent sign-off; SEC-001 live status update | `NOT_YET_PROVEN` | incomplete evidence | Change owner + reviewer |

Live outcome rows remain `NOT_YET_PROVEN`; local tooling rows are now
`READY_LOCAL`. No production execution occurred.

## 15. Controlled command plan

### Released local commands

```powershell
# SAFE READ — local Git and frozen bytes
git branch --show-current
git rev-parse HEAD
git status --short
$manifest = Get-Content docs/security/SEC-001_DEPLOYMENT_ARTIFACT_MANIFEST.json -Raw | ConvertFrom-Json
$manifest.artifacts | ForEach-Object {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.path).Hash
  if ($actual -ne $_.sha256) { throw "SEC-001 artifact hash mismatch: $($_.path)" }
}

# LOCAL MUTATION — disposable local stack only
$env:ALAMIN_SECURITY_LOCAL_ONLY = '1'
node tests/security/sec001-deployment-rehearsal.mjs
Remove-Item Env:ALAMIN_SECURITY_LOCAL_ONLY
```

Expected Git output is branch `security/hardening`, frozen HEAD, and no status
lines. Expected rehearsal output is
`SEC001_DEPLOYMENT_REHEARSAL_PASS RUN1=20 RUN2=20 FAIL=0`. Any deviation stops.

### Owner production launcher (not authorized in P0-12)

P0-13 may use only `scripts/release/sec001/START_SEC001_RELEASE.bat` after an
explicit owner approval. It remains disabled by default, requires the external
identity package and hidden credentials, and exposes each mutation only after
its prerequisites. Guessing `db push`, a Dashboard paste, raw `psql`, or a
hosting command would bypass provenance and can target the wrong state. P0-12
did not run the launcher in production mode.

## 16. Final local rehearsal

The frozen local command runs the existing full deployment rehearsal against
two fresh disposable projects. P0-03C re-ran it after the final runbook was
prepared:

`SEC001_DEPLOYMENT_REHEARSAL_PASS RUN1=20 RUN2=20 FAIL=0`

Project-specific cleanup left `0` matching containers, `0` volumes, `0`
networks, and `0` temporary paths. The first shell capture timed out after five
seconds while its child runner continued; that runner exited and cleaned its
project before the captured verification run began. No overlapping runner or
residual resource was used. This local PASS does not satisfy the remaining
production release-operation gates.

## 17. Release implication

SEC-001 remains
`INDEPENDENTLY_REVIEWED_LOCAL_READY_FOR_CONTROLLED_DEPLOYMENT`; production
readiness is now `READY_FOR_CONTROLLED_PRODUCTION_DEPLOYMENT`. It must not be
renamed `FIXED_LIVE` or `CLOSED` before controlled live execution and evidence.

Recovery and release tooling prerequisites are satisfied. The next stage is
P0-13, which requires explicit owner approval because it will mutate production.
No such approval or production action occurred in P0-12.
