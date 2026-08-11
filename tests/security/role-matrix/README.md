# AL-AMIN local role-matrix harness

This harness exercises the verified pre-hardening baseline against disposable
local Supabase projects. It uses real local Auth sessions, PostgREST, RLS,
allowlisted RPC calls, Storage API requests, and read-only PostgreSQL catalog
assertions. It never treats a documented vulnerability as a successful secure
result.

## Run

From the repository root in PowerShell:

```powershell
$env:ALAMIN_SECURITY_LOCAL_ONLY = '1'
node tests/security/role-matrix/run.mjs
```

The confirmation variable is process-local. The runner also requires:

- the verified `supabase/bootstrap/baseline.sql` SHA-256;
- Supabase CLI 2.113.0 from its pinned local installation;
- Docker context `desktop-linux` with a Linux engine;
- no configured Git remote;
- loopback-only Supabase endpoints;
- a generated project ID beginning with `alamin-role-matrix-`.

Remote Supabase environment variables are removed from child-process input.
The runner never reads `.env.local`, never calls login/link/linked commands,
and never prints generated keys, passwords, tokens, fixture identifiers, or
ports.

## Result model

- `PASS`: the secure expectation is satisfied;
- `XFAIL`: the secure expectation is violated exactly as recorded in
  `expected-failures.json` and mapped to an open SEC finding;
- `XPASS`: an expected vulnerability did not reproduce; adjudication required;
- `FAIL`: an unexpected insecure result or harness failure;
- `SKIP`: a proven technical limitation with a recorded reason.

`FAIL` and `XPASS` make the command fail. A baseline run may succeed only with
approved `XFAIL` entries and explained `SKIP` entries.

## Disposable lifecycle

Each invocation performs two independent runs. Every run creates a new local
project, chooses new loopback ports, starts only the required local services,
streams the verified no-data baseline into that project's PostgreSQL 17
container, creates synthetic fixtures, executes all cases, and stops the exact
project with `--no-backup`. The exact excluded Edge Runtime volume is removed
only when no container references it. Broad Docker or Supabase cleanup is not
used.

Run-specific data exists only in disposable containers and the operating
system temporary directory. Official Docker image cache is retained.

## Extending the harness

Add the stable case definition to `cases.json`, implement its secure assertion
in `run.mjs`, and add resource/action coverage to `coverage-matrix.json`.
Only an already adjudicated open finding may be added to
`expected-failures.json`. A new or ambiguous insecure result must remain
`FAIL` until the finding ledger is separately reviewed.
