# AL-AMIN Bootstrap Baseline Verification

Date: 2026-08-11

Starting Git HEAD: `a14f69dd4ed6713e95e09b33ac779d7e644c1e09`

Branch: `security/hardening`

Candidate ID: `alamin-no-data-v1`

## 1. Decision and scope

Result: **VERIFIED_BOOTSTRAP_BASELINE_READY**.

The package under `supabase/bootstrap/` is the Strategy C application
bootstrap for **new empty local, CI, and future staging environments only**.
It is not a production migration, does not replace the remote migration
history, and must not be applied to an existing AL-AMIN catalog.

The 18 files under `supabase/migrations/` remain unchanged and are classified
as `LEGACY / PROVENANCE ONLY / NOT FOR FRESH BOOTSTRAP`.

## 2. Evidence and provenance

The baseline was reconstructed from:

- the redacted live catalog evidence and reconciliation;
- the 26-finding live-evidence adjudication;
- the final tracked Git definitions for functions, views, triggers, policies,
  constraints, and grants;
- read-only structural analysis of `supabase/schema.sql` and all historical
  migrations;
- current application source and architecture/dependency documentation.

`supabase/schema.sql` was **not executed** and is not treated as the source of
truth. Only its pre-demo structural prefix was used as provenance while the
standalone baseline was generated in dependency-correct order. Demo rows and
all later data seed/backfill operations were removed.

Where live evidence confirmed an interface but did not capture a body, the
provenance is `GIT_IMPLEMENTATION_LIVE_INTERFACE_CONFIRMED`. No function body
was invented from a signature.

## 3. Package

- `supabase/bootstrap/baseline.sql` — transactional fail-closed application
  bootstrap; SHA-256
  `CF61CDB37D9B82B3AFFFF035A0EAF68B1FABC2022C261F87027AE95583C153E1`;
- `supabase/bootstrap/manifest.json` — expected contract plus the exact
  normalized catalog captured from clean replay #2;
- `supabase/bootstrap/verify.sql` — read-only fail-closed assertions;
- `supabase/bootstrap/README.md` — isolation, execution, provenance, and
  cleanup contract.

The bootstrap guard aborts if any AL-AMIN application relation already exists.
It creates no Auth users, application rows, Storage objects, user paths, or
site-content rows. The only top-level data statements create/update the two
deterministic Storage bucket metadata rows (`avatars` and `profile-media`).

## 4. Clean-room configuration

Disposable detached worktree:

`C:\Users\1\Documents\Codex\_alamin_bootstrap_b4_20260811_1`

Detached commit:

`a14f69dd4ed6713e95e09b33ac779d7e644c1e09`

Toolchain:

- Supabase CLI `2.113.0` stable;
- Docker Engine `29.7.2`, `desktop-linux`, WSL 2;
- Supabase Postgres image `17.6.1.158`;
- PostgreSQL server `17.6`.

The isolated runner configurations disabled migrations and seed, used
PostgreSQL major 17, contained no remote project reference or production
credential, and used separate project IDs and port sets:

- replay #1: `alamin-b4-r1-20260811`, ports `55320`–`55329` plus `58083`;
- replay #2: `alamin-b4-r2-20260811`, ports `56320`–`56329` plus `59083`.

Supabase CLI 2.113.0 cannot execute this multi-statement file through
`db query --file` because it sends the file as one prepared statement. The
verified execution path therefore streamed the SQL into `psql` inside the
project-specific local Postgres container as the built-in `supabase_admin`
role. No database password or remote connection was used. That role is needed
to reproduce the live-confirmed default privileges owned by both `postgres`
and `supabase_admin`.

## 5. Candidate corrections before the accepted replays

Two candidate-generation defects and one execution-principal mismatch were
found before acceptance:

