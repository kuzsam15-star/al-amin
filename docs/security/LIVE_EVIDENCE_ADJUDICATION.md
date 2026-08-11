# AL-AMIN Live Evidence Adjudication and Baseline Gap-Closure Plan

## 1. Scope and decision rules

**Decision date:** 2026-08-11
**Repository evidence:** `security/hardening` at the actual review start commit
`07004ff24dd2ed79b8843e20481ed6e0d7fff3bf`.
**Operational evidence:** the redacted, metadata-only capture in
`LIVE_CATALOG_EVIDENCE.md` and its reconciliation. No new live query was made
for this adjudication.

This document adjudicates all 26 open findings. It does not claim that any
finding is fixed and does not authorize a production change. Each finding is
assigned exactly one evidence state:

- `CONFIRMED_LIVE` — current live metadata directly demonstrates the unsafe
  boundary or missing control;
- `CONFIRMED_GIT_ONLY` — repository evidence is sufficient, while no live
  runtime assertion is made;
- `CONFIRMED_DRIFT` — live metadata materially differs from the tracked
  intended state;
- `PARTIALLY_CONFIRMED` — one part is proven and another material part remains
  unverified;
- `UNKNOWN` — evidence is currently insufficient;
- `SUPERSEDED` — a later verified control replaces the original condition;
- `FALSE_POSITIVE` — evidence disproves the finding.

An unavailable runtime test is never interpreted as a pass. Severity is copied
from `SECURITY_FINDINGS.md` and is not downgraded. The original launch-blocker
decision remains in force until its test gates pass.

## 2. Adjudication summary

| State | Count | Finding IDs |
| --- | ---: | --- |
| `CONFIRMED_LIVE` | 10 | SEC-001, SEC-002, SEC-003, SEC-004, SEC-007, SEC-010, SEC-015, SEC-016, SEC-023, SEC-026 |
| `CONFIRMED_GIT_ONLY` | 7 | SEC-005, SEC-006, SEC-009, SEC-018, SEC-019, SEC-022, SEC-024 |
| `CONFIRMED_DRIFT` | 1 | SEC-025 |
| `PARTIALLY_CONFIRMED` | 8 | SEC-008, SEC-011, SEC-012, SEC-013, SEC-014, SEC-017, SEC-020, SEC-021 |
| `UNKNOWN` | 0 | — |
| `SUPERSEDED` | 0 | — |
| `FALSE_POSITIVE` | 0 | — |
| **Total** | **26** | **SEC-001–SEC-026** |

There are **21 launch blockers**: SEC-001–SEC-018, SEC-020, SEC-021, and
SEC-025. SEC-019, SEC-022, SEC-023, SEC-024, and SEC-026 retain
their original non-blocker status. Classification changes evidence confidence,
not remediation status.

## 3. Finding-by-finding adjudication

### SEC-001 — Published media can be replaced outside moderation

- **Original:** High; an owner can mutate a canonical published Storage path.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high.
- **Live evidence:** the private `profile-media` bucket still permits an
  authenticated owner to INSERT, UPDATE, and DELETE under the owner's
  submission prefix. Private bucket state does not make published bytes
  immutable.
- **Git evidence:** upload/view routes and Storage policy history rely on the
  same owner path; the proposed immutable-writer boundary is not implemented.
- **Drift evidence:** allowed MIME types are broader live than the latest
  tracked bucket assignment, but the mutation finding does not depend on that
  drift.
- **Launch blocker / required action:** yes; introduce versioned immutable
  object paths and a trusted publication writer, with owner replacement and
  deletion denied after publication.
- **Test gate:** ST-03, ST-04, ST-05, ST-06, ST-07, ST-09, ST-11, ST-12.
- **Dependencies:** accepted P0-02 baseline, disposable Storage fixtures,
  publication transaction, and proven restore path.

### SEC-002 — Application owners can read moderator-only columns

- **Original:** High; an owner row policy exposes the whole `applications`
  relation, including moderation fields.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high.
- **Live evidence:** authenticated table SELECT plus the owner predicate is
  present; RLS filters rows, not columns.
- **Git evidence:** the UI requests a safe field subset, but no database-level
  owner-safe projection or column denial enforces that convention.
- **Drift evidence:** no material live-vs-Git contradiction identified.
- **Launch blocker / required action:** yes; replace base-table owner reads with
  an explicit owner-safe projection or gateway and revoke unsafe base SELECT.
- **Test gate:** DB-02, DB-03, DB-04, DB-23.
- **Dependencies:** accepted baseline, exact field contract, and owner/foreign
  user role fixtures.

### SEC-003 — Moderator privilege boundaries are too broad

- **Original:** High; moderator policies/actions can change protected fields or
  perform admin-only transitions without a strict named boundary.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high.
- **Live evidence:** broad authenticated moderator UPDATE policies exist on
  `specialists` and `verifications`; catalog evidence does not show an AAL2
  database gate.
- **Git evidence:** generic admin actions perform read-then-write mutations and
  lack a complete field/transition allowlist.
- **Drift evidence:** none required for confirmation.
- **Launch blocker / required action:** yes; move each privileged transition to
  a named, allowlisted, audited AAL2 boundary.
- **Test gate:** DB-07, DB-08, DB-16, DB-21, DB-24, DB-25, AU-05, RT-11.
- **Dependencies:** baseline and role harness, approved state machine, AAL2,
  stable audit actor/request identity.

