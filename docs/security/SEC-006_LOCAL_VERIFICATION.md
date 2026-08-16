# SEC-006 Local Verification

## Verdict

`SEC006_LOCAL_FIX_READY`

SEC-006 is `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`. This is local evidence; the live remote backend remains unchanged.

## Scope and safety

- Starting HEAD: `510972c8172befaed543d9601c7ff89db76dc88f`.
- Verified no-data baseline and all prior forward migrations were replayed in fresh disposable projects.
- Historical migrations, baseline, manifest, `schema.sql`, package files and lockfile were not changed.
- Synthetic data used only `example.invalid`, random local UUIDs and generated tiny WebP buffers.
- No remote Supabase reference, production credential, production data or production media was used.

## Red phase

| Result | Run 1 | Run 2 |
| --- | ---: | ---: |
| PASS | 140 | 140 |
| XFAIL | 30 | 30 |
| XPASS | 0 | 0 |
| FAIL | 0 | 0 |
| SKIP | 0 | 0 |

The 18 new P008 cases reproduced the absence of a ledger/lease/reference registry, inline batch delete, direct client delete, stale-reference gap, undefined retry/ACK semantics and future-field gap. All mapped only to SEC-006; the previous 12 XFAIL remained unchanged.

## Final clean-room results

| Result | Run 1 | Run 2 |
| --- | ---: | ---: |
| PASS | 158 | 158 |
| XFAIL | 12 | 12 |
| XPASS | 0 | 0 |
| FAIL | 0 | 0 |
| SKIP | 0 | 0 |

Case IDs, classifications and SEC mappings were identical. P008-001..018 changed from XFAIL to PASS. No unrelated finding produced XPASS.

## Verified failure semantics

- active/application/specialist/revision/provenance references block or cancel deletion;
- a reference added after enqueue cancels a stale candidate;
- two workers produce one lease holder;
- provider failure leaves bytes and a retryable job;
- crash after Storage delete leaves a leased job recoverable by missing-object recheck;
- acknowledgement requires both zero references and exact object absence;
- duplicate enqueue returns one exact job and completed replay claims nothing;
- wrong owner, canonical namespace, traversal/encoded path and fixed-bucket violations fail closed;
- an unregistered synthetic `future_media_path` blocks the registry gate;
- direct anon/authenticated/moderator/admin-client ledger/RPC access is absent.

## Regression and diagnostics

- Node: `147/147 PASS`.
- TypeScript: PASS.
- ESLint: 0 errors; 12 pre-existing warnings.
- Database lint: `0 ERROR / 0 WARN / 0 INFO`.
- Security advisors: `4 ERROR / 8 WARN / 2 INFO`; error/warning counts are unchanged. One informational record was added with the new private cleanup catalog; it was not treated as a fix or used to relax any gate. Unrelated findings remain open.
- Disposable stack cleanup: PASS after every completed run.
- No raw path, key, token, credential, image bytes or run-specific output is committed.

## Deployment implication

The migration is suitable only for the approved consolidated pre-launch backend window after read-only drift/registry preflight. Enable the worker only after an observation window. Canonical, prior canonical, SEC-001 old-source, recovery-dependent and unknown-provenance classes remain retained; this local fix does not authorize their deletion.