1. five removed-seed markers contained a literal PowerShell `` `n`` token;
2. the legacy demo-boundary extraction incorrectly produced an empty
   structural prefix, so `public.applications` was missing;
3. the non-superuser local `postgres` role could not alter default privileges
   owned by `supabase_admin`.

Only the candidate generator/baseline execution procedure was corrected.
Every failed SQL attempt was transactional, and the project-specific database,
containers, volumes, and network were destroyed before retry. Historical
migrations, `schema.sql`, source, package files, and security findings were not
changed.

## 6. Replay results

### Replay #1

Result: **PASS**.

- application relations before apply: `0`;
- baseline transaction: committed;
- read-only `verify.sql`: `VERIFIED_BOOTSTRAP_MANIFEST_PASS`;
- public application tables: `15`;
- public policies: `38`;
- `storage.objects` policies: `7`;
- Auth users: `0`;
- Storage objects: `0`;
- required Postgres, Auth, PostgREST/Data API, Kong, and Storage services:
  running and responsive.

The optional Vector service restarted independently of the required acceptance
surface. It did not block database, Auth, Data API, or Storage readiness.

### Replay #2

Result: **PASS** on a new project ID, new ports, and new Docker database volume.

- application relations before apply: `0`;
- baseline transaction: committed;
- read-only `verify.sql`: `VERIFIED_BOOTSTRAP_MANIFEST_PASS`;
- loopback readiness: Auth `200`, PostgREST `200`, Storage `200`;
- Auth users: `0`;
- Storage objects: `0`.

No state from replay #1 was reused.

## 7. Manifest reconciliation

Result: **PASS**.

The normalized replay #2 catalog was captured twice with metadata-only queries;
the two `verified_catalog` values matched exactly. Summary:

- 4 application enums;
- 15 public application tables;
- 182 columns with types, nullability, defaults, identity/generated state;
- 99 PK/FK/unique/check constraints;
- 31 valid/ready indexes, 25 unique;
- RLS enabled on all 15 tables; FORCE RLS disabled on all 15;
- 38 public policies and 7 `storage.objects` policies, including expressions;
- 32 public functions, 18 `SECURITY DEFINER`, with signatures, return types,
  configuration/search paths, and effective EXECUTE roles;
- 4 public views with definitions and security options;
- 19 public triggers with exact definitions;
- relation grants and default privileges for the application catalog;
- 2 bucket metadata rows with public/private state, limits, and MIME types;
- local `pgcrypto` `1.3` (the live extension version remains unknown).

The manifest comparison excludes Supabase-managed internal objects outside the
AL-AMIN scope and never compares production rows.

## 8. Security fidelity

The baseline deliberately reproduces the adjudicated pre-hardening state for:

`SEC-001`, `SEC-002`, `SEC-003`, `SEC-004`, `SEC-007`, `SEC-008`, `SEC-015`,
`SEC-016`, `SEC-017`, `SEC-018`, `SEC-023`, `SEC-025`, and `SEC-026`.

These entries are marked as known findings in the SQL/manifest. They are not
fixed by this package. Their presence preserves the measurable before-state
for later forward-only hardening migrations and role-matrix regression tests.

Local database lint found no schema errors. Local advisors reproduced expected
pre-hardening signals: 4 security-definer-view errors and 26 warnings (8 Auth
RLS init-plan, 10 multiple-permissive-policy, and 8 mutable-search-path
findings). No advisor result was changed during this stage.

## 9. Existing tests

- tracked database test files: `0` — **DATABASE TEST HARNESS ABSENT**;
- existing Node test suite: `85/85 PASS`;
- TypeScript typecheck: `PASS`;
- ESLint: `PASS` with 12 existing warnings and 0 errors.

No dependency was installed or updated. No role-matrix harness was created.

## 10. Secret, PII, and content review

Result: **PASS**.

The baseline package and this report contain no production rows, profile or
application content, personal email, user UUID, Auth user, Storage object path,
JWT, API key, database credential, OAuth secret, production project reference,
or private key.

Content-like literals retained inside Git-derived function definitions were
reviewed as deterministic validation/notification template constants; they are
not user/site content or seeded rows. The ten redacted live `site_content`
defaults are intentionally absent, and `site_content` is empty after replay.

## 11. Remaining provenance limitations

- the live extension version was not captured; local replay verified
  `pgcrypto` 1.3 from the pinned stack;
- ten live `site_content` default literals were redacted and are omitted by the
  no-data rule;
- live function bodies were not exported; final Git bodies are used only where
  their live signatures/security/search-path interfaces were confirmed;
- Auth provider, email-confirmation, MFA, and session settings remain
  non-SQL configuration expectations and are not simulated by the bootstrap;
- Supabase-managed internal catalogs are outside the application manifest.

These limitations do not prevent local role-matrix harness construction, but
they remain explicit and cannot be represented as live-confirmed SQL equality.

## 12. Cleanup and next gate

Both disposable project states are removed project-specifically with
`--no-backup`. Cached official Docker images are retained. The detached
worktree is removed after verification. No remote Supabase command, linked
mode, production credential, production read, or production mutation was used.

Approved next stage after this commit:

**P0-02C — local role-matrix security test harness.**
