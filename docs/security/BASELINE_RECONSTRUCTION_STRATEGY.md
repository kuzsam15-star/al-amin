# AL-AMIN Baseline Reconstruction Strategy

## 1. Current problem

The repository cannot reproduce the database from an empty local Supabase database by replaying `supabase/migrations/` in timestamp order. The clean-room attempt stopped at `202607280001_accounts_media_publication.sql` with SQLSTATE `42P01`: `public.applications` did not exist.

This is a release-provenance and recovery problem, not evidence that the currently deployed database must be changed. A new environment can otherwise be created from a stale or incomplete shape, with different RLS, grants, views, functions, Storage policies, or Auth-related controls.

The required outcome is a no-data, reproducible bootstrap for future disposable local, CI, and staging environments. It must not rewrite production migration history or be applied to the existing production project.

## 2. Confirmed root cause

- `public.applications` is created in `supabase/schema.sql`, not by any of the 18 tracked migrations.
- The first migration alters and queries `public.applications`; it therefore cannot start from an empty database.
- `202607280002_product-test-fixes.sql` adds columns that `202607280001_accounts_media_publication.sql` already expects.
- `public.specialist_revisions` is created in `202607290009_specialist_revisions.sql`, but is referenced by earlier `202607290002`, `202607290003`, and `202607290004` migrations.
- Timestamps are unique, but their chronological order is not a valid dependency order.
- `schema.sql` describes a legacy manual SQL Editor bootstrap. It includes demo data and earlier public/anonymous access rules, and does not represent a verified current secure baseline.

The confirmed cause is therefore a missing initial migration baseline combined with semantic ordering defects in the historical migration sequence. The evidence supports that the former deployment path was a manual `schema.sql` bootstrap followed by selected historical changes, not a clean Supabase CLI replay.

## 3. Current sources of truth

| Source | Current role | Limitation |
| --- | --- | --- |
| `supabase/schema.sql` | Evidence of the original manual bootstrap and initial base objects | Legacy artifact; includes demo data and stale access controls; not a secure current baseline |
| `supabase/migrations/` | Immutable archive of later intended database changes | Not replayable from empty state and not a complete bootstrap contract |
| Git snapshot and security documents | Auditable record of the available source, findings, and intended hardening | Cannot prove the exact deployed catalog or undocumented configuration |
| Live Supabase catalog | Operational evidence of what is currently deployed | May include manual drift; must be captured read-only and reconciled, not accepted blindly as design truth |

At present, no single file is the full source of truth. The working truth is the reconciled combination of the Git snapshot, documented security requirements, and—only after separate authorization—a read-only catalog capture of the deployed environment.

After hardening, the source of truth should be a versioned, no-data, verified bootstrap snapshot plus an ordered set of forward-only migrations, an object manifest, and clean-room CI evidence. The live catalog then verifies deployment conformance; it does not replace the versioned contract.

## 4. Candidate strategies

### Strategy A — Add one new baseline migration to the existing migration directory

**Description.** Add a migration with an earlier timestamp that creates the missing initial schema, then replay the existing 18 files after it.

**Advantages.** It appears simple and retains the familiar Supabase CLI migration layout.

**Disadvantages and risks.** An earlier migration can collide with the migration history recorded by existing environments. A snapshot of the current schema would also collide with historical `CREATE`, `ALTER`, policy, trigger, grant, and data statements. A minimal baseline would need to contain objects and columns from later files merely to satisfy earlier dependencies, which is not a historically faithful starting state. The result is highly sensitive to accidental use against production.

| Criterion | Assessment |
| --- | --- |
| Safety | Low |
| Risk of changing production | High if it is ever recognized as unapplied by an existing project |
| Implementation complexity | High |
| Effect on the current project | Alters the canonical migration lineage |
| Supabase compatibility | Superficial, but migration-history compatibility is unsafe |
| Automated CI replay | Potentially possible only after extensive compatibility work |
| Further security testing | Unreliable until every duplicate and ordering effect is proven absent |

### Strategy B — Keep historical migrations unchanged and add a separate compatibility bootstrap layer

**Description.** Preserve the 18 files exactly, create a no-data prerequisite layer outside the existing production migration path, then apply the historical sequence after that layer only in new disposable environments.

