# AL-AMIN Baseline Acceptance Criteria

## 1. Purpose

This document defines the evidence required before a future AL-AMIN bootstrap snapshot can be called verified. The snapshot is intended only for empty disposable local, CI, and future staging environments. It must create the approved no-data database and Supabase security configuration required by the application, then accept only the new post-cutover forward migration track.

It must prove all of the following:

- a fresh local environment can be built deterministically without the legacy `schema.sql` bootstrap or a remote database;
- the resulting object catalog matches the approved security contract, not merely a similar table list;
- no production data, users, credentials, uploaded objects, or hidden configuration are carried into the baseline;
- RLS, grants, views, functions, triggers, Storage, and Auth-related boundaries are preserved or deliberately changed through an approved, testable forward change;
- the environment is suitable for later role-matrix and security-regression tests.

All criteria are fail-closed: missing, inaccessible, redacted beyond verification, or unexplained evidence is a failed acceptance item, not a presumed match.

## 2. Source of truth decision

No existing artifact alone is a complete source of truth. The verified baseline must be derived from the reconciled set below.

| Source | Role in the decision | Cannot be used as |
| --- | --- | --- |
| Live Supabase catalog | Read-only operational evidence of deployed objects, grants, policies, bucket settings, and allowed configuration; subject to separately authorized capture | An unreviewed design authority, because live drift is documented |
| Git source | Versioned evidence of application expectations, current repository provenance, and the future approved baseline/forward-migration contract | Proof that undocumented deployed configuration is absent |
| Existing migrations | Immutable archive of historical intent and dependency evidence | A clean-room bootstrap sequence or complete database definition |
| `supabase/schema.sql` | Evidence of the legacy manual starting schema and missing prerequisites | A source for direct reuse: it contains demo data and stale access rules |
| Security documents | Mandatory security acceptance constraints, findings, test requirements, and non-regression obligations | A substitute for catalog evidence or executable DDL |

**Decision:** before hardening, the working source of truth is the reconciled combination of these sources, with conflicts documented and resolved explicitly. After hardening, the source of truth becomes the versioned, approved no-data bootstrap snapshot, its object manifest, the ordered post-cutover forward migrations, and reproducible CI evidence. The live catalog remains a conformity check, not a replacement for versioned provenance.

## 3. Required captured objects

The future evidence manifest must record object identity, definition or normalized definition, owner where relevant, security-relevant options, and exact grants. It must be sufficient to compare an empty clean-room baseline with authorized read-only operational evidence without copying data or secrets.

### Database

- schemas and exposed-schema configuration;
- extensions and extension versions where material to behavior;
- enums, domains, composite types, sequences, and other required types;
- tables, columns, data types, nullability, defaults, generated expressions, and ownership;
- primary keys, unique constraints, check constraints, exclusions, foreign keys, and validation state;
- indexes, index definitions, and required collation/operator-class details;
- only the structural dependencies needed to build the catalog—never table rows.

### Security

- whether RLS is enabled and whether `FORCE ROW LEVEL SECURITY` applies on every relevant table;
- every policy name, table, command, target role, permissive/restrictive mode, `USING`, and `WITH CHECK` expression;
- database roles that form part of the application boundary and their intended membership model;
- table, column, sequence, schema, function, and view grants for `anon`, `authenticated`, `service_role`, `PUBLIC`, and any application roles;
- default privileges, including the grantor, target object class, grantee, and schema scope;
- explicit revocations required to prevent accidental Data API/RPC exposure.

### Functions

- function names, schemas, argument names/types, return types, language, volatility, and bodies or normalized definitions;
- `SECURITY DEFINER` versus invoker semantics, function owner, and effective `search_path`;
- `EXECUTE` grants and revocations for `PUBLIC`, `anon`, `authenticated`, `service_role`, and internal roles;
- trigger functions and any dependency on Auth, Storage, or privileged tables;
- an explicit review entry for every privileged or externally callable function.

### Views

- view/materialized-view definitions and dependencies;
- `security_invoker`, `security_barrier`, owner, and any definer-like behavior;
- grants and revocations, including Data API exposure implications;
- the intended projection contract: public columns, private columns, and rows that must remain protected by RLS.