### SEC-004 — Anonymous direct writes bypass feedback controls

- **Original:** High; anonymous/authenticated clients can directly insert
  reviews and complaints, bypassing gateway validation and anti-abuse controls.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high.
- **Live evidence:** client INSERT privileges and permissive INSERT policies
  exist for both `reviews` and `complaints`.
- **Git evidence:** server routes contain validation that direct table writes do
  not traverse.
- **Drift evidence:** none required for confirmation.
- **Launch blocker / required action:** yes; revoke direct client INSERT and use
  one rate-limited, validated gateway with protected-field allowlists.
- **Test gate:** DB-05, DB-06, DB-22, RT-03, RT-04, RT-13, AU-08, OP-13.
- **Dependencies:** baseline/role harness, product decision for anonymous
  feedback, CAPTCHA/rate controls, and retention rules.

### SEC-005 — Database bootstrap is not reproducible

- **Original:** High; the tracked migration chain cannot create the database
  from empty state.
- **Adjudication / confidence:** `CONFIRMED_GIT_ONLY` / high.
- **Live evidence:** the deployed catalog proves objects exist, but it cannot
  prove a clean bootstrap path.
- **Git evidence:** `schema.sql` is a legacy manual prerequisite; the 18-file
  migration archive has missing initial objects and non-topological
  dependencies. Clean-room replay fails before `public.applications` exists.
- **Drift evidence:** live catalog and migration archive are not an executable
  one-to-one history.
- **Launch blocker / required action:** yes; implement Strategy C as a versioned
  no-data bootstrap for fresh environments and a separate forward-only track.
- **Test gate:** MIG-07, MIG-08, OP-08, then the full database role matrix.
- **Dependencies:** local Git provenance, disposable Supabase, accepted catalog
  manifest, pinned runner, and CI evidence.

### SEC-006 — Media garbage collection can fail open

- **Original:** High; cleanup may delete an object still referenced by a
  published or pending state.
- **Adjudication / confidence:** `CONFIRMED_GIT_ONLY` / high for code path;
  runtime referential state remains untested.
- **Live evidence:** object rows/files were intentionally not read; orphan and
  path-reuse state is unknown.
- **Git evidence:** cleanup logic does not fail closed across all reference and
  publication states.
- **Drift evidence:** none established.
- **Launch blocker / required action:** yes; make deletion reference-aware,
  idempotent, auditable, and safe on lookup failure.
- **Test gate:** ST-08, ST-12.
- **Dependencies:** SEC-001 publication model, restore evidence, and fixtures
  covering every reference state.

### SEC-007 — Application submission has a duplicate/race window

- **Original:** High; concurrent submissions can bypass the application-level
  duplicate check.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high for missing invariant;
  exploit execution was not attempted.
- **Live evidence:** index/constraint inventory contains no database invariant
  enforcing the intended single-active-application rule.
- **Git evidence:** the route performs a read/check followed by a separate
  insert and uses an in-memory map rather than a transactional claim.
- **Drift evidence:** none established.
- **Launch blocker / required action:** yes; define active semantics and enforce
  them atomically with a database invariant/transactional API.
- **Test gate:** RT-02, DB-23, EM-04.
- **Dependencies:** baseline, approved state semantics, and concurrency fixtures.

### SEC-008 — Moderation decisions are race-prone

- **Original:** High; parallel approve/reject operations can produce stale or
  inconsistent workflow, audit, and notification results.
- **Adjudication / confidence:** `PARTIALLY_CONFIRMED` / high for missing
  concurrency control, medium for reachable impact.
- **Live evidence:** no versioned decision RPC/locking contract was found in the
  catalog; no mutating race test was run.
- **Git evidence:** admin action reads state and later performs an unconditional
  service-level update with separate side effects.
- **Drift evidence:** none established.
- **Launch blocker / required action:** yes; use one expected-version locked
  transaction for state, audit, publication, and outbox effects.
- **Test gate:** DB-09, DB-18, RT-09, EM-02, EM-04, AD-01, AD-02, AD-03.
- **Dependencies:** baseline/role harness, SEC-003 state machine, atomic audit
  and idempotent outbox.

### SEC-009 — Production dependency vulnerabilities

- **Original:** High; production dependency audit reported four High and two
  Moderate advisories.
- **Adjudication / confidence:** `CONFIRMED_GIT_ONLY` / high at audit snapshot.
- **Live evidence:** deployed dependency versions were not collected.
- **Git evidence:** locked dependency graph and recorded audit evidence confirm
  the affected source snapshot; no package change has occurred in this workstream.
- **Drift evidence:** deployed artifact equivalence is unknown.
- **Launch blocker / required action:** yes; review changelogs, upgrade narrowly,
  regenerate the lock deterministically, and verify runtime/security regressions.
- **Test gate:** OP-01, OP-02, OP-03, OP-04, OP-05, ST-05, ST-06, ST-07.
- **Dependencies:** CI provenance, isolated clean install, and release artifact
  attestation.

### SEC-010 — Privileged actions lack enforced MFA/AAL2

- **Original:** High; moderator/admin actions have no verified AAL2 gate.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high.
- **Live evidence:** TOTP enrollment is enabled, but MFA verification is
  disabled; no effective privileged AAL2 boundary was established.
- **Git evidence:** privileged routes/actions do not consistently require and
  re-check AAL2.
