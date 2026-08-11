# AL-AMIN Isolated Recovery Runbook

## 1. Safety boundary

This runbook is owner-operated. It never authorizes an in-place production
restore. The source is read-only; the target is a new isolated project or a
disposable local environment. Credentials stay only in the owner's process
environment or approved secret manager and are never pasted into chat, Git,
command history, evidence, or logs.

Stop immediately if the source and target identifiers match, the target contains
non-disposable data, a command proposes source mutation, a credential appears in
output, an artifact cannot be authenticated, or the estimated paid action has
not been approved.

## 2. Preconditions and human approval

1. Confirm an incident-free maintenance window and name the recovery operator
   and independent verifier.
2. Approve the proposed RPO/RTO in `RECOVERY_POLICY.md`.
3. Choose one database source:
   - an eligible Supabase recovery point and owner-approved Restore to a New
     Project; or
   - an owner-created encrypted logical backup artifact.
4. Provide, outside Codex, an isolated writable target and ephemeral credentials.
5. Provide, outside Codex, the encrypted Storage artifact and its separate key.
6. Record the exact cost before creating any paid project or enabling PITR.
7. Create an evidence directory outside the repository. Raw dumps, object paths,
   credentials, and object bytes must never be copied into Git.

Current stop condition: these prerequisites are not satisfied.

## 3. Database recovery

### 3.1 Preferred managed path

When the project is eligible and the owner approves the displayed cost, use the
Dashboard's Restore to a New Project flow. Select a dated recovery point, confirm
the new target is separate, and do not change the source project. The created
project is billable and still needs separate Storage/config recovery.

### 3.2 Logical fallback

The installed Supabase CLI 2.113.0 supports `db dump` using an explicit database
URL and a dry-run. A future reviewed wrapper must pass the connection value from
ephemeral process state, not a command argument stored in shell history. It must:

1. validate that the source is the approved read-only endpoint;
2. run the CLI dry-run and archive the redacted command plan;
3. create schema/roles and data artifacts outside the repository;
4. encrypt and authenticate each artifact immediately;
5. calculate SHA-256 on ciphertext and record tool/PostgreSQL versions;
6. destroy plaintext as soon as encrypted verification succeeds;
7. restore only into the isolated target using version-compatible PostgreSQL
   tools;
8. keep credentials and row contents out of logs.

This stage did not create the wrapper because no owner-approved source credential
or backup artifact exists and the required PostgreSQL client tools are not
installed on PATH. Installing tools is outside scope.

### 3.3 Database reconciliation

Run all source-side comparisons as read-only, aggregate-only operations. Compare:

- PostgreSQL version;
- schemas, tables, columns, constraints, indexes, RLS flags, policies, grants;
- function signatures/security modes/search paths, views, and triggers;
- per-table row counts without returning rows;
- migration/catalog counts;
- a deterministic normalized catalog hash.

PASS requires exact approved matches. Any mismatch is documented and adjudicated;
it is never automatically accepted as drift. Evidence contains counts and hashes
only.

## 4. Storage backup and restore

Use the official S3-compatible endpoint or official Supabase Storage download
mechanism. The preferred owner-operated mechanism is a reviewed S3-compatible
client using temporary source read credentials and separate target write
credentials. Supabase S3 versioning is not available, so this export is a real
backup control rather than a cache.

The procedure is defined in `STORAGE_BACKUP_SPEC.md`. It covers `avatars` and
`profile-media`, encrypts bytes outside Git, hashes full paths before evidence
retention, supports checkpoints, never deletes source objects, and refuses
target overwrite unless an existing object's content hash already matches.

PASS requires per-bucket source/backup/target object counts and total bytes to
match, every content hash to match, and missing/corrupt counts to equal zero.
Database-backed Storage policies are reconciled with the database catalog; they
are not inferred from object bytes.

## 5. Critical configuration recovery

Use `CONFIG_RECOVERY_MANIFEST.json` as the redacted checklist. Apply non-secret
values to the isolated target and manually re-enter secrets from the owner's
secret manager. Never copy secret values into the manifest.

