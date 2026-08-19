# SEC-001R Local Verification

## Live evidence boundary

One read-only PostgreSQL transaction inspected only approved/published media references and matching `storage.objects` metadata. It emitted no raw paths, UUIDs, hashes, names, email, Auth rows, media bytes, or PII. The production password remained in a hidden prompt and a mode-0600 container `pgpass`; the process destroyed it on exit.

Safe aggregates:

- 24 references, 14 distinct existing objects;
- 4 affected legacy references, 4 distinct legacy objects;
- 0 unknown references;
- 0 missing objects;
- 0 multi-owner objects;
- 10 same-owner multi-entity objects across the overall published reference set;
- the four legacy rows have a three-segment path and both the opaque path UUID and Storage owner metadata mismatch the DB row owner.

The owner is therefore derived only from the exact application/specialist DB relation. No semantic meaning is assigned to the opaque legacy UUID.

## Red phase

Two independent synthetic invocations on the pre-fix implementation reproduced `EXPECTED_BLOCK_REPRODUCED`. Storage download was not reached. Unexpected FAIL and XPASS were zero.

## Targeted verification

Targeted published-media/backfill suite: 14 PASS / 0 FAIL. It covers the discovered family, exact authorization binding, same-owner shared reuse, cross-owner ambiguity, unknown/root namespaces, malformed/traversal/encoded separators, missing object, canonical conflict, size/format/decode/hash and no-overwrite behavior.

## Clean rooms

Two independent disposable Supabase projects replayed the verified baseline, Phase A, synthetic pre-existing legacy rows, dry-run, apply/resume, zero-change second pass, Phase B twice, and all remaining frozen migrations.

- Run #1: 24 PASS / 0 FAIL; cleanup PASS.
- Run #2: 24 PASS / 0 FAIL; cleanup PASS.
- Both: cross-owner fixture blocked before Storage access; four allowlisted legacy references mapped to two synthetic shared objects; current and old source objects retained.

The full role matrix then ran in two additional independent disposable projects:

- Run #1: 188 PASS / 0 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP.
- Run #2: 188 PASS / 0 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP.
- DB lint: 0 ERROR / 0 WARN / 0 INFO.
- Security advisors: 0 ERROR / 8 WARN / 3 INFO, unchanged expected delta.
- Cleanup: PASS.

## Protected artifacts

All forward migration bytes, the verified baseline, baseline manifest, `schema.sql`, package files, main, and the baseline tag remain unchanged. Remote mutations, Storage writes, Auth changes, backfill, and migrations during SEC-001R: zero.
