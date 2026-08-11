# AL-AMIN no-data bootstrap v1

This directory is the Strategy C bootstrap track for **new empty local, CI, and
future staging environments only**. It is separate from the 18 files in
`supabase/migrations/`, which remain immutable historical evidence and are not
a fresh-environment bootstrap.

## Files

- `baseline.sql` — standalone, dependency-ordered application bootstrap;
- `manifest.json` — machine-readable expected object/security contract;
- `verify.sql` — read-only fail-closed catalog and no-data verification.

`baseline.sql` is reconstructed from the redacted live catalog interface, the
final tracked Git implementations, and the approved adjudication. The legacy
`schema.sql` was read as provenance but is not executed by this workflow. Demo
rows, category and badge reference rows, site-content rows/defaults, Auth-user
backfills, user files, and production identifiers are excluded.

## Safety contract

The bootstrap:

1. opens one transaction and aborts if any AL-AMIN application relation already
   exists;
2. assumes a fresh pinned Supabase local stack has already created the managed
   `auth`, `storage`, `realtime`, and platform roles;
3. creates only application schema/security objects plus the two approved
   Storage bucket metadata rows;
4. never creates Auth users, Storage objects, or application rows;
5. intentionally reproduces documented pre-hardening boundaries so later
   forward changes can prove their security delta;
6. must never be passed to `--linked`, `db push`, a production connection, or
   an existing project.

The application SQL is applied only from an isolated local project whose own
`supabase/migrations` directory is empty. Supabase CLI 2.113.0 sends
`db query --file` as one prepared statement, so it cannot execute this
multi-statement transactional file. Use the pinned local Postgres container
directly, without a database password:

```text
Get-Content -Raw <baseline.sql> | docker exec -i <local-db-container> psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres
Get-Content -Raw <verify.sql>   | docker exec -i <local-db-container> psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres
```

`supabase_admin` is required because the verified pre-hardening catalog
includes default privileges owned by both `postgres` and `supabase_admin`.
The container and project ID must belong to the disposable runner; cleanup is
project-specific (`supabase stop --project-id <id> --no-backup`), never
`supabase stop --all`.

The historical migration directory is neither renamed nor mounted as the
clean-room project's migration input.

## Provenance model

`manifest.json` uses these states:

- `LIVE_CONFIRMED` — directly present in the redacted live catalog evidence;
- `LIVE_DRIFT_CONFIRMED` — live differs from the final tracked statement;
- `GIT_IMPLEMENTATION_LIVE_INTERFACE_CONFIRMED` — body/definition comes from
  the final Git implementation while count, signature, security mode,
  search-path/interface, or dependent object is confirmed live;
- `GIT_ONLY_REQUIRED` — required by the application/bootstrap but not captured
  in live metadata;
- `CONFIG_EXPECTATION` — non-SQL platform/Auth requirement;
- `UNKNOWN` — retained as an explicit limitation and never treated as a pass.

Function bodies were not copied from production. Git resolves to exactly 32
final public function signatures, including 18 `SECURITY DEFINER` functions;
those counts and definer interfaces match the live catalog evidence.

## Known pre-hardening state

The bootstrap deliberately keeps the documented before-state for SEC-001,
SEC-002, SEC-003, SEC-004, SEC-007, SEC-008, SEC-015, SEC-016, SEC-017,
SEC-018, SEC-023, SEC-025, and SEC-026. These are marked in the SQL/manifest.
They are not fixes and must be addressed only by later reviewed forward changes.

## Forward hardening track

Fresh local/CI verification applies database state in this order:

1. `baseline.sql`;
2. `verify.sql` for the pinned pre-hardening contract;
3. reviewed `supabase/forward-migrations/*.sql` in filename order;
4. the full role-matrix and finding-specific verification.

The baseline and manifest are never rewritten to make a later finding appear
fixed historically. The SEC-001 track currently has a dual-compatible Phase A
and an enforcement Phase B. Phase B is safe on fresh/canonical environments
and deliberately aborts on existing approved/published legacy media; production
requires the separately approved inventory and backfill runbook first.

Auth settings are configuration expectations, not SQL objects. No provider
secret or production redirect identifier is stored here.

## Acceptance

The package is accepted only after two independent empty local replays, exact
manifest checks for the AL-AMIN object scope, zero application/Auth/Storage
rows, secret/PII review, safe existing project tests, and project-specific
cleanup. A successful SQL transaction without these gates is not verification.
