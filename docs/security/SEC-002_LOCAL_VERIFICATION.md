# SEC-002 Local Verification

Date: 2026-08-13

Status: `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`

## Scope and safety

This evidence covers only the local SEC-002 implementation. Every dynamic
check ran against a newly created disposable Supabase project on loopback.
Remote Supabase, production data, production credentials and hosting were not
accessed. The verified pre-hardening baseline, its manifest, `schema.sql` and
all 18 historical migrations remain unchanged.

## Root cause and implemented boundary

The pre-hardening catalog granted `authenticated` table-level `SELECT` on
`public.applications`. The owner RLS policy restricted rows but could not
restrict columns, so an owner could request `internal_notes`, `call_at` and
future privileged columns directly through the Data API.

Forward migration
`20260813154850_sec002_owner_safe_applications_projection.sql` now:

- revokes broad client table `SELECT`;
- grants `authenticated` only the 20 reviewed base columns required by the
  versioned owner contract;
- creates explicit-column `public.owner_applications_v1` with
  `security_invoker=true` and `security_barrier=true`;
- grants that view only to `authenticated`;
- routes the existing non-internal owner event policy through the safe view;
- fails closed if protected grants, view options or the exact column contract
  differ from the reviewed design.

Owner-facing source reads use `owner_applications_v1`. Trusted moderation
reads use the server-only Supabase admin client with explicit column lists.
No new function, `SECURITY DEFINER` object, dependency or lockfile change was
introduced.

## Test-first evidence

Before the migration, two independent clean-room runs produced the same
result:

| Run | PASS | XFAIL | XPASS | FAIL | SKIP |
|---|---:|---:|---:|---:|---:|
| Red 1 | 74 | 31 | 0 | 0 | 0 |
| Red 2 | 74 | 31 | 0 | 0 | 0 |

Nine SEC-002 expectations failed as approved XFAIL: existing `READ-005` plus
eight new `APPREAD` expectations. `APPREAD-007`, the trusted backend positive
path, already passed. No unexpected result was added to the ledger.

The first post-change run stopped on `EVENT-001`: the pre-existing owner event
policy selected protected `applications.owner_id` as the caller. This was a
compatibility regression caused by revoking the broad grant, not a new finding.
The migration was corrected to prove ownership through the safe view without
granting `owner_id`, then the full verification was restarted from clean state.

## Independent post-change runs

Both final runs replayed the verified baseline, all reviewed SEC-001 forward
migrations and the SEC-002 migration, then created fresh synthetic Auth users
and fixtures.

| Run | PASS | XFAIL | XPASS | FAIL | SKIP | Cleanup |
|---|---:|---:|---:|---:|---:|---|
| Final 1 | 83 | 22 | 0 | 0 | 0 | PASS |
| Final 2 | 83 | 22 | 0 | 0 | 0 | PASS |

The stable case IDs, classifications and SEC mappings were identical. All nine
SEC-002 XFAIL became PASS. The remaining 22 XFAIL entries and their mappings
were unchanged. No unrelated finding produced XPASS.

The SEC-002 cases prove:

- the exact 20-column owner projection is usable;
- base wildcard and protected-column reads are denied;
- another owner sees no row and anon cannot read the view;
- a moderator client cannot directly read protected base columns;
- the trusted service backend retains the required moderation read;
- a synthetic future sensitive column, added only in the disposable database,
  receives no client grant and never enters the projection.

## Regression and catalog verification

- Targeted SEC-002 static/source tests: 3/3 PASS.
- Full Node suite: 115/115 PASS.
- TypeScript: PASS.
- ESLint: PASS, 0 errors and 12 pre-existing warnings.
- Database lint per final run: 0 errors, 0 warnings, 0 information findings.
- Local Security Advisors per final run: 4 errors, 8 warnings, 0 information;
  identical to the red phase, with no SEC-002 regression.
- Disposable project cleanup: PASS after every run.

The SEC-001 release artifact manifest was deliberately not re-frozen during
this finding-scoped change. Its test now requires the frozen release bundle to
fail closed on exactly the reviewed pre-launch drift: the earlier reassessed
deployment runbook plus the four SEC-002-touched SEC-001 source artifacts. A
single consolidated pre-launch backend release must generate and review a new
manifest after the remaining P0 fixes are complete.

## Release implication

SEC-002 is locally implemented and verified, but remains open on the live
remote backend. No production-safe claim is made. The forward migration and
compatible application source must be included in the future dependency-
ordered, owner-approved consolidated pre-launch backend deployment, followed
by live catalog and direct Data API verification.
