# SEC-001M — media-free legacy row backfill compatibility

## Scope

This is a narrow operational tooling correction discovered during the approved
SEC-001 backfill. It does not change the database schema, Storage policies,
canonical media contract, application behavior, or Phase B enforcement.

## Root cause

The backfill constructed its source registry from every approved application
and every published specialist before selecting media-bearing rows. The source
registry correctly rejects a media target without an authoritative owner, but
the caller incorrectly applied that invariant to rows that contain no avatar
and no gallery references. Live aggregate-only evidence proved that all rows
with a missing owner contain no media references and that there are no linked
owner conflicts.

## Fix

The registry and the backfill plan now receive only rows with at least one
media reference. Ownerless rows with media remain a hard failure before any
Storage read, upload, or database RPC. No owner is guessed or repaired.

## Security invariants

- Every media-bearing row is still registered and owner-validated.
- Ownerless media-bearing rows fail closed before side effects.
- Rows without media cannot contribute a backfill target.
- Existing exact-path, exact-owner, no-overwrite, provenance, and idempotency
  checks are unchanged.
- SEC-001L and all earlier frozen manifests remain historical evidence.
- Remote execution requires a new exact owner gate for the SEC-001M bytes.

## Remote state

SEC-001 Phase A and SEC-001L were already applied and verified before this
local correction. Backfill and Phase B were not completed by SEC-001M local
preparation.