**Advantages.** Historical files remain intact and production is insulated when the layer is explicitly limited to a new-environment runner. It can expose the precise prerequisite contract required by the archived history.

**Disadvantages and risks.** The prerequisite layer must contain some objects that historically appear later: for example `applications` columns needed by `202607280001` and `specialist_revisions` needed before `202607290002`–`004`. It must avoid defining any object whose later statement is not safely idempotent. Intermediate historical policies may temporarily recreate insecure access states. The exact layer cannot be trusted until it passes repeated clean-room replay and catalog comparison.

| Criterion | Assessment |
| --- | --- |
| Safety | Medium, conditional on strict isolation and verification |
| Risk of changing production | Low when kept outside the production migration path; high if misused |
| Implementation complexity | High |
| Effect on the current project | Keeps history, but adds a special bootstrap runner and maintenance burden |
| Supabase compatibility | Possible, but not a plain `db reset` workflow without an explicit bootstrap mechanism |
| Automated CI replay | Possible after a deterministic runner and acceptance manifest exist |
| Further security testing | Possible, but tests would still traverse legacy intermediate states |

### Strategy C — Create a verified no-data bootstrap snapshot only for new environments

**Description.** Create a new, separately versioned and explicitly named bootstrap track for disposable local, CI, and future staging environments. It represents the approved target schema at a defined cutover, contains no production data or credentials, and is followed only by new forward migrations. The 18 historical migrations remain immutable archival evidence and are not replayed by the new-environment path.

**Advantages.** It cleanly separates the non-replayable legacy history from a testable future contract. It avoids reintroducing known stale anonymous/public policies during replay, gives CI a single deterministic empty-database path, and can support role-matrix and regression testing. Existing production receives only separately approved forward changes after the cutover; it never runs the snapshot.

**Disadvantages and risks.** A snapshot cannot be called verified until its object catalog is reconciled with an authorized read-only capture of the deployed database and the approved hardening requirements. A new bootstrap track requires explicit tooling and release discipline so that the old migration directory cannot be run by mistake. It does not by itself repair security findings.

| Criterion | Assessment |
| --- | --- |
| Safety | High after catalog reconciliation and clean-room acceptance |
| Risk of changing production | Low: the snapshot is never applied to the existing project |
| Implementation complexity | Medium–High |
| Effect on the current project | Preserves legacy history and creates a clearly separated future contract |
| Supabase compatibility | High when the bootstrap runner and post-cutover migration track are explicit and pinned |
| Automated CI replay | High: empty database → verified snapshot → forward migrations → tests |
| Further security testing | High: stable base for role matrix, RLS, RPC, Storage, and regression tests |

### Strategy D — Reorder, rename, or rewrite the historical migrations

**Description.** Change timestamps and/or contents so the existing 18 files form a chronological dependency order.

**Advantages.** It could make the current directory look like a conventional migration history.

**Disadvantages and risks.** Existing Supabase migration history is keyed by migration versions; reordering or renaming files makes repository history diverge from deployed history. Rewriting DDL can silently change production semantics, hide provenance, create duplicate objects, and invalidate rollback assumptions. It also changes evidence needed for the security audit.

| Criterion | Assessment |
| --- | --- |
| Safety | Very low |
| Risk of changing production | Very high |
| Implementation complexity | Very high |
| Effect on the current project | Rewrites the historical evidence and migration lineage |
| Supabase compatibility | Unsafe for an already deployed project |
| Automated CI replay | Possible only in a newly discarded project, not as a safe production strategy |
| Further security testing | Delayed and potentially invalidated by history rewrite |

This option is acceptable only for a never-deployed, disposable project with no production data or history. That condition does not apply to AL-AMIN.

## 5. Recommended strategy

**Recommend Strategy C: a separately versioned, verified, no-data bootstrap snapshot for new environments, followed by a new forward-only migration track.**

This is the safest way to preserve the 18 historical files without asking production to reinterpret old timestamps or execute a newly introduced initial migration. It makes the clean-room contract explicit: an empty disposable database receives the approved snapshot once, then only post-cutover forward migrations. The legacy files are retained for provenance and audit, but are not used as a new-environment bootstrap.

Strategy A is rejected because putting a baseline into the existing migration directory creates a direct migration-history and duplicate-object risk. Strategy B is retained only as an analytical fallback: it may be useful to model prerequisite dependencies, but its special runner would replay legacy insecure intermediate states and is harder to prove safe. Strategy D is rejected because it rewrites deployed history.

