# SEC-001 Local Verification

Date: 2026-08-11
Status: `INDEPENDENTLY_REVIEWED_LOCAL_READY_FOR_CONTROLLED_DEPLOYMENT`

## Scope

Verification used only disposable local Supabase projects created from the
verified pre-hardening no-data baseline. Each project applied the two SEC-001
forward migrations in timestamp order, then created fresh synthetic Auth,
database, and Storage fixtures. No production or remote Supabase endpoint was
called.

## Red phase

Two independent pre-fix runs matched:

| Run | PASS | XFAIL | XPASS | FAIL | SKIP |
|---|---:|---:|---:|---:|---:|
| Red 1 | 54 | 31 | 0 | 0 | 0 |
| Red 2 | 54 | 31 | 0 | 0 | 0 |

Eight secure SEC-001 expectations reproduced the known vulnerability:
`STORAGE-010`, `MEDIA-001`, `MEDIA-002`, `MEDIA-003`, `MEDIA-007`,
`MEDIA-008`, `MEDIA-009`, and `MEDIA-010`.

## Post-fix clean-room runs

| Run | Fresh project | Baseline | Forward migrations | PASS | XFAIL | XPASS | FAIL | SKIP | Cleanup |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | unique local project/ports | PASS | 2/2 | 68 | 23 | 0 | 0 | 0 | PASS |
| 2 | independent project/ports | PASS | 2/2 | 68 | 23 | 0 | 0 | 0 | PASS |

Stable case IDs, classification, and SEC mapping matched. Run-specific UUIDs,
ports, credentials, timestamps, and paths were excluded from comparison and
were not logged.

## P0-03A case result (historical)

At the end of P0-03A, all then-defined SEC-001 expectations were PASS:

- `STORAGE-010`;
- `MEDIA-001` through `MEDIA-018`.

The expected-failure ledger contains no SEC-001 mapping. The remaining
23 XFAIL entries are unchanged mappings to other open findings. There was no
XPASS and no unexpected security result.

## Independent adversarial review delta

P0-03B added two red-phase stale-review cases. Before correction, two
independent projects matched at **68 PASS / 25 XFAIL / 0 XPASS / 0 FAIL /
0 SKIP**: `MEDIA-019` and `MEDIA-020` reproduced application and revision
review-to-publish TOCTOU under SEC-001.

The reviewed row version is now enforced inside each row-locking RPC.
Concurrent decision coverage (`MEDIA-021`–`MEDIA-023`) was also added. Final
independent role-matrix projects matched:

| Run | PASS | XFAIL | XPASS | FAIL | SKIP | Cleanup |
|---|---:|---:|---:|---:|---:|---|
| Adversarial 1 | 73 | 23 | 0 | 0 | 0 | PASS |
| Adversarial 2 | 73 | 23 | 0 | 0 | 0 | PASS |

All 24 SEC-001 cases (`STORAGE-010`, `MEDIA-001`–`MEDIA-023`) are PASS.
Other finding mappings remain unchanged.

## Targeted unit and source verification

- `tests/published-media-security.test.mjs`: 6/6 PASS;
- missing/malformed/foreign source: fail closed;
- canonical WebP decode/transcode/hash/path: PASS;
- no-overwrite and identical retry: PASS;
- conflicting retry and canonical source substitution: fail closed;
- service-role configuration remains reachable only through server-only
  modules; no client import was found.

## Database verification

- PostgreSQL 17 clean bootstrap plus Phase A and Phase B: PASS twice;
- local database lint: 0 ERROR, 0 WARN, 0 INFO;
- local security advisors: 4 ERROR, 8 WARN, 0 INFO;
- advisor counts matched across runs and are the unrelated pre-hardening
  baseline; no SEC-001 advisor regression was introduced.

Phase B was tested successfully on no-data and canonical synthetic state. Its
fail-fast legacy-reference precondition is intentional and prevents premature
production enforcement.

## Existing project regression

- Node test suite: 93/93 PASS;
- TypeScript typecheck: PASS;
- ESLint: PASS with 0 errors and 12 pre-existing warnings;
- package versions and `pnpm-lock.yaml`: unchanged.

## Integrity and provenance

The 18 historical migration files, `supabase/schema.sql`,
`supabase/bootstrap/baseline.sql`, and `supabase/bootstrap/manifest.json` match
their pre-change hashes. The baseline continues to represent the vulnerable
pre-hardening state; the fix exists only as forward migrations and source
changes.

## Secret/PII and cleanup

Candidate tracked changes contain no keys, passwords, JWTs, TOTP secrets,
tokens, production project references, real emails, production UUIDs, user
content, signed URLs, or media bytes. Synthetic emails use `example.invalid`.
Both final projects stopped with project-specific cleanup; their containers,
volumes, networks, temporary configs, fixtures, and credentials were removed.
Official cached Docker images were retained.

## Release implication

Local implementation and independent deployment rehearsal are verified, but
live SEC-001 remains open until Phase A/source rollout, idempotent
legacy-media backfill, Phase B enforcement, and post-deployment verification.
This document does not authorize production access or deployment.
