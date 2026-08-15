# AL-AMIN Local Role-Matrix Security Test Harness

Date: 2026-08-13

## 1. Architecture

The harness under `tests/security/role-matrix/` is a self-contained Node.js 24
integration runner. It uses built-in Node modules, built-in `fetch` through the
already installed Supabase client, and the existing `@supabase/supabase-js`
dependency. No dependency or lockfile change is required.

Each full invocation creates two independent local Supabase projects and uses:

- the pinned Supabase CLI 2.113.0;
- Docker Desktop's local `desktop-linux` context;
- PostgreSQL 17 from the local Supabase stack;
- the verified no-data `supabase/bootstrap/baseline.sql`, followed by sorted
  reviewed files in `supabase/forward-migrations/`;
- local Auth, PostgREST/Data API, Kong, and Storage;
- synthetic Auth users, rows, and generated image buffers.

The 18 historical migrations are not replayed. They remain immutable
provenance. `supabase/schema.sql` is not executed.

## 2. Local-only safety

The runner fails closed unless `ALAMIN_SECURITY_LOCAL_ONLY=1` is set for the
current process. It independently verifies the pinned baseline hash, CLI
version, local Linux Docker context, loopback endpoints, disposable project-ID
prefix, and absence of a Git remote.

Known remote Supabase and database environment variables are removed before
the CLI or tests are started. The runner does not read `.env.local`, does not
use a project ref, and never invokes login, link, linked mode, pull, push,
dump, or migration repair. Local anon and service keys remain in process memory
and are never printed or written into the repository.

Temporary configuration enables local TOTP enrollment and verification solely
inside the disposable project. It disables migrations, seed, and optional UI,
observability, realtime, Edge Runtime, and pooling services. PostgreSQL, Auth,
PostgREST, Kong, and Storage remain required.

## 3. Roles

The active matrix distinguishes:

- `ROLE-ANON`;
- `ROLE-USER-A`;
- `ROLE-USER-B`;
- `ROLE-OWNER` (user A acting on owned records and Storage paths);
- `ROLE-MODERATOR-AAL1`;
- `ROLE-ADMIN-AAL1`;
- `ROLE-ADMIN-AAL2` using a real local TOTP challenge and verified AAL2
  session;
- `ROLE-SERVICE-BACKEND`, used only for local setup and post-attempt evidence.

The service role never substitutes for a user-boundary assertion.

## 4. Fixture model

All fixtures are generated inside the disposable environment. Emails use
`example.invalid`; names and text are explicitly synthetic; UUIDs, passwords,
TOTP secrets, ports, and object paths are generated for the run and never
reported. The images are tiny in-memory WebP, PNG, and JPEG buffers plus
bounded invalid/SVG/oversize probes.

Fixtures cover applications, profiles, account profiles, events, reviews,
complaints, revisions, verification facts, categories, site content, badges,
email notifications, audit rows, two Storage buckets, and the four public
views. No production row or file is copied.

## 5. Runner command

```powershell
$env:ALAMIN_SECURITY_LOCAL_ONLY = '1'
node tests/security/role-matrix/run.mjs
```

The command performs two fresh runs and compares the stable tuples
`case ID / classification / SEC mapping`. UUIDs, ports, timestamps, and
durations are excluded from the comparison.

## 6. Result semantics

`PASS` means the secure expectation held. `XFAIL` means the secure expectation
failed in exactly the way mapped to an existing open finding. `XPASS` means an
expected vulnerability no longer reproduced and requires ledger/baseline
adjudication. `FAIL` is an unexpected insecure result or harness error. `SKIP`
requires a precise technical reason.

Any `FAIL`, `XPASS`, incomplete case list, invalid SEC mapping, differing
independent runs, or cleanup residual causes a non-zero exit. Insecure behavior
is never encoded as `PASS`.

## 7. Coverage

The active suite contains 136 cases. It covers:

- private/base-table reads and cross-owner isolation;
- application protected columns, ownership, status, update, and delete,
  including the exact versioned owner projection, explicit/wildcard bypasses,
  trusted moderation compatibility and a disposable future-column probe;
- specialist/revision/moderator/admin boundaries;
- direct moderator protected-field, lifecycle, verification, badge, feedback
  and audit-write denial, including a transaction-rolled-back future-column
  privilege probe;
- named application/revision moderation state machines with invalid-state,
  replay, expected-version and concurrent-winner assertions;