- **Drift evidence:** operational Auth configuration was previously unknown;
  live evidence resolves it as unsafe, not as a fix.
- **Launch blocker / required action:** yes; enable a recoverable MFA flow and
  enforce recent AAL2 at both application and database privileged boundaries.
- **Test gate:** AU-05, AU-07, DB-07, DB-08, DB-16, DB-21, DB-22, DB-23, DB-25.
- **Dependencies:** role harness, moderator/admin fixtures, recovery process,
  SSR session boundary, and approved Dashboard/config change.

### SEC-011 — Auth abuse and leaked-password controls are incomplete

- **Original:** Medium; password compromise and public Auth abuse protections
  are not fully established.
- **Adjudication / confidence:** `PARTIALLY_CONFIRMED` / high for observed gaps,
  low for uncollected controls.
- **Live evidence:** session hardening is disabled and earlier evidence recorded
  leaked-password protection as disabled; CAPTCHA, complete rate limits, and
  provider abuse controls were not fully collected.
- **Git evidence:** application routes cannot substitute for platform Auth abuse
  controls.
- **Drift evidence:** not a schema drift finding.
- **Launch blocker / required action:** yes; complete redacted Auth control
  inventory, enable approved protections, and test signup/login/recovery abuse.
- **Test gate:** AU-06, AU-08, AU-14, RT-03, RT-04, EM-03, EM-04.
- **Dependencies:** Auth Dashboard inventory, edge controls, synthetic accounts,
  and monitoring.

### SEC-012 — Release provenance and control plane are incomplete

- **Original:** High; the audited snapshot lacked verifiable Git/CI/release
  provenance.
- **Adjudication / confidence:** `PARTIALLY_CONFIRMED` / high.
- **Live evidence:** deployed artifact-to-commit provenance was not collected.
- **Git evidence:** a local baseline, tag, and documentation history now exist,
  but protected remote review, required CI, artifact signing, and deploy
  attestation still do not exist as verified controls.
- **Drift evidence:** no proof that production equals the local commit.
- **Launch blocker / required action:** yes; preserve the local baseline and add
  reviewed remote/CI/release provenance without rewriting it.
- **Test gate:** OP-04, OP-06, OP-07.
- **Dependencies:** existing local baseline, later approved remote repository,
  branch protection, CI credentials, and release ownership.

### SEC-013 — Backup and restore are not proven

- **Original:** High; backup existence, recovery scope, RPO/RTO, and restore
  integrity have not been demonstrated.
- **Adjudication / confidence:** `PARTIALLY_CONFIRMED` / high for missing local
  evidence, unknown for provider controls.
- **Live evidence:** backup configuration and restore execution were outside the
  metadata package.
- **Git evidence:** no dated restore report or complete database/Auth/Storage
  recovery runbook is present.
- **Drift evidence:** unknown.
- **Launch blocker / required action:** yes; inventory provider backups and run
  an isolated restore rehearsal including Storage/security verification.
- **Test gate:** OP-09, ST-12, OP-14.
- **Dependencies:** approved isolated restore target, backup access, RPO/RTO,
  secret custody, and incident ownership.

### SEC-014 — SSR session boundary is incomplete

- **Original:** High; the expected Supabase SSR Proxy/session refresh boundary
  is absent, with possible stale-session/reuse behavior.
- **Adjudication / confidence:** `PARTIALLY_CONFIRMED` / high for missing source
  boundary, low for the unexecuted runtime causality hypothesis.
- **Live evidence:** session controls are disabled, but no user/session data or
  deployed request flow was read.
- **Git evidence:** the expected Proxy/middleware refresh boundary is absent.
- **Drift evidence:** deployed hosting behavior is unknown.
- **Launch blocker / required action:** yes; implement the pinned supported SSR
  session contract and prove refresh, revoke, expiry, multi-tab, and cookie behavior.
- **Test gate:** AU-03, AU-04, AU-07, AU-09, AU-14.
- **Dependencies:** exact Next/Supabase SSR contract, staging, safe logs, and
  SEC-020 transport verification.

### SEC-015 — Public views have definer-like behavior

- **Original:** Medium; four client-readable public views do not use invoker
  security.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high.
- **Live evidence:** all four public published views have
  `security_barrier=true`, `security_invoker=false`, and client SELECT grants.
- **Git evidence:** tracked definitions match that posture.
- **Drift evidence:** exact view-owner effects remain uncollected, but the unsafe
  option is confirmed.
- **Launch blocker / required action:** yes; design a safe invoker/API projection
  boundary, migrate callers, and revoke obsolete exposure.
- **Test gate:** DB-10, DB-14, DB-21, OP-11.
- **Dependencies:** accepted baseline, exact public contract, caller inventory,
  and role fixtures.

### SEC-016 — Grants, default ACLs, RPCs, and search paths are over-broad

- **Original:** Medium; opt-out privileges expose current/future relations and
  functions, including privileged helpers.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high.
- **Live evidence:** broad relation/sequence/function defaults and client
  EXECUTE grants exist. Of 130 functions, 32 are in `public`; 21 are SECURITY
  DEFINER and 18 of those are in `public`. Explicit search paths still include
  mutable application schemas.
- **Git evidence:** historical grants and helpers do not define a complete
  opt-in allowlist.
