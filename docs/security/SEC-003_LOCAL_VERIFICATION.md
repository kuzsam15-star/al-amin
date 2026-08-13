# SEC-003 Local Verification

Date: 2026-08-13

Branch: `security/hardening`

Starting commit: `4528219fe92aac30c16a5a3dc60621524e14e764`

## Scope and verdict

SEC-003 is `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`.
The P0-05 mutation-scoped AAL gate for SEC-010 is `PARTIAL_LOCAL_VERIFIED`.
This is not live closure: no remote Supabase or production mutation occurred.

The change removes generic privileged client DML and replaces it with named,
row-locked functions whose role, AAL, payload, field and transition contracts
match the server actions. The verified pre-hardening baseline and historical
migrations remain unchanged.

## Red phase

The expanded secure-expectation suite ran twice against the unchanged local
pre-fix state:

| Run | PASS | XFAIL | XPASS | FAIL | SKIP |
|---|---:|---:|---:|---:|---:|
| Red 1 | 88 | 36 | 0 | 0 | 0 |
| Red 2 | 88 | 36 | 0 | 0 | 0 |

Only approved SEC-003 and mutation-scoped SEC-010 cases were newly XFAIL.
Insecure behavior was never encoded as PASS. No unexpected result was added to
the ledger.

## Implementation evidence

Forward migration:

- `supabase/forward-migrations/20260813163013_sec003_moderator_admin_boundary.sql`

The migration:

- revokes privileged direct DML and the broad moderator policies touched by
  this finding;
- revalidates current moderator/admin membership from the database;
- requires the signed JWT `aal2` claim for sensitive admin functions;
- exposes exact named actions with explicit grants and fixed `search_path`;
- locks application/revision/profile rows and enforces state transitions,
  expected versions and replay denial;
- appends the authoritative actor inside the same transaction as each touched
  privileged mutation;
- keeps SEC-001 canonical publication primitives service-only.

Server actions repeat the AAL2 check before sensitive admin RPCs and do not
accept actor, owner, role or canonical publication fields from request payloads.
The unused generic avatar publication action/component was removed so it cannot
be reintroduced as a client-side privileged mutation path.

## Final clean-room results

Each run created a fresh local Supabase project, replayed the verified baseline
plus every reviewed forward migration, created new synthetic Auth/TOTP fixtures,
executed all 124 role-matrix cases, and performed project-specific cleanup.

| Run | PASS | XFAIL | XPASS | FAIL | SKIP |
|---|---:|---:|---:|---:|---:|
| Final 1 | 108 | 16 | 0 | 0 | 0 |
| Final 2 | 108 | 16 | 0 | 0 | 0 |

The runs matched by case ID, classification and SEC mapping. All remaining
XFAIL are mapped to open SEC-004, SEC-010/018, SEC-015, SEC-016, SEC-017,
SEC-025 or SEC-026 cases. SEC-003 has no expected-failure entry.

Verified P0-05 behavior includes:

- direct moderator owner/status/slug/verification/feedback/audit writes deny;
- a synthetic future specialist column inherits no client UPDATE privilege;
- ordinary users cannot invoke revision decisions;
- moderator AAL1 can perform only the named application/revision decisions;
- invalid, replayed and conflicting application decisions fail closed;
- stale moderator membership immediately denies the named mutation;
- admin AAL1 cannot use sensitive named actions or direct DML;
- real local TOTP AAL2 permits the reviewed lifecycle, verification, badge,
  content, deletion and revision paths.

## Diagnostics and regression checks

- Database lint: 0 ERROR / 0 WARN / 0 INFO.
- Local security advisors: 4 ERROR / 8 WARN / 0 INFO, unchanged unrelated
  pre-hardening findings; no P0-05 regression was introduced.
- Existing Node tests: 119/119 PASS.
- TypeScript typecheck: PASS.
- ESLint: PASS with 0 errors and 12 existing warnings.
- Disposable cleanup: PASS for both final runs; no project resources remain.

## Residual findings

SEC-010 remains a launch blocker. P0-05 proves the sensitive admin-mutation
slice only; mandatory MFA enrollment/recovery, privileged private reads,
recent-auth requirements, and complete expired/downgraded/revoked multi-tab
session behavior are not closed.

SEC-008 remains open for the full cross-entity publication/outbox race model,
despite the exact application decision row-lock case passing here. SEC-018
remains open beyond the named transactions added in this change. No other
finding status is silently raised or closed.

## Release implication

The implementation is suitable for the future consolidated pre-launch backend
deployment only after the remaining P0 changes have passed the same isolated
replay and an owner-approved release gate. The current live Supabase catalog
continues to reproduce the original SEC-003/010 exposure until that deployment.
