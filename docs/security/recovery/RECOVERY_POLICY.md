# AL-AMIN Recovery Policy

## 1. Scope and current decision

This policy covers three independent recovery domains:

1. PostgreSQL database state, including Auth database state and application data.
2. Storage object bytes, bucket configuration, and database-backed Storage policies.
3. Critical Supabase project, Auth, API, Realtime, email, provider, network, and deployment configuration.

Recovery is not ready unless all three domains can be reconciled in an isolated
target. A database-only restore is insufficient because Supabase database
backups do not contain Storage object bytes or most project-level settings.

Current stage status: **RECOVERY_LEVEL_3_PROVEN**. The owner-approved encrypted
database and Storage artifact passed two independent disposable local restores.
The redacted 67-field configuration manifest then passed two independent local
configuration rehearsals with synthetic secrets, 48 exact manual-reentry
checklists, seven complete secret-source mappings, and zero launch-critical
unknowns. Production was not changed.

Official references:

- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
- [Local configuration reference](https://supabase.com/docs/guides/local-development/cli/config)
- [Storage S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)

## 2. Recovery evidence levels

| Level | Required evidence |
| --- | --- |
| 0 | Reviewed policy, runbook, manifests, stop conditions, and owner gates only |
| 1 | Dated DB and Storage artifacts exist; encryption and integrity metadata verified |
| 2 | DB and Storage restore to independent isolated targets succeeds; production remains untouched |
| 3 | DB, Storage, and configuration reconstruction succeeds against approved evidence with zero critical unknowns |

Level 3 is evidenced by `RECOVERY_PROOF.md` and
`CONFIG_RECOVERY_REHEARSAL.md`. It proves current MVP recovery capability; it
does not prove continuous backup cadence, managed PITR, or incident-time RTO.

## 3. Current platform capability

Read-only inspection established that the current Free plan supplies neither a
managed daily recovery point nor PITR. The approved fallback is an encrypted,
owner-operated logical database and Storage export outside Git. One production-
derived generation passed two isolated restores: 47 tables, five Auth users,
and 36 Storage object hashes reconciled. No plaintext residual remained.

The configuration fallback is the redacted versioned manifest plus credentials
held only by their approved custodians. Two local rehearsals reconstructed the
local equivalents of PostgreSQL 17, required extensions, Auth, PostgREST/Data
API, Storage, Kong, Realtime, and SMTP delivery without contacting external
OAuth or SMTP providers.

## 4. Approved RPO and RTO

Viktor approved these objectives on 2026-08-11:

| Domain | MVP RPO | MVP RTO | Capability evidence |
| --- | ---: | ---: | --- |
| Database | 24 hours | 8 hours | Level 2 restore PASS x2 |
| Storage objects | 24 hours | 12 hours | Level 2 restore and SHA-256 reconciliation PASS x2 |
| Critical configuration | Every approved configuration change | 4 hours | 67-field Level 3 reconstruction PASS x2 |

The documented process is compatible with these targets. Maintaining them
requires daily encrypted generations, a manifest update with every approved
configuration change, and practiced operators. The rehearsal did not measure a
real incident clock and therefore does not claim an achieved production RTO.

## 5. Backup custody and retention

- Encrypt database and Storage artifacts before they leave the operator workstation.
- Keep encryption keys separate from artifacts and out of Git, chat, logs, and manifests.
- Treat the source as read-only; no recovery job may delete or mutate production rows or objects.
- Retain at least two independently verified generations before retiring an older chain.
- Proposed MVP retention remains 14 daily generations plus three monthly sets, subject to owner approval and cost review.
- Store only aggregate counts, sizes, redacted hashes, tool versions, timestamps, and verification outcomes in evidence.
- Update the redacted configuration manifest in the same approved change window as every Dashboard/provider change.

## 6. Required proof gates

Database PASS requires an authenticated artifact, isolated restore, catalog and
per-table count reconciliation, and zero production mutation.

Storage PASS requires both buckets, encrypted bytes, bucket metadata, redacted
path/content-hash reconciliation, zero missing/corrupt objects, and isolated
restore without source overwrite.

Configuration PASS requires every field to be classified, every secret to have
an explicit custodian/source, every manual-only value to have an exact path and
verification, two independent local rehearsals, and zero critical unknowns.

The current evidence satisfies all three gates. Any future missing artifact,
key, count, hash, manual setting, or critical source fails closed.

## 7. Ownership and continuing maturity

- Accountable owner: Viktor / project owner.
- Recovery operator: explicitly appointed owner-operated session.
- Independent verifier: a person who did not produce the artifact.
- Required cadence: daily artifact generation, monthly integrity verification,
  quarterly Level 3 rehearsal, and an extra rehearsal before a launch-blocking migration.

`RECOVERY_READINESS_PROVEN` removes the SEC-013 MVP readiness blocker. Remaining
maturity work includes automated cadence evidence, approved retention execution,
managed PITR decision, lost-key drill, measured incident RTO, and recurring
independent exercises. No production restore, paid purchase, project creation,
credential issuance, or destructive cleanup is authorized by this document.