- **Drift evidence:** exact historical cause is unknown; current exposure is not.
- **Launch blocker / required action:** yes; replace defaults with opt-in ACLs,
  revoke non-API EXECUTE, and harden privileged function ownership/search paths.
- **Test gate:** DB-11, DB-12, DB-13, DB-25, MIG-07.
- **Dependencies:** accepted baseline, complete caller/function inventory, and
  full role matrix.

### SEC-017 — Resource and buffering abuse controls are incomplete

- **Original:** Medium; request/media buffering and incomplete ingress limits
  permit memory, bandwidth, provider, or cost abuse.
- **Adjudication / confidence:** `PARTIALLY_CONFIRMED` / high for source
  buffering, unknown for deployed edge enforcement.
- **Live evidence:** bucket size limits exist, but WAF, body limits, quotas, and
  deployed rate controls were not captured.
- **Git evidence:** relevant server paths buffer payloads and lack a complete
  cross-layer resource budget.
- **Drift evidence:** live `profile-media` MIME allowlist is broader than the
  latest tracked assignment.
- **Launch blocker / required action:** yes; define route/storage/edge budgets,
  stream or cap payloads, and add abuse/cost monitoring.
- **Test gate:** RT-01, RT-04, ST-07, ST-09, ST-10, AU-08, OP-10.
- **Dependencies:** production-like staging, edge inventory, telemetry, and
  approved resource ceilings.

### SEC-018 — Audit and multi-write workflows are not atomic

- **Original:** Medium; business mutation, audit, and notification effects can
  diverge, and actor attribution can be missing.
- **Adjudication / confidence:** `CONFIRMED_GIT_ONLY` / high for code paths;
  failure injection was not run.
- **Live evidence:** catalog shows the audit/outbox surfaces and a direct
  moderator audit INSERT path, but no production rows/functions were executed.
- **Git evidence:** multiple actions write state, audit, and queue separately;
  service operations can record a null Auth actor.
- **Drift evidence:** none established.
- **Launch blocker / required action:** yes; use one transaction with explicit
  actor/request identity and idempotent outbox semantics.
- **Test gate:** DB-09, DB-15, DB-18, EM-02, EM-04, AD-01, AD-02, AD-03.
- **Dependencies:** SEC-003/SEC-008 transition API, stable actor/request schema,
  and email idempotency.

### SEC-019 — Supply-chain and remote-test controls are unsafe

- **Original:** Medium; nondeterministic tool execution and dangerous remote E2E
  paths weaken provenance and environment safety.
- **Adjudication / confidence:** `CONFIRMED_GIT_ONLY` / high.
- **Live evidence:** no remote test was run and no production endpoint was used.
- **Git evidence:** unpinned/`latest` execution paths and scripts capable of
  targeting a remote project remain in the snapshot.
- **Drift evidence:** none established.
- **Launch blocker / required action:** no under the original classification;
  pin tools, require environment allowlists and CI isolation before those paths run.
- **Test gate:** OP-05, OP-06, OP-07, OP-15.
- **Dependencies:** isolated test project and CI/provenance controls.

### SEC-020 — Deployed transport, cookie, and edge controls are unverified

- **Original:** Medium; TLS redirect, HSTS, Secure cookies, CSP/CORS/cache and
  hosting behavior lack deployed evidence.
- **Adjudication / confidence:** `PARTIALLY_CONFIRMED` / high for missing source
  headers, unknown for deployed edge controls.
- **Live evidence:** the catalog package did not inspect hosting or HTTP traffic.
- **Git evidence:** a complete explicit security-header/cookie contract is absent.
- **Drift evidence:** deployment configuration may add controls, but is unverified.
- **Launch blocker / required action:** yes; define headers/cookies in source and
  verify the allowlisted deployed staging origin before release.
- **Test gate:** AU-09, AU-10, OP-10, ST-10.
- **Dependencies:** deployed staging/origin and SEC-014 session design.

### SEC-021 — Monitoring, retention, and incident response are incomplete

- **Original:** Medium; security signals, retention, ownership, and recovery
  operations are not end-to-end proven.
- **Adjudication / confidence:** `PARTIALLY_CONFIRMED` / high for repository
  evidence gap, unknown for external operations.
- **Live evidence:** monitoring/log/retention systems were outside the catalog
  capture.
- **Git evidence:** no complete on-call, alert, retention, incident, or queue
  evidence set is present.
- **Drift evidence:** unknown.
- **Launch blocker / required action:** yes; establish redacted events, SLOs,
  alert ownership, retention/legal-hold rules, and a tested incident runbook.
- **Test gate:** EM-02, EM-03, EM-04, OP-09, OP-12, OP-13, OP-14.
- **Dependencies:** restore plan, retention/legal decisions, telemetry, and
  accountable on-call ownership.

### SEC-022 — Safe-revision classifier is structurally weak

- **Original:** Medium; length-based comparison can misclassify equal-length
  harmful changes as safe.
- **Adjudication / confidence:** `CONFIRMED_GIT_ONLY` / high.
- **Live evidence:** no production revision content or execution was read.
- **Git evidence:** classifier relies on length/shape rather than a semantic
  allowlist and field-level policy.
- **Drift evidence:** none established.
- **Launch blocker / required action:** no under the original classification;
  replace with an explicit semantic diff allowlist or require manual review.
- **Test gate:** RT-10.
- **Dependencies:** approved product risk model and adversarial revision corpus.

