# SEC-004 Local Verification

Date: 2026-08-13

Status: **IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT**

## Scope

This report verifies the local forward-only SEC-004 implementation. It is not
evidence that the live Supabase project or a public application deployment has
changed. No remote command, production credential, row, user, or Storage object
was used.

## Red phase

Two independent disposable projects replayed the verified no-data baseline and
the prior SEC-001/002/003 migrations before the SEC-004 migration existed.

| Run | PASS | XFAIL | XPASS | FAIL | SKIP |
|---|---:|---:|---:|---:|---:|
| Red 1 | 108 | 28 | 0 | 0 | 0 |
| Red 2 | 108 | 28 | 0 | 0 | 0 |

Sixteen XFAIL cases mapped only to SEC-004. The newly added cases reproduced
authenticated complaint insertion, protected `internal_notes`, duplicate rows,
and missing gateway/atomic/idempotency controls. Cleanup passed twice.

## Final clean-room runs

Both final projects used fresh ports, volumes, Auth users, and synthetic data.
Order: verified baseline, SEC-001 Phase A/B, SEC-002, SEC-003, then
`20260813202524_sec004_safe_feedback_gateway.sql`.

| Run | PASS | XFAIL | XPASS | FAIL | SKIP | Cleanup |
|---|---:|---:|---:|---:|---:|---|
| Final 1 | 124 | 12 | 0 | 0 | 0 | PASS |
| Final 2 | 124 | 12 | 0 | 0 | 0 | PASS |

The two runs matched by case ID, classification, and SEC mapping. All SEC-004
cases became PASS. The 12 remaining XFAIL cases are unchanged findings:
SEC-010/015/016/017/018/025/026.

## Verified controls

- direct anonymous/authenticated review and complaint INSERT denied by grants
  and policies;
- protected-field and future-column fail-closed behavior;
- service-only function ACL and fixed `pg_catalog` search path;
- valid review/complaint exact INSERT with moderation defaults;
- published-target eligibility;
- scoped idempotent replay, conflict, duplicate window, and atomic concurrent
  burst limit;
- JSON-only, 8 KiB streamed body cap, strict allowlists and normalization;
- exact same-origin enforcement;
- mandatory server-side Turnstile action/hostname validation and provider
  fail-closed behavior;
- production cannot enable the injected test verifier;
- local mode ignores forwarding headers; cloudflare mode rejects missing,
  comma-separated, or invalid client addresses;
- HMAC fingerprint contains no raw address;
- generic error responses and no body/token/credential logging;
- HTML-like feedback remains plain React-escaped text;
- existing named review/complaint moderation remains PASS.

## Regression and diagnostics

- targeted gateway tests: `17/17 PASS`;
- role matrix: two identical final runs as above;
- database lint: `0 ERROR / 0 WARN / 0 INFO`;
- local security advisors: `4 ERROR / 8 WARN / 1 INFO`;
- advisor delta: one INFO for the RLS-enabled private ledger with no direct
  policy; no new ERROR or WARN. Existing four view errors and eight broad
  pre-hardening warnings remain unrelated open debt;
- complete Node suite: `136/136 PASS`;
- TypeScript: PASS;
- ESLint: 0 errors; 12 existing warnings;
- lockfile/dependency delta: none.

The updated configuration-recovery rehearsal also passed twice with 73 fields
classified as 13 restorable, 54 manual, 6 not applicable, and 0 unknown; all
nine secret sources remain `MUST_REENTER`, external calls were zero, and cleanup
left zero residual resources.

## Release implication

The local implementation is ready for later consolidated pre-launch backend
deployment. Live SEC-004 remains open until the forward migration is applied,
the first hosting environment supplies the six approved gateway values, the
server routes are deployed, and direct live Data API writes plus a real
Turnstile synthetic submission are verified. There is no public application
deployment at this stage.
