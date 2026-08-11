# AL-AMIN recovery tooling verification

Date: 2026-08-11

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
| PostgreSQL client | 17.6 in official container | `pg_dump`, `pg_dumpall`, `pg_restore`, `psql` exercised locally |
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

## Security review

- Git, source, verified baseline, historical migrations, and package files are
  never recovery targets.
- Production DB credentials use hidden input and an ACL-protected temporary
  `PGSERVICEFILE`/`PGPASSFILE`; secrets and URLs are absent from process args.
- Production Storage credentials are process-scoped rclone environment values;
  no persistent rclone/AWS config exists.
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
- PostgreSQL 17 `pg_restore`: <https://www.postgresql.org/docs/17/app-pgrestore.html>

## Remaining owner gates

1. Owner Gate 1: authorize the real read-only export and provisional RPO/RTO.
2. Owner Gate 2: after export, confirm the temporary S3 key was deleted.

No production export, restore, paid action, or production mutation occurred in
this verification.