### SEC-023 — RLS/index performance debt can become a security failure

- **Original:** Medium; expensive policy predicates and missing indexes can
  enable resource exhaustion or unsafe operational workarounds.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high for catalog/advisor
  debt; workload impact still requires measurement.
- **Live evidence:** live policy/index inventory and prior advisor evidence show
  the debt on exposed authorization paths.
- **Git evidence:** migrations do not provide a measured, complete supporting
  index/policy plan.
- **Drift evidence:** exact production query distribution is unknown.
- **Launch blocker / required action:** no under the original classification;
  measure plans on representative non-production data, then change one invariant
  at a time without weakening RLS.
- **Test gate:** OP-11, DB-20, DB-21, DB-22, DB-23, DB-24, DB-25.
- **Dependencies:** realistic staging data, plan baseline, and prior P0 Auth/RLS
  boundary fixes.

### SEC-024 — CSP/logging residual controls are incomplete

- **Original:** Low; CSP and diagnostic/log redaction are incomplete.
- **Adjudication / confidence:** `CONFIRMED_GIT_ONLY` / high for source posture,
  unknown for deployed headers/log sinks.
- **Live evidence:** no HTTP or log collection was performed.
- **Git evidence:** current source/config does not establish the complete target
  CSP and logging contract.
- **Drift evidence:** unknown at hosting layer.
- **Launch blocker / required action:** no; define report-first CSP and structured
  redaction, then verify in staging without collecting secrets or personal data.
- **Test gate:** RT-06, OP-06, OP-10, OP-15.
- **Dependencies:** deployed telemetry/origins and SEC-020 transport inventory.

### SEC-025 — Owner UPDATE policy on the Auth mirror exists live

- **Original:** Medium; an owner can update all columns in its own
  `account_profiles` row, including notification identity data.
- **Adjudication / confidence:** `CONFIRMED_DRIFT` / high.
- **Live evidence:** authenticated UPDATE and policy `Users update own account
  profile` are present with owner `USING` and `WITH CHECK`.
- **Git evidence:** `202607300001_security_hardening.sql` drops this policy and no
  later tracked migration recreates it.
- **Drift evidence:** live state directly contradicts the tracked final intent;
  who or what recreated it was intentionally not investigated via logs/history.
- **Launch blocker / required action:** yes; make the mirror trusted-writer-only
  through a forward production migration after role-matrix proof.
- **Test gate:** DB-17, DB-18, MIG-07, MIG-08.
- **Dependencies:** accepted baseline, P0-04A drift investigation, Auth fixtures,
  and catalog regression monitoring.

### SEC-026 — Public site content exposes `updated_by`

- **Original:** Low; the public base-table projection exposes an operational
  administrator identifier.
- **Adjudication / confidence:** `CONFIRMED_LIVE` / high.
- **Live evidence:** public SELECT exists on base `site_content`, which includes
  `updated_by`; no user row was read to establish this.
- **Git evidence:** tracked policies expose the base relation rather than a
  public-safe projection.
- **Drift evidence:** none required for confirmation.
- **Launch blocker / required action:** no under the original classification;
  serve a narrow public projection and revoke base-table client SELECT.
- **Test gate:** DB-19, DB-14, AU-05.
- **Dependencies:** SEC-015 projection redesign and SEC-010 privileged boundary.

## 4. Confirmed live risk decisions

The following decisions convert catalog/configuration facts into explicit
pre-launch requirements. They remain untested against production rows.