- anonymous/authenticated direct feedback denial, protected-field and duplicate
  bypasses, service-only exact insertion, target eligibility, idempotent replay,
  content duplicate handling, atomic rate limits, and future-column fail-closed
  behavior;
- account-profile mirrored fields;
- real AAL1 negative and AAL2 positive sessions;
- allowlisted revision-decision RPC plus catalog function ACL/search-path
  assertions;
- exact public-view projections and unpublished-row exclusion;
- owner/foreign/anonymous Storage upload, read, update, delete, MIME, size, and
  referenced-object behavior;
- immutable submission paths, content-addressed canonical publication,
  no-overwrite retry, source/canonical hash identity, application/revision
  publication, source deletion survival, and client canonical-path denial;
- categories, site content, badges, email queue, audit, role revocation, RLS,
  and default privileges.

`coverage-matrix.json` records the resource/action disposition as `AUTOMATED`,
`NOT_AUTOMATED` with a reason, or `NOT_APPLICABLE`.

## 8. Cleanup

Cleanup targets only the current disposable project. The runner uses
project-specific Supabase stop with `--no-backup`, inventories exact project
containers/networks/volumes, removes only an unreferenced exact Edge Runtime
volume if the CLI leaves it, and removes the exact temporary directory. It
never uses `supabase stop --all`, Docker system prune, or volume prune.

## 9. Extension guide

Future fixes must keep the secure expectation unchanged and turn the relevant
`XFAIL` into an adjudicated `XPASS` before the expected-failure entry is
removed. A finding-specific change should add negative and positive cases,
rerun both fresh projects, and update the stable coverage matrix. Unexpected
insecure behavior must remain `FAIL` and be adjudicated separately; it must not
be silently added to the expected-failure ledger.

For SEC-001, the ledger transition has been adjudicated: the historical
pre-hardening result remains in `ROLE_MATRIX_BASELINE_RESULTS.md`, while the
post-fix result is recorded in `SEC-001_LOCAL_VERIFICATION.md`. Independent
fresh runs now produce 73 PASS and 23 non-SEC-001 XFAIL with no XPASS, FAIL,
or SKIP. SEC-001 adds reviewed-version and concurrent-decision cases through
`MEDIA-023`.

For SEC-002, the red phase produced 74 PASS and 31 XFAIL in both independent
runs. After the owner-safe projection migration, both fresh runs produced
83 PASS and 22 non-SEC-002 XFAIL, with no XPASS, FAIL or SKIP. The nine
SEC-002 expectations now PASS. `APPREAD-008` creates a synthetic future column
only inside the disposable database and proves that grants and the explicit
projection remain fail-closed. See `SEC-002_LOCAL_VERIFICATION.md`.

For SEC-003 and the P0-05 mutation-scoped part of SEC-010, the red phase
produced 88 PASS and 36 XFAIL in both independent runs. After the named-action,
role and AAL migration, both final runs produced 108 PASS and 16 unrelated
XFAIL, with no XPASS, FAIL or SKIP. Real local TOTP proves sensitive admin AAL1
denial and AAL2 success; current database membership is rechecked at mutation
time. SEC-010 is not closed: private reads, mandatory enrollment/recovery,
recent-auth and complete session downgrade/revocation remain separate gates.
See `SEC-003_LOCAL_VERIFICATION.md`.

For SEC-004, the expanded red phase produced 108 PASS and 28 XFAIL in both
independent runs. After the service-only gateway migration, both final runs
produced 124 PASS and 12 unrelated XFAIL, with no XPASS, FAIL, or SKIP. The 16
SEC-004 expectations cover direct grants/policies, anonymous/authenticated
inserts, protected fields, duplicates, function ACL, exact server inserts,
idempotency conflict/replay, duplicate content, target eligibility, concurrent
rate limiting, and future-column inheritance. See
`SEC-004_LOCAL_VERIFICATION.md`.

For P0-07, the expanded red phase produced 125 PASS and 27 XFAIL in both
independent runs. Fifteen new cases mapped only to SEC-007/008/018. After the
atomic workflow migration and caller/worker switch, both final runs produced
140 PASS and 12 unrelated XFAIL, with no XPASS, FAIL or SKIP. P007-001..016
cover direct client denial, active-owner concurrency, submission replay and
payload conflict, future-field closure, operation-aligned event/audit/outbox,
fault rollback, application/revision decision replay and races, worker leases,
bounded retry and fixed-path/least-privilege function ACLs. SEC-018 remains
partial because `AUDIT-004` and broader operational audit coverage are still
open. See `P0-07_LOCAL_VERIFICATION.md`.
