# SEC-001L Local Verification

## Verdict

`SEC001_LEGACY_CONTRACT_FORWARD_FIX_LOCAL_READY`

Starting HEAD: `7d83b1af04d027d3152a6938d6f3140a68ec90eb`. Remote Supabase, production rows/media/Auth/configuration and production credentials were not accessed in this local preparation.

## Root cause and red evidence

The original application-contract trigger intentionally requires contract version 2 for any approved application content change. Phase A's trusted canonical backfill changes only `main_image_path`/`gallery_paths`, but a verified legacy approved row still has contract version 1. The trigger therefore rejected the reviewed RPC with SQLSTATE `P0001`; its transaction preserved the old DB reference.

Two independent synthetic stacks reproduced `LEGACY-V1-RED-PHASE-REPRODUCED` with the exact error and unchanged path. The evidence contains no production identifier or content.

## Forward-fix contract

The new ordered migration adds a private non-client-callable predicate and redefines the existing trigger without removing any historical rule. The exception succeeds only for a service-controlled, approved, same-owner, same-status, same-contract row where:

- every non-media field is unchanged;
- source and destination slot cardinality is unchanged;
- every changed destination is an exact canonical namespace path;
- active Phase-A provenance binds destination owner/entity/slot and old source path;
- an already-published source is not changed.

Phase A must already be present; Phase B must still be absent. The release checkpoint may be rebound from the historical SEC-001R manifest to SEC-001L only in `INVENTORY_REVIEWED` with no planned/applied backfill counters. The checkpoint state and remote fingerprint are preserved.

## Independent clean rooms

Each run used a unique disposable project/ports, fresh verified baseline, Phase A, a synthetic approved contract-v1 row, exact red reproduction, SEC-001L migration twice, successful retry, complete backfill/zero pass, Phase B twice and every later forward migration.

- Run 1: 29 PASS / 0 FAIL; cleanup PASS.
- Run 2: 29 PASS / 0 FAIL; cleanup PASS.
- Case IDs and results were identical.
- Old sources remained present; no remote endpoint was contacted.

## Final local verification

- Full role matrix run 1: 188 PASS / 0 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP.
- Full role matrix run 2: 188 PASS / 0 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP.
- Database lint: 0 ERROR / 0 WARN / 0 INFO.
- Local security advisors: 0 ERROR / 8 expected WARN / 3 expected INFO.
- Targeted SEC-001 release/backfill tests: 25 PASS / 0 FAIL.
- Full Node suite: 184 PASS / 0 FAIL.
- Typecheck: PASS.
- ESLint: 0 errors / 12 unchanged warnings.
- Production build: PASS with local public placeholders only.
- Production and full dependency audit: 0 known Critical / High / Moderate.
- Candidate secret/PII scan and production client-bundle scan: PASS.
- Disposable resource cleanup: PASS.

The final migration lint correction removed only a redundant PL/pgSQL loop-variable declaration. Both the 29/29 deployment rehearsal pair and the complete 188-case role-matrix pair were rerun after that byte change.

## Required release sequence

1. Verify the new SEC-001L release/source/final manifests and clean enclosing commit.
2. Load the existing protected `INVENTORY_REVIEWED` checkpoint and exact target identity outside Git.
3. Rebind only the local checkpoint to SEC-001L; require exact owner phrase `APPLY SEC-001 LEGACY CONTRACT FORWARD-FIX`.
4. Apply/verify order 2 (SEC-001L) transactionally.
5. Resume the existing dry-run/backfill from the preserved checkpoint.
6. Require zero-change second pass/observation before Phase B (now order 3).

No step in this verification applied the migration remotely.
