# SEC-001 controlled release wrapper

This directory contains the owner-operated, fail-closed production release
wrapper for immutable published media. P0-12 prepares and rehearses it; it does
not authorize a production connection or mutation.

## Owner entry point

Double-click `START_SEC001_RELEASE.bat`. The launcher reads the checkpoint and
offers only the next valid stage. Production remains disabled unless the owner
starts P0-13 with `ALAMIN_SEC001_PRODUCTION_APPROVED=1` and selects an approved
identity package stored outside Git.

The wrapper never uses `supabase login`, `supabase link`, linked mode, or a
committed project ref. Database passwords and the temporary backfill credential
are accepted only by hidden prompts, kept in process memory, and sent on stdin.
The database password becomes a mode-0600 pgpass file in a disposable tmpfs
inside a pinned `postgres:17.6-bookworm` client container. It is never an
argument, environment variable, log field, checkpoint field, or Git artifact.

## Safety model

- The checkpoint and redacted JSONL log live below
  `%LOCALAPPDATA%\AL-AMIN-Security-Releases\sec001`, outside Git, with an
  owner-only ACL.
- The target is identified by a hash over project ref, region, DB host, catalog
  marker and sorted bucket names. The owner-approved identity package is also
  outside Git.
- `SEC-001_RELEASE_ARTIFACT_MANIFEST.json` freezes every executable release
  artifact. A mismatch stops before mutation.
- A local exclusive lock prevents parallel wrapper processes. Migration
  sessions additionally use a PostgreSQL advisory lock only for their lifetime.
- SQL uses the exact Phase A/Phase B files. Read-only verification sessions set
  `default_transaction_read_only=on`.
- Phase B requires state `OBSERVATION_PASSED`, seven zero counters, and the
  case-sensitive phrase `APPLY PHASE B`.

## State sequence

`NOT_STARTED -> PREFLIGHT_PASSED -> PHASE_A_APPLIED ->
SOURCE_DEPLOY_CONFIRMED -> CANARY_PASSED -> INVENTORY_REVIEWED ->
BACKFILL_IN_PROGRESS -> BACKFILL_COMPLETE -> OBSERVATION_PASSED ->
PHASE_B_APPLIED -> POST_VERIFY_PASSED -> COMPLETE`.

`COMPLETE` is written only by the state machine after post-verification.
Failures and owner aborts end in `FAILED_SAFE` or `ABORTED_SAFE`.

## Manual boundaries

The owner must approve the target fingerprint, enter hidden short-lived
credentials, perform the existing hosting deployment, confirm the verified
version marker and canary, accept aggregate inventory counts, and type the
exact Phase B phrase. The wrapper never asks the owner to type SQL or shell
commands.

Raw logs, credentials, target identity packages and production checkpoints are
never committed. Do not move them into the repository.
