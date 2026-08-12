# AL-AMIN recovery tooling verification

Date: 2026-08-11

Last regression update: 2026-08-12

## Verdict

`SYNTHETIC_LOCAL_PREFLIGHT_PASS`

The owner-operated tooling is ready for Owner Gate 1. Recovery Level 3 is **not
yet proven** because no production row or object was read and no
production-derived artifact was restored.

## Verified toolchain

| Tool | Pinned version | Verification |
| --- | --- | --- |
| Supabase CLI | 2.113.0 | Installed executable/version check |
| Docker Engine | 29.7.2, Linux | `desktop-linux`, daemon and container health checks |
| PostgreSQL client | 17.6 in pinned Supabase container | `pg_dump`, `pg_dumpall`, `pg_restore`, `psql`; image digest `sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459` |
| age | 1.3.1 | Official release archive SHA-256 `c56e8ce22f7e80cb85ad946cc82d198767b056366201d3e1a2b93d865be38154` |
| rclone | 1.74.3 | Official archive SHA-256 `ecb0ed9006e0d1a693757007716a11dab6c2cde6dac3f2fd87da962eaa73d11d` |

Authenticode inspection found an age signer named `Up in the Air Consulting
LLC`, but Windows returned `UnknownError` for chain status; rclone returned
`NotSigned`. Neither is accepted as publisher proof. Trust is instead pinned to
the official primary-source archive and published SHA-256. A 7-Zip fallback was
rejected when its official site was unreachable; no unchecked download was
retained. Portable tools are outside Git and download archives were removed.

## Synthetic proof

The final clean run performed the following from scratch:

1. created a unique local Supabase source with PostgreSQL/Auth/PostgREST/Storage;
2. applied the verified no-data bootstrap and current forward migrations;
3. created one random `example.invalid` Auth user, one synthetic application,
   supporting synthetic rows, and two generated tiny image objects;
4. exported roles without password hashes, recovery-capable database data,
   aggregate inventory, both Storage buckets, byte hashes, and redacted config;
5. created and authenticated an age-encrypted ZIP payload;
6. deleted the source stack and plaintext payload;
7. restored into a different loopback-only disposable target;
8. restored managed ownership/grants and restarted healthy Auth, PostgREST,
   Storage, and Kong services;
9. reconciled 48 table counts, one Auth user, and two Storage object hashes;
10. removed decrypted material, target containers, volumes, networks, synthetic
    credentials, and the synthetic encrypted artifact.

Final safe result:

| Check | Result |
| --- | --- |
| Database row counts | PASS |
| Auth user count | PASS (1 synthetic) |
| Storage object count | PASS (2 synthetic) |
| Per-object SHA-256 | PASS |
| Authenticated encryption/decryption | PASS |
| Raw artifacts remaining | 0 |
| Disposable Docker resources remaining | 0 |

## Pgpass isolation regression

The owner-operated production path initially stopped fail-closed because a
Windows bind-mounted `pgpass` appeared group/world-accessible inside Linux.
PostgreSQL correctly ignored it. The credential boundary now transports the
temporary service and password file contents over container stdin, recreates
them inside a private `tmpfs`, applies and verifies directory mode `0700` and
file mode `0600`, and only then executes an allowlisted PostgreSQL client.

The 2026-08-12 synthetic regression established a real libpq connection using
that exact boundary and then completed the full export/encrypt/destroy/restore/
reconcile flow. Result: `PASS`; 48 table counts, one synthetic Auth user, and
two Storage object hashes matched; raw artifacts and residual Docker resources
were both zero. No production endpoint or credential was used.

## Supabase S3 SigV4 regression

Two owner-approved Storage attempts stopped fail-closed with HTTP 403
`SignatureDoesNotMatch` on read-only `ListObjects` for `avatars`. The first
temporary S3 key was deleted immediately. Neither attempt read an object or
changed a Storage object, database row, Auth state, or production
configuration. Because endpoint/region/key input is intentionally never
persisted, an individual signer input cannot be reconstructed after a key is
deleted.

Official Supabase documentation requires AWS Signature Version 4, the exact
project region, matching access-key ID/secret, and an endpoint ending in
`/storage/v1/s3`. The prior wrapper had a confirmed validation gap: it accepted
any HTTPS `supabase.co` path rather than enforcing the S3 path/host contract.
The corrected boundary now:

- accepts only the official project gateway or direct Storage hostname over
  HTTPS and the exact `/storage/v1/s3` path;