The recommendation has important limits:

- It is not authorized to create or apply the snapshot yet.
- It must not contain production data, real users, secrets, service-role material, or environment-specific Auth credentials.
- It must be reconciled with the authorized deployed catalog before being described as production-equivalent.
- It must not replace the existing production project's recorded migration history.

The future bootstrap must preserve, as applicable:

- extensions, types, tables, columns, defaults, constraints, indexes, sequences, ownership, and required grants/default privileges;
- RLS enabled/forced state and every policy's command, role, `USING`, and `WITH CHECK` expression;
- views and their security options; functions, signatures, language, `SECURITY DEFINER`/`INVOKER`, `search_path`, and execute grants; triggers and trigger functions;
- Storage bucket configuration and Storage object policies, but never uploaded user objects or production data;
- Auth-related configuration such as provider enablement, redirect allow-list, MFA/AAL controls, password/abuse settings, and email configuration as a redacted configuration manifest—not user accounts, sessions, SMTP passwords, or OAuth client secrets.

No baseline object may silently lose an RLS policy, a privilege revocation, a security option on a view, a trigger, a restrictive function grant, a Storage policy, or an Auth control. Demo inserts and stale public/anonymous policies from the legacy `schema.sql` must not become part of the future baseline merely because they appear in the old artifact.

## 6. Required future steps

This is a plan only; none of these actions are authorized or performed by this document.

1. Define a read-only acceptance manifest: required objects, security properties, object owners, grants, RLS policies, views, functions, triggers, Storage bucket/policy configuration, and redacted Auth configuration.
2. Obtain separate authorization for a read-only catalog capture of the deployed Supabase project. Capture schema and configuration evidence without production data, secrets, or changes, then reconcile it against the Git snapshot and security findings.
3. Classify every difference as intended hardening, legacy drift, missing repository provenance, or unknown. Do not copy a live object into source until its purpose and security posture are reviewed.
4. Design the isolated bootstrap track, its explicit runner, its location, its version marker, and its rule that the old migration directory is archival rather than a new-environment input.
5. Generate a no-data candidate snapshot only in a disposable worktree; review all security-sensitive DDL and configuration manually.
6. Prove empty-environment reproducibility at least twice: snapshot, post-cutover forward migrations, schema manifest comparison, local lint/advisors where safely supported, and no seed unless a separate synthetic seed is approved.
7. Run the approved role-matrix, RLS, RPC, Storage, Auth-boundary, concurrency, and rollback tests against that clean-room environment.
8. Require an explicit change review and a forward-only production release plan. Production changes, if later authorized, must be independent migrations with restore/rollback evidence; the bootstrap snapshot must never be applied to the current production project.

A baseline can technically be drafted without production access, but it would be only a provisional Git-derived design. It cannot be honestly certified as equivalent to the deployed system without authorized read-only catalog reconciliation.

## 7. Security impact

| Area | Effect of the recommended strategy |
| --- | --- |
| Clean-room | Produces one deterministic, no-data path from empty local database to an approved schema |
| CI | Enables repeatable replay, catalog assertions, and a release gate for schema/provenance regressions |
| Role matrix | Provides the stable PostgreSQL, Auth, Data API, and Storage substrate needed before role fixtures and security tests are created |
| Regression testing | Makes RLS, grants, views, SECURITY DEFINER functions, RPC, Storage policies, concurrency controls, and future hardening testable after every forward change |
| Future releases | Separates production forward migrations from new-environment bootstrap and preserves a reviewable diff/rollback record |

Until this work is completed, SEC-005 remains open and blocks claims of reproducible restore, fully verified release provenance, or safe role-matrix coverage. The strategy also supports, but does not itself resolve, the other open security findings.

## 8. Decision record

**Date:** 2026-08-10

**Decision:** Recommend Strategy C: a separately versioned verified no-data bootstrap snapshot for new environments, plus post-cutover forward migrations; keep the existing 18 migrations immutable as historical evidence.

**Reasoning:** It has the lowest production-history risk, avoids replaying a stale and non-topological legacy chain, and creates the clearest path to deterministic CI and security testing.
**Approved next action:** P0-02B-B1 — baseline evidence and acceptance-criteria review (read-only; requires a separate task authorization).
