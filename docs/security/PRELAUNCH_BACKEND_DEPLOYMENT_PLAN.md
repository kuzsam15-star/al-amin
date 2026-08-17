# Consolidated Pre-Launch Backend Deployment Plan

This is one coordinated owner-approved window. It is a plan only: P0-10 did not contact or mutate remote Supabase.

## Preconditions and stop conditions

1. Final clean-room bundle freeze passes at the exact reviewed commit and both manifests match.
2. Create a fresh encrypted DB + Storage generation outside Git; authenticate it and prove age <= the approved 24-hour RPO.
3. Record the intended remote project fingerprint read-only; a mismatch stops the window.
4. Reconcile the live catalog, roles, grants, policies, extensions, Auth settings and safe aggregate row/object counts read-only.
5. Stop for drift, missing recovery custody, advisory, secret exposure, nonzero unexpected role-matrix result, non-canonical media that cannot be owned/hashed, or an unavailable rollback/forward-fix owner.

## Exact application order

Use `PRELAUNCH_FORWARD_MIGRATION_MANIFEST.json` and verify every SHA-256. Apply order 1 only after preflight. SEC-001 order 2 is conditional: first run existing-media inventory/backfill dry-run, apply the idempotent no-overwrite backfill, verify canonical bytes/hashes and zero remaining mutable published references, then apply Phase B. Continue orders 3–9 only in manifest order. Never edit applied history or substitute a regenerated file.

Keep media cleanup worker disabled/report-only through migration and observation. Old SEC-001 sources and previous canonical objects are not automatically deleted.

## Owner-only configuration actions

- Apply the exact Auth Dashboard desired state from the recovery manifest: leaked-password protection/plan capability, password policy, email confirmation, TOTP/AAL1 duration, CAPTCHA and conservative Auth rate limits, session controls, exact HTTPS Site URL/redirect set and SMTP.
- Re-enter secret values only in approved Dashboard/provider/hosting secret stores. No secret appears in command lines, Git or evidence.
- Create temporary identities/keys only with minimum privileges and expiry; record names, never values; remove them before closing the window.

## Verification and evidence

After each phase run read-only catalog/hash assertions and the approved backend-safe role canaries. Verify owner/moderator/admin/AAL/service boundaries, public projections, exact RPC ACL, default privileges, Storage policies, canonical media coverage, event/audit/outbox consistency and cleanup report-only results. Record only aggregates, timestamps, commit/manifest hashes and redacted safe error codes.

Perform an owner-controlled Auth canary for confirmation, breached/weak-password denial where available, TOTP enrollment/AAL2, revoked membership and redirect exactness. No public application traffic exists yet, so application-origin behavior is deferred to first hosting.

## Completion, rollback and emergency stop

The window completes only after post-apply catalog verification, aggregate reconciliation, Auth/config verification and credential cleanup. If a migration transaction fails, stop and diagnose before proceeding. If a post-commit incompatibility is found, keep affected routes/workers fail-closed and use a reviewed forward fix; do not restore broad grants or overwrite migration history. Restore is only to a separately approved recovery target or under the incident runbook—never an improvised production command.
