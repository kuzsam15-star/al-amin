# AL-AMIN Local Role-Matrix Security Test Harness

Date: 2026-08-11

## 1. Architecture

The harness under `tests/security/role-matrix/` is a self-contained Node.js 24
integration runner. It uses built-in Node modules, built-in `fetch` through the
already installed Supabase client, and the existing `@supabase/supabase-js`
dependency. No dependency or lockfile change is required.

Each full invocation creates two independent local Supabase projects and uses:

- the pinned Supabase CLI 2.113.0;
- Docker Desktop's local `desktop-linux` context;
- PostgreSQL 17 from the local Supabase stack;
- the verified no-data `supabase/bootstrap/baseline.sql` only;
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

The active suite contains 73 cases. It covers:

- private/base-table reads and cross-owner isolation;
- application protected columns, ownership, status, update, and delete;
- specialist/revision/moderator/admin boundaries;
- anonymous and authenticated feedback insertion;
- account-profile mirrored fields;
- real AAL1 negative and AAL2 positive sessions;
- allowlisted revision-decision RPC plus catalog function ACL/search-path
  assertions;
- exact public-view projections and unpublished-row exclusion;
- owner/foreign/anonymous Storage upload, read, update, delete, MIME, size, and
  referenced-object behavior;
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