Required manual checks include Auth providers, email confirmation, redirect URL
allowlist, MFA/session controls, SMTP/provider secret presence, Storage bucket
configuration, Realtime settings, extensions, region/compute, custom domains,
network restrictions, and API settings. Unknown values block a Level 3 result.

## 6. Disaster scenarios

| Scenario | Restore source | Isolated target | Expected objective | Manual steps | Verification | Stop condition |
| --- | --- | --- | --- | --- | --- | --- |
| Accidental DB mutation/corruption | Last pre-incident DB recovery point/artifact | New project/database | DB RPO/RTO | Select point; restore; reconcile; plan later controlled cutover | Catalog hash and all table counts | Uncertain incident time or mismatch |
| Project-level DB loss | Latest authenticated DB artifact | New project/database | DB RPO/RTO | Create target only after cost approval; restore roles/schema/data | Full DB reconciliation | Missing artifact/key or incompatible version |
| Deleted Storage object | Encrypted object generation | Isolated bucket first | Storage RPO/RTO | Restore the named redacted-manifest entry to isolated target | Content hash/size/MIME | Path/key ambiguity or hash mismatch |
| Bucket-wide Storage loss | Latest complete encrypted bucket set | New isolated buckets | Storage RPO/RTO | Restore with no-overwrite; apply bucket config separately | Counts/bytes/all hashes | Missing/corrupt object count is non-zero |
| Bad migration deployment | Pre-deploy DB point plus reviewed forward-fix | New project/database | DB RPO/RTO | Rehearse restore; prefer production forward-fix over in-place rollback | Pre/post catalog and application invariants | Recovery requires destructive production action |
| Credentials/config loss | Secret manager plus redacted config manifest | New isolated project | Config RPO/RTO | Rotate/re-enter secrets; apply reviewed non-secret settings | Manifest has no unknown field; provider smoke checks | Secret unavailable or redirect/network setting unknown |
| Complete project loss | DB artifact + Storage artifact + config manifest | New isolated project | Maximum of all RTOs | Restore DB, Storage, then config; verify before DNS/caller cutover | Level 3 reconciliation | Any domain is below Level 3 |

These are reviewed procedures, not executed disaster tests in this stage.

## 7. SEC-001 partial-deployment recovery

- **Phase A applied, old source still deployed:** retain Phase A infrastructure;
  deploy a reviewed forward-fix if required. Do not revert permissions to an
  unsafe state.
- **New source deployed before backfill completes:** stop new approvals, keep
  old submission objects, and resume only after checkpoint and canonical hash
  reconciliation.
- **Partial canonical backfill:** never delete canonical media or old submission
  source. Resume idempotently from the checkpoint; a failed copy must not change
  the database reference.
- **Phase B applied with incomplete coverage:** emergency-stop publishing and
  use a reviewed forward-fix. Do not disable the canonical invariant globally
  and do not destructively roll back canonical objects.

The deployment is recoverable only after the database, both buckets, and config
have a Level 3 restore proof. This stage did not deploy or rehearse SEC-001 in
production.

## 8. Rehearsal sequence

Each rehearsal uses a fresh isolated target:

1. record source artifact IDs/hashes without secrets;
2. restore database;
3. reconcile catalog and counts;
4. restore both Storage buckets;
5. reconcile object count/bytes/content hashes;
6. apply and verify the config manifest;
7. exercise the seven disaster checks with synthetic identifiers only;
8. record duration, achieved RPO/RTO, discrepancies, and cleanup;
9. destroy only the isolated target after owner approval.

Two independent matching rehearsals are required. Rehearsal 1 and Rehearsal 2
are currently **NOT RUN** because no approved production-derived artifacts or
isolated target exist.

## 9. Cleanup

Revoke temporary source credentials, delete target credentials, securely delete
plaintext temporary files, retain encrypted artifacts according to policy, and
remove only the named isolated target after the owner confirms evidence capture.
Never use broad Docker, cloud-project, Storage, or filesystem pruning.