| Live risk | Attack scenario | Impact / likelihood | Pre-launch requirement | Local fix and production action | Rollback strategy |
| --- | --- | --- | --- | --- | --- |
| Anonymous `reviews` INSERT | A client bypasses the application route and submits spam or malformed/protected fields directly | Integrity, abuse cost, moderation load / high | Revoke direct client INSERT; gateway-only validation/rate control | Yes locally; later forward production migration plus gateway deploy | Restore only the minimal gateway grant; never restore anonymous table INSERT |
| Anonymous `complaints` INSERT | A client writes complaints directly, bypassing protected-field and abuse checks | Sensitive workflow pollution and operational DoS / high | Same gateway-only boundary with strict column allowlist | Yes locally; later forward production migration and route release | Forward-fix gateway; do not roll back to broad INSERT |
| Owner media UPDATE/DELETE | Owner replaces or removes already approved bytes at a canonical path | Published-content integrity loss / high | Immutable versioned paths and trusted publication writer | Yes locally; production Storage policy migration/config change after rehearsal | Disable publication writes or switch caller back to prior object version; do not restore mutable canonical paths |
| `account_profiles` owner UPDATE drift | Owner changes trusted mirror fields used by notifications or identity workflows | Identity/workflow integrity / medium-high | Trusted Auth-sync writer only; owner UPDATE denied | Yes locally; separate production forward migration | Restore service writer from exact ACL inventory, not owner-wide UPDATE |
| Four non-invoker public views | Definer-like view execution can bypass intended caller RLS/ownership semantics | Cross-boundary disclosure if view owner/dependencies expand / medium | Safe invoker/API-schema contract and negative role tests | Yes locally; versioned v2 views and caller cutover in production | Keep prior definition only for rapid caller rollback; revoke it after cutover |
| Broad relation/default ACLs | New relation/sequence becomes client-accessible by inherited defaults | Silent future data exposure / medium-high | Empty default ACL and explicit per-object allowlist | Yes locally; small forward production migrations | Reapply exact required object grants only |
| Broad client function EXECUTE | Client invokes internal/trigger/privileged helper as RPC | Privilege or workflow bypass / medium-high | Deny by default; named RPC allowlist with role/AAL checks | Yes locally; forward revocation/allowlist migrations | Restore only verified named RPC EXECUTE grants |
| Mutable-schema `search_path` on SECURITY DEFINER | A resolvable object in a mutable schema shadows an intended dependency | Privileged code execution/data access / medium | Catalog-only/empty path and schema-qualified references | Yes locally; one reviewed function family per production migration | Restore exact prior definition only if availability requires it, then immediate forward-fix |
| `profile-media` MIME drift | Broader JPEG/PNG/WebP live allowlist defeats the tracked WebP-only assumption | Content validation/cache/parser inconsistency / medium | Explicit product-approved MIME contract enforced at route and bucket | Yes locally; production bucket config change only after compatibility inventory | Re-enable only a specifically required MIME type with documented validation |
| MFA verification disabled | Privileged account enrollment does not yield enforced step-up verification | Account takeover reaches moderator/admin controls / high | Verified MFA flow and recent AAL2 at every privileged boundary | Local/staging code and fixtures; later human-approved Auth config and app release | Break-glass recovery with audited temporary restriction, not global MFA disable |
| Single-session disabled | Stolen and legitimate sessions can coexist | Longer attacker persistence / medium | Decide and enforce session concurrency policy for privileged roles | Mostly Auth config plus app UX; no database migration alone | Restore prior session policy only under incident owner approval |
| Session time-boxing disabled | Privileged session can remain valid without a maximum age control | Persistent compromise / medium | Maximum session lifetime and re-auth for privileged actions | Auth config/app handling; no baseline SQL shortcut | Temporary shorter/longer bound via approved config, with monitoring |
| Inactivity timeout disabled | Abandoned privileged session remains usable | Opportunistic session misuse / medium | Idle timeout and recovery-safe re-auth flow | Auth config/app handling; test in staging first | Revert timeout value only if lockout risk is proven; retain AAL2 gate |
| Non-reproducible bootstrap | Fixes cannot be replayed from empty state or tested against a known catalog | Undetected security regressions and unsafe restore/release / certain | Accepted Strategy C baseline and two clean-room replays | Local/CI baseline only; never apply bootstrap to current production | Discard candidate version; production remains untouched |

## 5. Strategy C no-data baseline manifest

The candidate baseline is a reviewed **target contract**, not a dump and not a
copy of every live weakness. Every item has a stable object key, normalized
definition hash, provenance (`live`, `Git`, `approved hardening`, or `managed
Supabase`), and acceptance status.

### 5.1 Database manifest

- pinned Supabase component set and PostgreSQL major 17 compatibility;
- required schemas/extensions/types and their versions, with Supabase-managed
  `auth`, `storage`, `realtime`, and migration internals created by the pinned
  local stack rather than copied from production;
- the 15 application tables in `public`: `account_profiles`,
  `application_events`, `applications`, `audit_log`, `categories`,
  `complaints`, `email_notifications`, `moderators`, `reviews`, `site_content`,
  `specialist_revisions`, `specialist_trust_badges`, `specialists`,
  `trust_badges`, and `verifications`;
- columns/types/nullability/default expressions, enums, sequences, primary,
  unique/check/exclusion constraints, foreign keys and validation state;
- indexes, collations/operator classes where material, object owners and
  dependency order;
- no application rows or literal content values.

### 5.2 Security manifest

- RLS and FORCE RLS state for every exposed/application and Storage table;
- every policy's name, command, roles, permissive/restrictive mode, `USING`, and
  `WITH CHECK` normalized definition;
- schema/table/column/sequence/view/function grants and explicit revocations for
  `PUBLIC`, `anon`, `authenticated`, trusted server roles, and operator roles;
- default privileges set to deny-by-default, with an explicit allowlist;
- role/membership requirements without creating real users or copying role rows;
- approved corrections for SEC-001–SEC-004, SEC-015, SEC-016, SEC-025 and
  SEC-026 must be represented as target-state decisions, not silently inherited
  from the live catalog.

### 5.3 Function, view, and trigger manifest

- all application functions with signatures, return types, language,
  volatility, owner, security mode, normalized body, explicit `search_path`,
  and EXECUTE allowlist;
- all four public published projections and any replacement v2 projections,
  including security options, dependencies, column/row contract, owner and grants;
- every non-internal application trigger: table, timing, event, condition,
  enabled state, invoked function and mutation/audit/outbox effect;
- explicit classification of internal-only, trigger-only, and Data API RPC
  functions; internal helpers are not client executable.

### 5.4 Storage manifest

- `avatars` and `profile-media` bucket identifiers, public/private state,
  object-size limits, approved MIME allowlists and ownership model;
- all application-owned `storage.objects` policies and grants;
- immutable publication-path contract, draft ownership contract, moderation
  transition, quota/validation requirements, and cleanup invariants;
- buckets may be created, but no Storage object or uploaded file is included.

### 5.5 Auth manifest

- redacted provider enablement and email confirmation/recovery/invitation rules;
- redirect/origin allowlist requirements without production URLs or identifiers;
- session maximum age, inactivity and concurrency policy;
- TOTP enrollment and MFA verification requirements, plus recent-AAL2 rules for
  moderator/admin actions;
