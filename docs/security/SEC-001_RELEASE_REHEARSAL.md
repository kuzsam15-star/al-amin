# SEC-001 Release Wrapper Rehearsal

Date: 2026-08-13

Environment: disposable local Supabase only

Production/remote calls: zero

## Scope

The same checkpoint/state module used by the owner wrapper was inserted into
the established SEC-001 deployment rehearsal. Each run used a fresh local
project, baseline, Auth users, database rows, Storage objects, ports, release
directory, checkpoint and lock. It applied Phase A and Phase B, performed a
canary-equivalent canonical publication, inventory, forced interruption,
resume, zero-change pass, observation simulation, post-verification and
automatic completion. Project-specific cleanup removed containers, networks,
volumes, credentials and temporary release files.

## Results

Final counts are recorded after execution. Success requires identical case IDs
and classifications across two independent runs, `FAIL=0`, and no residual
resources.

| Run | Wrapper/deployment cases | Result | Cleanup |
|---|---:|---|---|
| 1 | 20 | PASS | PASS |
| 2 | 20 | PASS | PASS |

The final runner line was
`SEC001_DEPLOYMENT_REHEARSAL_PASS RUN1=20 RUN2=20 FAIL=0`. Both runs contained
the same 19 established migration/backfill/media cases plus
`RELEASE-WRAPPER-COMPLETE`. Their ordered case IDs and PASS classifications
matched exactly.

## Failure injection

The Node test suite independently injects wrong target fingerprint, wrong
artifact hash, unexpected Phase A state, source commit mismatch, missing source,
canonical conflict, interrupted batch, premature/weak Phase B gate, stale
checkpoint and stale lock. Each condition must stop or remain resumable without
advancing to an unsafe state.

Result: 14/14 release-operation tests PASS (two deterministic state-machine
rehearsals, frozen-manifest verification and 11 named failure injections/subtests). No injected failure
advanced the checkpoint beyond its prerequisite.

## Regression gate

- project Node suite: 112/112 PASS;
- typecheck: PASS;
- ESLint: 0 errors, 12 pre-existing warnings;
- final role matrix run 1: 73 PASS / 23 approved XFAIL / 0 XPASS / 0 FAIL / 0 SKIP;
- final role matrix run 2: identical;
- database lint: 0 ERROR / 0 WARN / 0 INFO;
- local security advisors: unchanged pre-hardening 4 ERROR / 8 WARN / 0 INFO;
- role-matrix and rehearsal cleanup: PASS.

This is local evidence only. It does not prove production identity, production
latency, production hosting deployment, or the live canary/observation results.
