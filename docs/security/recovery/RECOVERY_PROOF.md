# AL-AMIN Recovery Readiness Proof

## 1. Evidence record

- Production-derived export completed: 2026-08-12.
- Two independent isolated local restores completed: 2026-08-13.
- Source access: owner-approved database read and Storage `LIST`/`HEAD`/`GET` only.
- Production mutations: none.
- Temporary S3 key: owner-confirmed deleted before encryption.
- Credentials persisted: no.
- Verdict: **PRODUCTION_DERIVED_LEVEL_2_RESTORE_PASS**.

Level 2 proves recoverability of the database, Auth database state, and Storage
object bytes. Level 3 is not claimed because the non-database Supabase project
configuration still contains manual/secret re-entry items that were not applied
and verified in an isolated project.

## 2. Encrypted backup evidence

The owner-operated workflow created one age-encrypted recovery archive and one
redacted report outside the repository. The final ciphertext size and SHA-256
match the redacted report. The archive passphrase is owner-held and was never
provided to Codex, Git, process arguments, environment variables, or reports.

The plaintext export was removed after authenticated encryption. Final checks
found zero protected recovery work directories and no persisted source
credential. Raw database rows, Auth records, Storage paths, object bytes, and
credentials are not present in Git evidence.

## 3. Database and Auth proof

| Check | Restore 1 | Restore 2 |
| --- | ---: | ---: |
| Restored tables reconciled | 47 | 47 |
| Auth users reconciled | 5 | 5 |
| Per-table row counts | PASS | PASS |
| Isolated target | disposable local | fresh disposable local |
| Cleanup | PASS | PASS |

Both restores used PostgreSQL 17 tooling and fresh loopback-only Supabase
targets. The source database was exported read-only; restore SQL ran only in the
disposable local targets. No production row values were written to logs or
documentation.

## 4. Storage proof

| Check | Restore 1 | Restore 2 |
| --- | ---: | ---: |
| Restored objects reconciled | 36 | 36 |
| Per-object content SHA-256 | PASS | PASS |
| Source operations | `LIST`/`HEAD`/`GET` only | not contacted |
| Target operations | disposable local restore | fresh disposable local restore |
| Cleanup | PASS | PASS |

The source export covered the fixed `avatars` and `profile-media` buckets.
Object paths and bytes remain only inside the encrypted owner-held artifact;
documentation contains aggregate counts only. The temporary S3 credential was
deleted before encryption and was not reused for restore.

## 5. Configuration proof

The redacted `CONFIG_RECOVERY_MANIFEST.json` was packaged and its format was
validated in both restores. Database-backed policies and configuration restored
with the database were exercised by healthy local Auth, PostgREST, Storage, and
Kong services.

Level 3 remains pending because Dashboard/project configuration that requires
manual inspection or secret re-entry was not applied to an isolated cloud
project. This includes provider/SMTP secret presence, redirect allowlists,
session/MFA controls, Realtime settings, custom domains, network restrictions,
compute/region choices, and API configuration.

## 6. Deterministic two-run result

The two independent summaries matched on:

- 47 reconciled tables;
- 5 Auth users;
- 36 Storage objects;
- every approved table row count;
- every Storage object content hash;
- config manifest format version;
- pre-Phase-A SEC-001 recovery state;
- successful project-specific cleanup.

Final residual resources: zero containers, zero named recovery networks, zero
named recovery volumes, and zero plaintext recovery work directories.

## 7. RPO/RTO decision

Viktor approved the RPO/RTO targets recorded in `RECOVERY_POLICY.md`. This proof
validates the restore mechanism but does not establish an automated backup
cadence or measure a production incident RTO. The current Free-plan/manual
export process therefore does not by itself prove that every approved target is
continuously met.

## 8. Remaining gap and next gate

The next recovery control is a configuration-only Level 3 rehearsal in an
owner-approved isolated project or equivalent environment. It must apply all
non-secret configuration, re-enter required secrets without exposing them, and
verify Auth/provider/session/network behavior. It must not restore into or
mutate production.

Until that gate passes, the correct status is Level 2 rather than full project
disaster recovery readiness.

## 9. Invariants

- Production was read only for the approved export and was never a restore target.
- No production mutation, migration, Auth change, or Storage write/delete occurred.
- No production credential or data was committed or printed in evidence.
- Historical migrations and the verified pre-hardening baseline were unchanged.
- The encrypted owner-held artifact remains outside the repository.
