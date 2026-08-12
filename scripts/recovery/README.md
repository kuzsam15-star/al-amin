# AL-AMIN owner-operated recovery tooling

This toolkit creates an encrypted, owner-controlled database + Storage backup
and verifies it only in disposable local Supabase targets. It never links a
project, uses a service-role value from production, or restores into production.

## Nontechnical entry point

Run `START_RECOVERY_PROOF.bat`. The launcher checks the clean
`security/hardening` repository, pinned tools, Docker `desktop-linux`, and local
safety boundary before presenting three plain-language choices.

Production export remains owner-gated. Never paste a database password, S3 key,
archive passphrase, URL containing credentials, or token into chat. Enter them
only into the local hidden prompt after the workstream explicitly opens the
gate. The export stops after encryption and requires deletion of the temporary
S3 key before any production-derived restore.

## Pinned portable tools

Tools live outside Git at `%LOCALAPPDATA%\AL-AMIN-Recovery\tools`:

- `age` / `age-keygen` v1.3.1, official GitHub release archive SHA-256
  `c56e8ce22f7e80cb85ad946cc82d198767b056366201d3e1a2b93d865be38154`;
- `rclone` v1.74.3, official rclone archive SHA-256
  `ecb0ed9006e0d1a693757007716a11dab6c2cde6dac3f2fd87da962eaa73d11d`.
- PostgreSQL client image `public.ecr.aws/supabase/postgres:17.6.1.158`, pinned
  by digest `sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459`.

The age binary carries an Authenticode signer (`Up in the Air Consulting LLC`),
but Windows returned `UnknownError` for chain status; rclone is `NotSigned`.
Neither result is treated as publisher proof. The pinned official archive
checksums above are the fail-closed supply-source boundary. No installer,
download archive, binary, credential, or backup artifact is stored in Git.

## Artifact contract

The authenticated `age` ciphertext contains one ZIP payload:

- `database/database.backup`: PostgreSQL 17 custom-format dump of `public`,
  optional `private`, `auth`, `storage`, and `supabase_migrations`; `storage.objects` rows are
  excluded because object metadata is reconstructed by byte restoration;
- `database/roles.sql`: roles without password hashes;
- `database/database_inventory.json`: safe counts/version/catalog hash only;
- `storage/storage_objects/`: object bytes, plaintext only inside protected
  temporary storage until encryption succeeds;
- `storage/storage_manifest.raw.json`: paths, sizes, and content hashes, kept
  only inside ciphertext;
- `storage/storage_manifest.redacted.json`: aggregate counts/hashes only;
- `config/CONFIG_RECOVERY_MANIFEST.json`: values classified as captured,
  absent, or `MUST_REENTER` without secrets.

## Safety and interruption

- Production database access uses an ACL-protected temporary libpq service and
  password file. Credential content crosses into the official PostgreSQL 17
  container only over stdin, is materialized in a private `0700` tmpfs, and is
  checked as `0600` before libpq may connect. The password and connection URL
  never appear in process arguments, environment variables, bind mounts, or
  logs.
- Production Storage requires the exact official Supabase SigV4 contract: an
  HTTPS project host, endpoint path `/storage/v1/s3`, and the exact Dashboard
  region. A read-only `ListObjects` probe must pass before any byte is copied.
  The pinned rclone process ignores persistent config and clears unrelated
  AWS/rclone credential sources while using the temporary key in process memory.
  It only lists/copies from the two fixed source buckets; no sync, move, upload,
  overwrite, or delete command exists.
- Raw paths and rows are never printed. Errors are redacted.
- Targets must be loopback-only and use an `alamin-recovery-target-*` project ID.
- Cleanup is exact-path and project-specific. Broad Docker or filesystem prune
  is never used.
- An interruption leaves the protected working directory for fail-closed owner
  review; rerun cleanup only through the named cleanup script. A retained raw
  directory is a blocker, never silently ignored.

The autonomous local preflight uses the disposable Storage container's static
S3 protocol credentials and its loopback `/storage/v1/s3` endpoint. This tests
the same rclone/SigV4/list/download path as production without any production
endpoint, key, or object. For the preflight only:

```text
powershell.exe -NoProfile -File scripts/recovery/Invoke-AlAminRecoveryProof.ps1 -Mode SyntheticPreflight
```
