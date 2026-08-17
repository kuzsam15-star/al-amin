# P0-09 Local Verification

## Verdict

`P009_LOCAL_FIX_READY`

SEC-015, SEC-016 and SEC-025 are `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`. The locally implementable privileged-read slices of SEC-010 and SEC-018 are verified, while those findings remain partial for the explicitly listed operational/configuration scope.

## Evidence boundary

- Starting HEAD: `5478423405004ad006c0f4351a655e12b01b0d7b`.
- Environment: two fresh, unique, disposable local Supabase stacks per phase.
- Input: verified no-data baseline, then the complete ordered forward chain through P0-09.
- Data: synthetic only; Auth addresses use `example.invalid`.
- Remote Supabase, production data and production credentials: not used.

## Red phase

Both independent runs returned:

- PASS: 161
- XFAIL: 27
- XPASS: 0
- FAIL: 0
- SKIP: 0

The 15 newly introduced XFAIL were mapped only to SEC-010, SEC-015, SEC-016, SEC-018 and SEC-025. Together with seven existing target mappings they proved view mode, function/default ACL, identity drift and privileged-read failures before the P0-09 migration.

## Final clean-room runs

Both independent post-fix runs returned:

- PASS: 183
- XFAIL: 5
- XPASS: 0
- FAIL: 0
- SKIP: 0
- cleanup: PASS

The five remaining XFAIL are unchanged and map only to SEC-017 (`CAT-008`, `STORAGE-007`, `STORAGE-008`, `STORAGE-009`) and SEC-026 (`CONTENT-004`). No unrelated finding produced XPASS.

## Exact target delta

- Existing mappings removed after proof: `CAT-002`, `CAT-003`, `CAT-004`, `CAT-005`, `CAT-006`, `PROFILE-001`, `AUDIT-004`.
- New red-only P0-09 mappings converted to PASS: `P009-001`, `P009-004`–`P009-009`, `P009-011`–`P009-018`.
- Stable positive contracts: `P009-002`, `P009-003`, `P009-010`.

## Catalog and privilege results

- Four public catalog views: invoker + barrier, exact columns, existing publication filters preserved.
- Base tables: not opened to anon.
- Internal/trigger/service functions: not client-executable.
- Client RPC surface: explicit manifest matches.
- SECURITY DEFINER paths: fixed and `pg_catalog` first.
- Future table/sequence/function probes for both `postgres` and `supabase_admin`: client default privileges absent.
- Unregistered future public view: manifest assertion fails closed.
- DB lint: 0 ERROR / 0 WARN / 0 INFO.
- Security advisors: target delta from 4 ERROR to 0 ERROR; unrelated 8 WARN / 2 INFO remain.

## Identity and privileged reads

- Owner direct mirrored-email UPDATE: denied.
- Future account field: no UPDATE grant and registry mismatch blocks trusted sync until reviewed.
- Trusted local Auth email change: mirror updated and restored through the Auth trigger.
- Ordinary user moderation read: denied.
- Current moderator exact application projection: allowed.
- Revoked moderator with an existing session: denied on the next DB read.
- Admin AAL1 delivery queue: denied.
- Admin AAL2 delivery queue: real local TOTP positive path; recipient/body/template/raw error absent.
- Direct moderator/admin AAL1 base email queue: denied.
- Privileged page: dynamic/no-store and no page-level service client.
- Admin session hint: server-validated user/current membership and `private, no-store` response.

## Application regression

- Node tests: 147/147 PASS.
- Typecheck: PASS.
- ESLint: 0 errors; 12 pre-existing warnings retained.
- Package dependencies and lockfile: unchanged.

## Residual scope

- SEC-010 remains partial: mandatory MFA enrollment/recovery, recent-auth policy, full Auth session downgrade/revocation, multi-tab behavior and remote Dashboard state are not proven locally.
- SEC-018 remains partial: audit completeness for unrelated privileged actions, monitoring, scheduler ownership and provider-level delivery deduplication remain open.
- No live finding is marked fixed; remote catalog verification is required after the consolidated backend deployment.

## Cleanup and integrity

All disposable containers, volumes, networks, local Auth fixtures and run-specific outputs were removed by the harness. Historical migrations, verified bootstrap baseline, manifest, `schema.sql`, package files, main and the baseline tag were not changed.
