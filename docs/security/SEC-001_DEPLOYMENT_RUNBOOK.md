# SEC-001 Deployment Runbook

Status: independently reviewed plan only — no production action authorized
Change: immutable canonical published media

## Preconditions

1. P0-03B independent adversarial review and two local deployment rehearsals
   are complete. P0-03C production readiness approval remains mandatory.
2. Exact production catalog compatibility with Phase A is verified through
   metadata-only evidence; no historical migration is rewritten.
3. Database and Storage backup/restore evidence, change owner, observer,
   maintenance window, monitoring, and emergency stop are approved.
4. The deployed source commit and forward migration hashes are pinned.
5. The operator has an approved short-lived deployment mechanism. Credentials
   are never pasted into chat, Git, arguments, or logs.
6. No Phase B command is scheduled until the backfill exit gate is met.

## Deployment order

1. Freeze media-related moderation decisions for the cutover window.
2. Apply only
   `202608110001_sec001_immutable_published_media.sql` (Phase A).
3. Verify objects, policies, function ACLs, triggers, and current application
   reads without reading user content.
4. Deploy the matching server source. Do not deploy source before Phase A;
   after Phase B, never roll back to a source version without reviewed-version
   RPC parameters and canonical publication support.
5. Run synthetic canary upload, application approval, revision rejection and
   approval, media read, direct client mutation denials, and error redaction.
6. Re-open new moderation decisions. From this point, new approvals must create
   canonical media.
7. Inventory and backfill legacy published references.
8. Apply Phase B only after every exit gate below is satisfied.

## Existing-media inventory (dry-run only)

Inventory metadata only:

- count approved `applications` and published `specialists` whose non-null
  avatar/gallery path is outside `published/`;
- group counts by table and slot, never output owner UUIDs, object paths,
  application text, or media bytes;
- verify every candidate source exists and has an unambiguous owning row;
- report missing, foreign, duplicate, malformed, or multiply referenced paths
  as blockers, not automatic exceptions.

Dry-run is the default and must perform no Storage write or database update.
The complete candidate set and reconciliation counts require human approval.

## Backfill contract

The reviewed owner-operated core is
`tests/security/helpers/sec001-backfill.mjs`. P0-03C must wrap and approve its
runtime identity, checkpoint/monitoring integration, and exact production
invocation before use. The core:

- remains dry-run by default and requires an explicit caller choice to apply;
- use the same decode, WebP canonicalization, SHA-256 path, `upsert=false`, and
  post-upload hash verification as the application writer;
- validate source ownership against the referencing application/specialist;
- checkpoint opaque internal IDs without logging them;
- be idempotent: an identical canonical object is reusable only after hash
  verification, while a conflict stops the item;
- update the database path only after successful copy and provenance
  registration, inside a bounded transaction;
- retain every old source object; deletion is forbidden in this rollout;
- stop on missing source, ownership ambiguity, decode failure, hash mismatch,
  database conflict, credential anomaly, or unexpected result;
- support safe retry and a local synthetic rehearsal;
- emit only aggregate redacted counts and error categories.

No production credential, remote endpoint, or automatic invocation is included.
The backfill was exercised only against synthetic disposable projects.

## Backfill verification and Phase B gate

Phase B may be approved only when all of the following are true:

- legacy-reference inventory count is exactly zero for approved applications
  and published specialists, including every gallery element;
- every active published reference has one matching, non-retired provenance
  record and an existing canonical Storage object;
- sampled and aggregate source/canonical hash reconciliation passes without
  exposing paths or media;
- public profile/media endpoints work for every contract shape;
- owner, foreign user, anon, moderator AAL1, and admin client mutation tests
  deny; controlled application and revision approvals pass;
- no missing media, broken profile, unexplained orphan, or advisor regression
  exists;
- rollback/forward-fix owner and monitoring window are active.

Then apply
`202608110002_sec001_enforce_canonical_published_media.sql`. It fails closed if
legacy or unproven references remain and adds validated owner-aware table
constraints for future rows.

## Deployment failure matrix

| Failure | Safe state | Detection | Action |
|---|---|---|---|
| Phase A succeeds; source deploy fails | Existing rows still readable; approvals paused | Source health/canary | Keep Phase A and deploy compatible source forward |
| Source deploy precedes Phase A | Publication outage, not data bypass | Missing RPC/function | Runbook violation: stop and apply Phase A before retry |
| Backfill stops part-way | Completed rows canonical; failed row unchanged | Remaining/error aggregate | Keep old sources, remediate, dry-run, resume |
| Backfill completes; Phase B fails | Canonical data retained; enforcement incomplete | Transaction error and absent constraints | Forward-fix cause and reapply; do not revert paths |
| App rollback attempted after Phase B | Unsafe/incompatible | Publication canary failure | Prohibit rollback; forward-fix only |

At no stage may rollback delete canonical or old source media, restore owner
overwrite, or rewrite an applied migration.

## Monitoring window

Monitor redacted aggregate rates for:

- canonicalization, upload, verification, and publication failures;
- Storage conflict/retry and missing-source categories;
- broken media responses and moderation queue age;
- direct canonical mutation denials and unexpected policy errors;
- count of legacy, canonical, unregistered, and unreferenced objects.

Do not log tokens, signed URLs, object paths, owner IDs, source bytes, hashes
paired with identities, or request bodies.

## Emergency stop and forward-fix

Stop the rollout immediately on wrong project, credential exposure, unexpected
write scope, broken public media, hash mismatch, policy bypass, Phase B
precondition failure, or incomplete reconciliation.

Safe response:

1. pause moderation publication and backfill;
2. preserve current canonical references and all source objects;
3. do not restore owner UPDATE/upsert or broad Storage DML;
4. correct server/RPC/policy behavior with a reviewed forward fix;
5. rerun the role matrix and reconciliation before resuming;
6. if Phase B was not applied, leave it unapplied; if applied, never rewrite
   it—use a narrow forward migration.

## Completion evidence

SEC-001 can be marked fixed live only after the Phase B gate, full canonical
coverage, production-like role matrix, public media canary, monitoring window,
and independent reviewer sign-off. Old source media remains retained until a
separate SEC-006-safe lifecycle process and restore evidence authorize removal.
