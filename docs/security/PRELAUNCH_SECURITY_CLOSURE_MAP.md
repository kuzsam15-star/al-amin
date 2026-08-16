# AL-AMIN Pre-Launch Security Closure Map

## Current position

AL-AMIN is pre-launch: the Next.js application is local-only, no public hosting exists, and remote Supabase is a live backend that has not received the local hardening series. Locally verified implementation now includes SEC-001, SEC-002, SEC-003, SEC-004, SEC-006, SEC-007 and SEC-008. SEC-010 and SEC-018 are partial.

After P0-08 the role matrix is **158 PASS / 12 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**. Remaining XFAIL are: SEC-015 (1), SEC-016 (3), SEC-025 (2), SEC-017 (4), SEC-026 (1), and the shared SEC-010/018 case (1).

## Remaining local implementation packages

### Package 1 — P0-09 Catalog, identity and privileged-read closure

- **Findings:** remaining SEC-010/018, SEC-015, SEC-016, SEC-025. SEC-026 may be removed only if independently adjudicated; it is not a launch blocker.
- **Goal:** security-invoker public views, exact grants/default privileges/RPC execute, mirrored-profile immutability, AAL2/recent-auth boundary for privileged private reads, and complete audit evidence for the approved sensitive surface.
- **Expected matrix delta:** seven launch-blocker XFAIL to PASS. The single SEC-026 XFAIL may remain post-launch.
- **Dependencies:** current forward-migration chain and role matrix.
- **Completion gate:** two clean-room runs; no unrelated XPASS; exact catalog diff; direct-client bypass denial; Node/type/lint/advisors/cleanup PASS.

### Package 2 — P0-10 Resource, Auth and release-control closure

- **Findings:** SEC-017 plus evidence/reconciliation for SEC-005, SEC-009, SEC-011, SEC-012, SEC-013, SEC-014, SEC-019 and SEC-021. Hosting-dependent SEC-020 is prepared but cannot be finally proved before first deployment.
- **Goal:** bounded streaming/resource controls and WebP-only contract; dependency/supply-chain gate; Supabase SSR proxy/session contract; Auth abuse/MFA enrollment evidence; reconcile verified bootstrap and Recovery Level 3 into the finding ledger; freeze consolidated release provenance and operational monitoring/retention gates.
- **Expected matrix delta:** four SEC-017 XFAIL to PASS. Evidence-only findings require their own objective gates and are not marked closed by matrix counts alone.
- **Dependencies:** Package 1; owner-approved versions/config decisions, but no production mutation during local implementation.
- **Completion gate:** local tests and advisories pass, dependency gate documented, recovery/provenance evidence reconciled, consolidated backend bundle frozen, no production/remote mutation.

## Remote and hosting finish line

1. **One consolidated pre-launch backend deployment:** read-only preflight and backup checkpoint; apply the complete forward chain; perform required SEC-001 backfill; Phase B enforcement; deploy backend-compatible source when hosting is created; enable cleanup only after observation.
2. **One final backend verification:** live metadata, role-boundary probes approved for production, canonical coverage, cleanup report-only/worker health, Auth/config and rollback gates.
3. **First hosting deployment and hosting-dependent verification:** configure the chosen provider later, deploy the application once, then prove SEC-020 headers/cookies/cache/TLS and final public smoke tests.

No source-version marker or hosting configuration is needed before a hosting provider and first deployment exist. Remote Supabase is not itself a deployed application.

## Post-launch backlog

SEC-022 (semantic safe-revision classification), SEC-023 (policy/index performance), SEC-024 (residual CSP/logging) and SEC-026 (admin UUID in public content) can remain post-launch only with their current severity/acceptance recorded. They must not be represented as fixed. Any Package 1/2 evidence that raises severity reopens the launch decision.

## Answer to the finish-line question

- **Major local security packages remaining:** 2.
- **Consolidated remote backend stages remaining:** 2 (one deployment and one final backend verification).
- **Hosting-dependent stage:** 1 first-deployment verification after a provider is selected.
- **Return to product/design/hosting work:** after P0-10 freezes a locally verified consolidated bundle. Product/design work may resume then; public launch remains blocked until the consolidated backend deployment, backend verification and first-hosting verification all pass.

## Next stage

`P0-09 — catalog, identity and privileged-read closure`.