### Triggers

- trigger names, tables, timing, events, order where relevant, conditions, and enabled state;
- invoked function, function security posture, and mutation/audit/notification dependency;
- effects on `applications`, `specialists`, `specialist_revisions`, Auth mirrors, email outbox, and Storage-related integrity controls where applicable.

### Storage

- every bucket identifier, public/private setting, file-size limit, allowed MIME types, and any relevant bucket configuration;
- every `storage.objects` policy with command, role, `USING`, and `WITH CHECK` expression;
- object-path ownership rules, moderation/publication boundaries, and grants that permit Storage API operations;
- an explicit statement that bucket configuration and policies are captured, while uploaded objects and user files are not.

### Auth-related configuration

- enabled/disabled provider classes and provider requirements, recorded without client secrets or provider credentials;
- redirect/origin allow-list requirements, email confirmation/recovery flows, and invitation/sign-up policy;
- session/JWT lifetime and refresh-related requirements, cookie/session integration assumptions, and abuse controls;
- MFA/AAL requirements for privileged actions and the boundary between Auth claims and database authorization;
- email-template/SMTP configuration requirements only as redacted metadata—never SMTP passwords, OAuth secrets, users, sessions, tokens, or JWTs.

## 4. No-data requirement

A no-data baseline contains schema and approved security configuration only. It must satisfy all of these rules:

- tables, types, constraints, indexes, functions, views, triggers, policies, grants, buckets, and configuration metadata may exist;
- application rows, profiles, moderators, reviews, complaints, audit events, email notifications, and other operational data must be absent;
- `auth.users`, identities, sessions, MFA factors, refresh tokens, and demo accounts must not be copied or created by the baseline;
- personally identifiable information, production identifiers, support content, moderation notes, backups, exports, and logs must be absent;
- Storage buckets may exist, but Storage objects, user uploads, and production media must be absent;
- legacy demo inserts from `schema.sql` are prohibited;
- any future test data must be created only by separately reviewed disposable fixtures, after bootstrap, and removed by that test environment's cleanup process;
- any static reference data exception must be separately versioned, non-personal, explicitly approved, and treated as a deterministic seed—not silently embedded in the baseline.

The baseline must pass a secret/artifact scan before review and must not contain production URLs, project refs, database passwords, service-role material, OAuth client secrets, SMTP credentials, or reusable JWTs.

## 5. Security acceptance tests

The following checks are mandatory before approval. A pass requires saved, redacted evidence; a test that cannot run is not a pass.

| Test | Acceptance condition |
| --- | --- |
| Clean-room bootstrap replay | Two independent empty disposable local databases accept the approved snapshot with no manual SQL, remote linkage, or production credentials |
| Forward migration replay | Every post-cutover forward migration applies in order after the snapshot; the legacy 18-file archive is not invoked as the new-environment bootstrap |
| Schema inventory diff | Normalized catalog inventory matches the approved object manifest; every difference is classified, reviewed, and accepted |
| RLS verification | Required tables have the expected enabled/forced state; every policy definition, command, role, and predicate matches the manifest |
| Grants/default-privilege verification | Effective grants, revocations, and default privileges match an explicit least-privilege allowlist; no unexplained `PUBLIC`, `anon`, or `authenticated` access remains |
| Function/view verification | Privileged functions, `search_path`, execute grants, view security options, and exposed projections match the approved contract |
| Trigger verification | All required triggers exist, target the approved functions, and preserve audited mutation/workflow boundaries |
| Storage verification | Buckets, public/private state, size/MIME constraints, and `storage.objects` policies match the manifest; no user objects are present |
| Auth-boundary verification | Redacted Auth configuration requirements and application session assumptions are met without copying users or secrets |
| Role-matrix readiness | PostgreSQL, Auth, Data API, and Storage are healthy; the manifest identifies required roles and test fixtures; no known bootstrap blocker remains |
| Local security checks | Local lint/advisor checks, where safely supported, have no unreviewed error-level result; accepted warnings have a documented risk decision |

