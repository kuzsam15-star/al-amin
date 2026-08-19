# Consolidated Pre-Launch Backend Deployment Plan

This is one coordinated, owner-approved remote-backend window. It is a plan only: final bundle verification did not contact or mutate remote Supabase. Every secret stays in an owner-held hidden prompt or approved secret store and every evidence record is aggregate/redacted.

## Required ordered window

1. **Owner approval.** Record the approved frozen manifest hash, exact source commit and named operators. No approval means no access or mutation.
2. **Fresh encrypted recovery generation.** Export database and both Storage buckets read-only, encrypt outside Git and authenticate the archive. DB and Storage age must each be `<=24h`; config snapshot must match the approved manifest.
3. **Project fingerprint.** Capture the intended project ref, region, DB/API hosts, catalog marker and bucket set read-only; compare the redacted fingerprint to the owner-approved target. Any mismatch stops the window.
4. **Read-only live catalog capture.** Capture schemas, relations, functions, owners, ACL, RLS/policies, extensions, Auth settings and safe aggregate row/object counts.
5. **Drift reconciliation.** Compare live evidence with the adjudicated catalog and migration preconditions. Unknown relation/function/policy/media drift blocks progression and requires review; it is never auto-accepted.
6. **Frozen bytes check.** Verify the authoritative SEC-001L refreeze in `manifests/PRELAUNCH_FINAL_BUNDLE_MANIFEST_SEC001L.json`, `PRELAUNCH_SOURCE_ARTIFACT_MANIFEST_SEC001L.json`, the updated ten-file forward-migration manifest, package/lock and every migration SHA-256 before executing anything. The earlier manifests remain historical evidence.
7. **Temporary minimum-privilege access.** Create only the exact short-lived operator identities required by the reviewed tools, with expiry and named custody. Record names, never values.
8. **Migration order gate.** Use only orders 1–10 in `PRELAUNCH_FORWARD_MIGRATION_MANIFEST.json`; no generated substitute, skipped file, duplicate timestamp or out-of-order execution is permitted.
9. **SEC-001 legacy inventory.** Run the SEC-001R aggregate inventory for every mutable published reference and source object. The only additional compatibility family is `submissions/<legacy-scope-uuid>/<main|gallery-N>-<object-uuid>.<ext>`; its opaque UUID is not owner evidence. Ownership comes from the exact DB reference, and any unknown, missing, corrupt, conflicting, unsupported, unowned, or cross-owner object blocks the window.
10. **SEC-001 Phase A.** Order 1 is already remotely applied and verified. Reverify its exact catalog/ACL state; do not reapply or reinterpret it.
11. **Application/backend-compatible state.** Keep the public application undeployed; verify local exact-source compatibility and backend-safe canaries against the Phase-A contract before backfill.
12. **SEC-001L forward fix and canonical backfill.** At the preserved `INVENTORY_REVIEWED` checkpoint, apply/verify order 2 only after the exact owner phrase. Then resume the idempotent no-overwrite backfill with the SEC-001R complete-inventory ownership registry and SHA-256 verification. DB references change only after a verified canonical copy; old sources remain.
13. **Zero-change pass.** Re-run inventory/backfill dry-run. Require zero changed, legacy, missing, corrupt, conflict, unsupported and blocked counters.
14. **Auth/config changes.** Owner applies the exact hardened overlay from `CONFIG_RECOVERY_MANIFEST.json`: breached-password capability, password policy, confirmation, TOTP/AAL1 duration, CAPTCHA/rates, session decisions, exact HTTPS URLs and SMTP. Each setting receives a synthetic verification or remains blocking.
15. **Remaining migrations.** Apply orders 4–10 only after Phase B and each predecessor's post-apply check pass. Cleanup remains disabled/report-only.
16. **Phase B gate.** After the required observation/canaries and zero counters, apply order 3 using the exact confirmation. An early attempt, weak confirmation or unresolved alert is denied.
17. **Backend canary.** Exercise safe synthetic owner/moderator/admin-AAL2/service paths, canonical publication, event/audit/outbox and report-only cleanup without public application traffic.
18. **Post-apply catalog verification.** Re-capture catalog/ACL/RLS/default privileges/functions/buckets and reconcile safe aggregate counts and canonical coverage to the expected manifest.
19. **Role/access verification.** Run the approved backend canaries for anon, user, owner, moderator AAL1, admin AAL1/AAL2 and service; any unexpected allow/deny blocks completion.
20. **Credential cleanup.** Revoke/delete every temporary identity/key and verify absence. Missing revocation evidence keeps the window incomplete.
21. **Evidence commit.** Commit only redacted timestamps, aggregate counts, tool/commit/manifest hashes, setting states and safe error codes. No credentials, paths, user data or production identifiers enter Git.

## Exact remote/config gates

| Finding | Target and expected state | Verification | Failure / forward-fix |
|---|---|---|---|
| SEC-010 | Orders 4/8 plus TOTP enabled, AAL1-duration limit enabled and owner-approved session/recovery decisions | privileged no-factor/AAL1 deny; real AAL2 allow; revoked membership deny | keep privileged routes fail-closed; correct config or reviewed forward migration |
| SEC-011 | Auth Email/Attack Protection: breached-password protection where plan supports it, minimum 12 and required character classes, confirmation, CAPTCHA/rates and SMTP | weak/breached synthetic denial, bounded abuse canary, owner-controlled mail receipt | do not open signup/reset publicly; correct Dashboard/provider state |
| SEC-012 | Exact frozen manifests, commit identity and redacted evidence commit | all hashes equal and reviewed commit ancestry exact | stop; rebuild/freeze a reviewed bundle rather than accepting drift |
| SEC-014 | Order 8 plus hosted SSR cookie/session canary after first deployment | refresh, logout, expiry, multi-tab and Auth-log causality | fail closed on private routes; forward-fix exact Proxy/session contract |
| SEC-018 | Orders 6/8, exact event/audit/outbox ACL and atomic decision canaries | state/event/audit/outbox consistency and restricted reads | disable affected action/worker and ship reviewed forward fix |
| SEC-021 | Worker leases/retries, report-only cleanup, approved retention/alert owners | queue health, bounded retry, no secret/PII logs, acknowledged alerts | keep workers disabled/report-only and escalate under incident runbook |

## Stop, rollback and recovery

Stop for target mismatch, stale/missing recovery custody, any hash/catalog drift, advisory or secret exposure, nonzero role-matrix result, media anomaly, incomplete Auth setting, failed post-apply check or unreleased temporary credential. A failed migration transaction is diagnosed before progression. After a committed migration, use a reviewed forward fix; never edit history or restore broad grants. Restore is only to an independently approved recovery target or under the incident runbook. Old SEC-001 sources and previous canonical objects are not deleted during this window.

## Completion evidence

The window completes only when orders 1–21 pass, all temporary credentials are removed, canonical coverage is complete, Auth/config state is reconciled, post-apply catalog and role checks match, and the evidence commit contains no secrets or production identifiers. The subsequent stage is a separate final remote-backend verification.
