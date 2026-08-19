# SEC-001L — Legacy Contract Canonical-Backfill Forward Fix

## Security issue

- **Finding ID:** SEC-001 deployment forward fix (`SEC-001L`)
- **Название:** canonical backfill compatibility for approved legacy application contract rows
- **Severity / launch blocker:** High; the consolidated deployment remains stopped before backfill/Phase B
- **Roadmap task / workflow priority:** forward-fix the exact fail-closed backfill blocker discovered after remote Phase A
- **Security-инвариант этого change:** an approved legacy application may replace only its exact reviewed source media references with provenance-backed canonical references; its contract version and every non-media business field remain unchanged
- **Owner:** AL-AMIN repository/application owner
- **Dependencies / prerequisites:** remote Phase A applied and verified; Phase B absent; Recovery Level 3; SEC-001R inventory/byte validation; explicit owner authorization `ПОДТВЕРЖДАЮ SEC-001 LEGACY CONTRACT FORWARD-FIX`
- **Status:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_REMOTE_FORWARD_FIX`

## Threat model

- **Actor:** ordinary client, forged service caller, stale/replayed backfill, or operator applying a migration to an unexpected catalog state.
- **Asset / trust boundary:** approved application business contract, canonical media provenance, published DB references, and the Phase-A/Phase-B deployment boundary.
- **Attack path:** reuse a narrow compatibility exception to edit business data; invent a canonical path; change owner/status/contract version; replace already-published media; bypass source-path binding; call the helper directly; apply after Phase B or against a drifted guard.
- **Impact:** unmoderated business/profile changes, foreign-media substitution, or an unverifiable publication cutover.
- **Expected secure behavior:** only the existing service-controlled Phase-A RPC may reach the exception; the row remains approved and legacy; all non-media fields are byte-semantically unchanged; each changed slot has exact active provenance binding old source to new canonical path; any uncertainty rejects the transaction.
- **Confirmed facts:** the remote backfill RPC failed with SQLSTATE `P0001` and the reviewed message fingerprint for `Changed application content must use contract version 2`; Phase A rolled the DB update back; Phase B and all later migrations remain absent.
- **Out of scope:** changing legacy rows to contract version 2, weakening normal content validation, editing Phase A/history, deleting old sources, applying the forward fix remotely in this local stage, or addressing another finding.

## Affected files

- **Database:** `supabase/forward-migrations/20260811000150_sec001_legacy_contract_backfill_compatibility.sql`.
- **Release tooling:** the SEC-001 isolated SQL runner, controller, state/CLI modules, two thin stage wrappers, and exact verification query.
- **Tests:** SEC-001 deployment rehearsal and release-state tests.
- **Evidence:** this record, `SEC-001L_LOCAL_VERIFICATION.md`, versioned SEC-001L manifests, runbook and consolidated deployment plan.
- **Explicitly unaffected:** 18 historical migrations, Phase A/Phase B bytes, verified bootstrap baseline/manifest, `schema.sql`, application source, dependencies/lockfile, main, baseline tag, and remote data/media during this stage.

## Database changes

- **Migration:** `20260811000150_sec001_legacy_contract_backfill_compatibility.sql`, ordered after Phase A and before Phase B.
- **New object:** private SECURITY DEFINER predicate `private.is_sec001_legacy_application_canonical_backfill(public.applications, public.applications)` with `search_path=pg_catalog` and no EXECUTE for PUBLIC/anon/authenticated/service_role.
- **Changed object:** the existing trigger function `public.require_application_contract_v2_on_content_write()` retains all historical checks and adds only the private predicate as an additional condition for the exact media transition. Direct EXECUTE remains revoked.
- **Preflight:** Phase A objects and the reviewed historical guard must exist; Phase B must be absent unless this exact migration is already present.
- **Idempotency:** the isolated runner detects ABSENT/PRESENT/PARTIAL and does not re-execute a present reviewed object set.

## Before state

- **Case:** `LEGACY-V1-RED-PHASE-REPRODUCED`.
- **Environment:** two disposable local Supabase stacks; synthetic owner/application/image only.
- **Result:** the exact Phase-A backfill RPC returned SQLSTATE `P0001` with `Changed application content must use contract version 2`; the application path remained unchanged. No unexpected FAIL/XPASS occurred.
- **Production evidence handling:** only a safe error fingerprint/status was retained; no production row, path, UUID, media, credential, or PII entered Git.

## After state

- **Allowed:** service-controlled RPC replaces an approved legacy row's unchanged source avatar/gallery slots with exact `published/<owner>/backfill-applications/<application>/...` paths already registered in `private.published_media_assets` with matching slot/source/entity/owner.
- **Denied:** direct helper/RPC bypass, contract-version change, owner/status/business-field change, removal/addition/cardinality change, changed already-published source, absent/retired/mismatched provenance, wrong namespace or non-service JWT.
- **Failure mode:** transaction rolls back; current published reference remains unchanged; canonical no-overwrite orphan is safe and old sources remain.
- **Concurrency:** the existing Phase-A RPC row lock and optimistic expected-path checks remain authoritative.

## Tests

| Case | Expected | Result |
|---|---|---|
| exact legacy-v1 RPC before fix | reviewed P0001, no DB cutover | PASS ×2 |
| migration apply and repeated apply | one reviewed state, no duplicate/drift | PASS ×2 |
| same descriptor retry after fix | canonical path committed | PASS ×2 |
| business contract preservation | contract version 1 and full name unchanged | PASS ×2 |
| service-JWT non-media update | denied, row unchanged | PASS ×2 |
| complete SEC-001 deployment rehearsal | Phase A → SEC-001L → backfill → Phase B → remaining chain | 29/29 PASS in each run |

## Rollback / forward-fix

Do not edit or remove an applied migration and do not restore the broad pre-fix path. Before remote apply, stop normally. After remote apply, keep the narrow guard and either retry the unchanged backfill or ship another reviewed forward fix. Phase B stays blocked until canonical coverage and the zero-change pass succeed. Old source and orphan canonical objects are retained until the existing cleanup/recovery contract allows action.

## Commit

- **Planned message:** `fix(security): allow canonical backfill for legacy contracts`
- **Branch:** `security/hardening`
- **Production release status:** pending a new exact owner gate; not applied by this change record
