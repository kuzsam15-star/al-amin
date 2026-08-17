# AL-AMIN Pre-Launch Security Closure Map

## Current position

AL-AMIN is pre-launch: the Next.js application is local-only, no public hosting exists, and remote Supabase is a live backend that has not received the local hardening series. Locally verified implementation now includes SEC-001, SEC-002, SEC-003, SEC-004, SEC-006, SEC-007, SEC-008, SEC-015, SEC-016 and SEC-025. SEC-010 and SEC-018 are partial.

After P0-09 the role matrix is **183 PASS / 5 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**. Remaining XFAIL are SEC-017 (`CAT-008`, `STORAGE-007..009`) and SEC-026 (`CONTENT-004`).

## Remaining local implementation packages

### Completed package — P0-09 Catalog, identity and privileged-read closure

- **Findings:** SEC-015, SEC-016 and SEC-025 implemented locally; the locally implementable privileged-read scope of SEC-010/018 implemented. Their Dashboard/session-revocation and operational monitoring residual remains explicit.
- **Evidence:** two final clean-room runs at 183 PASS / 5 unrelated XFAIL / 0 XPASS / 0 FAIL / 0 SKIP; DB lint 0/0/0; advisors 0 ERROR / 8 WARN / 2 INFO; cleanup PASS.

### Remaining package — P0-10 Resource, Auth and release-control closure

- **Findings:** SEC-017 plus evidence/reconciliation for SEC-005, SEC-009, SEC-011, SEC-012, SEC-013, SEC-014, SEC-019 and SEC-021. Hosting-dependent SEC-020 is prepared but cannot be finally proved before first deployment.
- **Goal:** bounded streaming/resource controls and WebP-only contract; dependency/supply-chain gate; Supabase SSR proxy/session contract; Auth abuse/MFA enrollment evidence; reconcile verified bootstrap and Recovery Level 3 into the finding ledger; freeze consolidated release provenance and operational monitoring/retention gates.
- **Expected matrix delta:** four SEC-017 XFAIL to PASS. Evidence-only findings require their own objective gates and are not marked closed by matrix counts alone.
- **Dependencies:** completed P0-09; owner-approved versions/config decisions, but no production mutation during local implementation.
- **Completion gate:** local tests and advisories pass, dependency gate documented, recovery/provenance evidence reconciled, consolidated backend bundle frozen, no production/remote mutation.

## Remote and hosting finish line

1. **Final full clean-room bundle:** after P0-10, replay the complete frozen local chain and application tests once as the deployment candidate.
2. **One consolidated pre-launch backend deployment:** read-only preflight and backup checkpoint; apply the complete forward chain; perform required SEC-001 backfill; Phase B enforcement; deploy backend-compatible source when hosting is created; enable cleanup only after observation.
3. **One final backend verification:** live metadata, role-boundary probes approved for production, canonical coverage, cleanup report-only/worker health, Auth/config and rollback gates.
4. **First hosting deployment and hosting-dependent verification:** configure the chosen provider later, deploy the application once, then prove SEC-020 headers/cookies/cache/TLS and final public smoke tests.

No source-version marker or hosting configuration is needed before a hosting provider and first deployment exist. Remote Supabase is not itself a deployed application.

## Post-launch backlog

SEC-022 (semantic safe-revision classification), SEC-023 (policy/index performance), SEC-024 (residual CSP/logging) and SEC-026 (admin UUID in public content) can remain post-launch only with their current severity/acceptance recorded. They must not be represented as fixed. Any completed or remaining package evidence that raises severity reopens the launch decision.

## Answer to the finish-line question

- **Major local security packages remaining:** 1 — P0-10.
- **Consolidated remote backend stages remaining:** 2 (one deployment and one final backend verification).
- **Hosting-dependent stage:** 1 first-deployment verification after a provider is selected.
- **Return to product/design/hosting work:** after P0-10 and the final full clean-room bundle freeze the consolidated candidate. Public launch remains blocked until the consolidated backend deployment, backend verification and first-hosting verification all pass.

## Next stage

`P0-10 — Resource, Auth and release-control closure`.