The baseline is not accepted merely because it applies. It must pass the schema and authorization checks above before any role-matrix harness or security-fix test is built on it.

## 6. Equivalence criteria

Equivalence means security and application behavior are proven equivalent to the approved target contract. It does not mean byte-for-byte preservation of legacy SQL files.

### Must match

- security boundaries for every exposed table, API surface, RPC, view, trigger, function, and Storage operation;
- required schemas, extensions, types, tables, columns, nullability, defaults, constraints, indexes, and foreign keys;
- RLS enabled/forced state and every policy's role, command, `USING`, and `WITH CHECK` behavior;
- least-privilege grants, revocations, default privileges, function execute surface, function `search_path`, and privileged-function semantics;
- view definitions/security options and the public-versus-private column/row projection contract;
- trigger definitions and the integrity, moderation, audit, and workflow effects they enforce;
- Storage bucket configuration, object policies, path ownership rules, and moderation/publication boundaries;
- approved Auth-related control requirements that affect authorization or session security;
- the security acceptance tests and object-manifest evidence required by `SECURITY_FINDINGS.md` and `HARDENING_PLAN.md`.

### May differ

- internal historical migration filenames, ordering artifacts, and timestamps;
- comments, formatting, whitespace, and other non-semantic SQL representation details;
- the physical organization of the new bootstrap track, provided its runner is explicit and no legacy migration is silently reused;
- obsolete legacy implementation details that are demonstrably replaced by an approved, equal-or-stronger security control;
- separately approved synthetic fixture identifiers and non-production test timing.

Any proposed difference outside this list is a mismatch requiring a written decision, threat analysis, rollback plan, and explicit approval before the snapshot can be accepted.

## 7. Forbidden shortcuts

- Do not reuse `schema.sql` directly, including its demo data or stale public/anonymous policies.
- Do not copy production rows, Auth users, Storage objects, backups, exports, logs, or any personal data.
- Do not import a live database dump as a substitute for a versioned no-data baseline.
- Do not disable RLS, weaken policies, broaden grants, or make a view/function public merely to make replay or tests pass.
- Do not use `service_role`, privileged JWTs, or bypass-RLS credentials as a permanent application or test-harness solution.
- Do not change production, remote Supabase migration history, Auth dashboard, Storage configuration, or production data to make a test environment work.
- Do not rename, reorder, edit, or otherwise rewrite the immutable historical migrations.
- Do not declare equivalence from a successful table-only comparison; policies, grants, functions, views, triggers, Storage, and Auth-related controls are mandatory scope.
- Do not treat a failed or unavailable verification as an accepted exception without a recorded risk decision and explicit approval.

## 8. Approval gates

### Gate 1 — Baseline design approved

The source-of-truth decision, no-data scope, object-manifest schema, bootstrap-track boundary, forbidden operations, and acceptance criteria are reviewed. All unknown critical objects or controls have an evidence plan. No SQL is generated or applied at this gate.

### Gate 2 — Baseline generated

Only after Gate 1 approval, a candidate is generated in an isolated disposable worktree. It contains no data or secrets, passes review/secret scan, preserves the immutable legacy archive, and has an explicit rule preventing application to the current production project. Generation alone is not acceptance.

### Gate 3 — Clean-room replay successful

Two empty disposable local replays pass: snapshot, post-cutover forward migrations, normalized inventory diff, RLS/grant/function/view/trigger/Storage checks, and safe local diagnostics. No remote project, production credential, or manual schema patch is used.

### Gate 4 — Security regression tests successful

The approved role-matrix and relevant RLS, RPC, Storage, Auth-boundary, concurrency, rollback, and regression tests pass against the accepted clean-room environment. Any failure blocks promotion and is handled as a new reviewed security change.

## 9. Recommended next action

**P0-02B-B2 — authorized read-only live-catalog evidence capture and reconciliation.**

This future task requires separate explicit authorization because it would contact remote Supabase in read-only mode. It should collect only the redacted object/configuration evidence listed above, compare it with the Git snapshot and security documents, and produce a discrepancy register. It must not execute SQL changes, access production data, copy secrets, alter migration history, or generate/apply a baseline.