- leaked-password/CAPTCHA/rate-limit requirements and recovery/break-glass
  ownership;
- no Auth user, identity, session, factor, token, SMTP/OAuth secret, API key,
  password, JWT, or provider credential.

### 5.6 Explicit exclusions

The baseline must exclude production rows, demo users, moderators, profile or
application content, site-content literals, review/complaint/audit/outbox rows,
uploaded objects, Auth users/sessions/factors, logs, backups, emails, personal
identifiers, secrets, tokens, passwords, production project references, host
names, URLs, and reusable environment identifiers. Synthetic fixtures belong
to a separate disposable test package and are never baseline data.

## 6. Cutover model

### 6.1 Three-track repository contract

1. **Immutable historical archive:** the existing 18 migrations keep their
   exact content and hashes. They remain provenance evidence and are never an
   input to a new-environment bootstrap.
2. **Versioned bootstrap track:** a future reviewed location such as
   `supabase/bootstrap/v1/` stores the no-data target DDL/config manifest and an
   explicit empty-database-only runner. Its preflight aborts if core application
   objects exist, if a remote link/project reference is present, or if the
   environment is not an allowlisted disposable local/CI/staging target.
3. **Post-cutover forward track:** a separate ordered location such as
   `supabase/migrations-forward/` contains every change after bootstrap v1.
   The same reviewed file hashes advance clean-room, CI, staging, and—only under
   separate authorization—production.

The final paths and runner are Gate 1 design decisions; no directory is moved
or created by this document. The runner must select exactly one start state:
an empty environment receives bootstrap v1 then all forward files; an existing
deployed environment receives only the separately approved forward files.

### 6.2 Why legacy replay is prohibited

The legacy 18-file chain assumes the manual `schema.sql` bootstrap, references
objects before their creation, and does not encode the true dependency order.
Renaming/reordering it would rewrite historical evidence. Importing
`schema.sql` would also copy stale access rules and demo content. Therefore
neither is an accepted clean-room input.

### 6.3 Production-history protection

- bootstrap v1 has an empty-database guard and no production execution path;
- the current production migration table is not repaired, rewritten, or asked
  to accept the bootstrap identifier;
- each production correction is a new forward migration/config release with an
  exact pre-state inventory, rollback/forward-fix plan, and staging proof;
- staging and production use the same forward artifact hashes, while environment
  credentials and approvals remain separate;
- CI rejects duplicate timestamps/IDs, modifications to the 18 archived hashes,
  a bootstrap file in the production forward set, unexplained catalog drift,
  and default-broadening grants;
- a baseline version marker plus applied-forward manifest prevents accidental
  re-creation and makes a second bootstrap attempt fail closed.

## 7. Pre-launch scope

| Scope | Rule | Findings | Count |
| --- | --- | --- | ---: |
| A — MUST before any real users | Reproducibility, direct data/media/privilege boundaries, atomicity, recovery, session and operational blockers | SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-010, SEC-012, SEC-013, SEC-014, SEC-018, SEC-021, SEC-025 | 15 |
| B — MUST before public release | Dependency, Auth-abuse, projection/ACL, resource and deployed transport controls | SEC-009, SEC-011, SEC-015, SEC-016, SEC-017, SEC-020 | 6 |
| C — CAN after a strictly limited launch | Non-blocker supply-chain hardening, classifier, measured performance debt, public operational metadata | SEC-019, SEC-022, SEC-023, SEC-026 | 4 |
| D — LONG-TERM | Residual CSP/logging refinement after the P0 transport baseline | SEC-024 | 1 |
| **Total** |  | **All findings listed exactly once above** | **26** |

This scope does not authorize a launch with an unresolved High finding. A
"limited launch" decision requires a separate risk acceptance and cannot occur
while any A/B gate is open.

## 8. Ordered hardening sequence

Every stage is one reviewed logical change or a small sequence of explicitly
separated documentation, test, and implementation commits. No stage bundles
unrelated findings.