- rejects credentials in URLs, query strings, fragments, foreign hosts,
  malformed regions, and missing S3 paths before credential use;
- forces path-style SigV4 with provider `Other`, disables legacy V2 signing,
  ignores persistent rclone config, and clears unrelated AWS/rclone credential
  and session-token sources for the child process;
- pins the S3 ListObjects API to V2 for both the fail-fast probe and copy,
  following current Supabase troubleshooting guidance for rclone; this removes
  the remaining managed/local divergence caused by rclone's default V1 list;
- permits the prepared owner workflow to receive only prevalidated non-secret
  S3 endpoint/region as launch metadata, avoiding terminal paste ambiguity;
  access-key ID and secret remain interactive and are never process arguments;
- performs a silent read-only `ListObjects` probe for each fixed bucket before
  download, and returns only a redacted failure classification;
- keeps the only production operations as list/download.

Two independent full disposable regressions then used the local Supabase
Storage container's static S3-protocol key pair held only in process memory.
Both runs passed actual rclone SigV4 listing and download for `avatars` and
`profile-media`, encrypted the payload, destroyed the source, restored into a
fresh target, reconciled 48 table counts, one synthetic Auth user, two object
hashes, and left zero raw artifacts or Docker resources. Endpoint contract
tests also passed for both supported official host forms and blocked missing
path, foreign host, malformed region, and query-string cases.

A subsequent owner run reached both buckets but exposed an empty-collection
manifest bug after credential use: PowerShell refused to bind an empty array to
the hash helper. The key was deleted and production remained unchanged. The
helper now defines SHA-256 of the empty UTF-8 set as the deterministic empty
bucket hash. The full preflight first exports two empty buckets and asserts
zero counts/bytes plus that hash before seeding and repeating the normal
two-object export/restore proof.

## Security review

- Git, source, verified baseline, historical migrations, and package files are
  never recovery targets.
- Production DB credentials use hidden input and an ACL-protected temporary
  source file. Credential bytes are carried to a private container tmpfs only
  over stdin; the directory is checked as `0700` and both `PGSERVICEFILE` and
  `PGPASSFILE` are checked as `0600` before connection. Secrets and URLs are
  absent from process args, environment variables, bind mounts, and logs.
- Production Storage credentials are process-scoped rclone environment values;
  no persistent rclone/AWS config exists. Persistent config and unrelated
  AWS/rclone credential, profile, and session-token sources are explicitly
  excluded from the signer process.
- Fixed production source buckets are downloaded only. No source PUT, COPY,
  MOVE, SYNC, DELETE, migration, function call, or mutation is implemented.
- Raw rows, object names, object bytes, UUIDs, and credentials are absent from
  logs and documentation. Only encrypted payload retains sensitive material.
- Unknown/malformed media, non-HTTPS/non-Supabase S3 endpoints, unsafe paths,
  non-loopback targets, non-disposable project IDs, dirty/unrelated Git state,
  failed archive authentication, count/hash drift, unhealthy services, or
  cleanup residue all stop fail-closed.
- `storage.objects` rows are excluded from the logical dump and reconstructed by
  authenticated byte upload, avoiding metadata rows without bytes.
- `private` SEC-001 infrastructure is included when present; the pre-hardening
  baseline remains unchanged.

Static review found no source-side Storage write/delete operation, broad Docker
prune, `supabase login/link`, remote migration command, credential literal, or
production identifier.

## Official references

- Supabase Backups: <https://supabase.com/docs/guides/platform/backups>
- Supabase CLI backup/restore workflow: <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- Supabase Storage S3 compatibility: <https://supabase.com/docs/guides/storage/s3/compatibility>
- Supabase Storage S3 authentication: <https://supabase.com/docs/guides/storage/s3/authentication>
- Supabase managed-to-S3 rclone guidance and signature troubleshooting: <https://supabase.com/docs/guides/self-hosting/copy-from-platform-s3>
- Supabase Storage error codes: <https://supabase.com/docs/guides/storage/debugging/error-codes>
- PostgreSQL 17 `pg_restore`: <https://www.postgresql.org/docs/17/app-pgrestore.html>

## Remaining owner gates

1. Owner Gate 1: authorize the real read-only export and provisional RPO/RTO.
2. Owner Gate 2: after export, confirm the temporary S3 key was deleted.

No production export, restore, paid action, or production mutation occurred in
this verification.