| Stage | Findings | Objective and likely objects/files | Environment action | Rollback / prerequisites | Exit gate |
| --- | --- | --- | --- | --- | --- |
| P0-02B-B4 | SEC-005, enabling SEC-016 | Generate the Strategy C candidate manifest/bootstrap/runner in a disposable worktree; application catalog, ACLs, functions, views, triggers, buckets, redacted Auth config | Local/CI only; no production action | Discard candidate version; requires approved manifest and pinned local stack | Two clean empty replays, normalized catalog match, no data/secrets |
| P0-02C | All database/Storage/Auth findings as test targets | Build disposable anon/user A/user B/moderator/admin/trusted-server role fixtures and before-state tests | Local only, then isolated staging | Delete fixtures/environment; requires accepted B4 baseline | Role matrix executes deterministically and records expected failures without remote production use |
| P0-03 | SEC-001, SEC-017 | Immutable media paths, trusted writer, route/Storage policy and publication changes | Local, staging, then separate forward production policy/config release | Keep prior object versions; requires Storage fixtures and restore proof | ST-03/04/05/06/07/09/11/12 pass |
| P0-04 | SEC-002 | Owner-safe application projection/gateway; revoke unsafe base SELECT | Local/staging; forward DB migration plus caller deploy | Versioned v2 projection and caller switch; requires exact field contract | DB-02/03/04/23 pass |
| P0-04A | SEC-025 | Remove owner UPDATE from Auth mirror; trusted sync writer | Local/staging; separate forward production migration | Restore only trusted writer ACL; requires drift pre-state and Auth fixtures | DB-17/18 and MIG-07/08 pass |
| P0-05 | SEC-003, SEC-010 | Named AAL2 moderator/admin transitions; specialists, verifications, moderators, actions/RPC/audit | Local/staging; forward functions/policies and app deploy | Feature-disable named actions; requires state machine and recovery | DB-07/08/16/21/24/25, AU-05, RT-11 pass |
| P0-06 | SEC-004, SEC-011, SEC-017 | Gateway-only reviews/complaints with field allowlists and abuse controls | Local/staging; revoke client INSERT and deploy gateway/config | Fail closed or disable intake; never restore broad INSERT | DB-05/06/22, RT-03/04/13, AU-08, OP-13 pass |
| P0-07 | SEC-007, SEC-008, SEC-018 | Atomic submission and decision transactions, version checks, audit and idempotent outbox | Local/staging; forward DB/API release | Disable mutation endpoint or forward-fix; requires approved state semantics | RT-02/09, DB-09/15/18/23, EM-02/04, AD-01/02/03 pass |
| P0-08 | SEC-006 | Reference-aware media garbage collection | Local/staging worker only before production enablement | Disable collector; objects retained rather than unsafely deleted | ST-08/12 and restore rehearsal pass |
| P0-09 | SEC-009, SEC-019 | Narrow dependency/tool upgrades and deterministic build provenance | Isolated install/CI, then staged artifact release | Revert dependency commit/artifact; requires changelog review | OP-01–07/15 and media regression tests pass |
| P0-10 | SEC-010, SEC-011, SEC-014, SEC-020 | Supported SSR session refresh, MFA verification, session/abuse controls, headers/cookies | Local/staging; human-approved Auth/hosting config and app release | Recovery-safe feature/config rollback; never expose secrets | AU-03/04/05/06/07/08/09/10/14, OP-10 pass |
| P0-11 | SEC-013 | Backup inventory and isolated database/Auth/Storage restore rehearsal | Isolated restore target only | Destroy restore target; production remains untouched | OP-09/14 and ST-12 produce dated evidence |
| P0-12 | SEC-018, SEC-021, SEC-024 | Redacted events, alerts, retention ownership and incident runbook | Staging synthetic signals, then production observability config under approval | Disable noisy detector, preserve redaction | EM-02/03/04, OP-09/12/13/14, RT-06 pass |
| P1-01/02 | SEC-015, SEC-016, SEC-026 | Safe public projections, opt-in ACL/default privileges, RPC/search-path hardening | Local/staging; small forward migrations and caller cutover | v2 object rollout and exact allowlist restoration | DB-10/11/12/13/14/19/21/25, OP-11 pass |
| P1-03/04 | SEC-017, SEC-020, SEC-024 | Ingress budgets, WAF/rate controls, CSP/CORS/TLS/cache verification | Production-like staging; approved edge release later | Canary thresholds and report-only CSP rollback | RT-01/04/06, ST-07/09/10, AU-08/09/10, OP-10 pass |
| P1-05–11 | SEC-018, SEC-019, SEC-021, SEC-022, SEC-023, SEC-024 | Complete audit/retention/monitoring, semantic revision checks, measured RLS/index and artifact/log controls | Local/CI/staging; production only per isolated change | One invariant per change with exact prior state | Corresponding HARDENING_PLAN tests and zero unexplained advisor regression |
| P1-12 | All | Independent allowlisted staging review and release adjudication | Staging only; no production DAST | Stop conditions/allowlist defined first | Signed review; no unresolved Critical/High |

## 9. First technical implementation decision

**Exactly one next technical target:** **P0-02B-B4 — verified no-data
bootstrap baseline generation and clean-room replay.**

No isolated live High fix should precede it. The project currently lacks the
reproducible database on which before-state tests, role-matrix assertions,
forward migration rehearsal, and rollback evidence depend. Making a production
policy or function change first would create another unrepeatable state and
increase drift. Production/public launch remains blocked while the confirmed
live risks are open; this sequencing is not risk acceptance.

After B4 and P0-02C pass, the first finding-scoped functional fix remains
**SEC-001 / P0-03** because it is High, live-confirmed, narrow enough for a
versioned Storage/API change, and testable with disposable media fixtures.

## 10. Consistency and decision record

- All SEC-001–SEC-026 appear exactly once in the adjudication section and once
  in the pre-launch scope; counts sum to 26.
- No finding is marked fixed, superseded, or false positive.
- No severity is reduced. All 21 original launch blockers remain blockers.
- Unknown portions of partial findings remain explicitly unverified.
- Strategy C remains consistent with `BASELINE_RECONSTRUCTION_STRATEGY.md` and
  every gate in `BASELINE_ACCEPTANCE_CRITERIA.md`.
- `HARDENING_PLAN.md` remains valid: it already labels SEC-001 as proposed, not
  performed, and requires the reproducible baseline first.
- `SECURITY_ROADMAP.md` is updated only to replace its completed/stale next-step
  pointer with P0-02B-B4.

**Decision:** generate and verify the Strategy C baseline locally before any
finding-scoped production hardening.
**Approved next action:** P0-02B-B4, subject to a separate execution task and
the existing isolation/acceptance gates.
