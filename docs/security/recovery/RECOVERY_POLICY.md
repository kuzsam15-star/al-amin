# AL-AMIN Recovery Policy

## 1. Scope and current decision

This policy covers three independent recovery domains:

1. PostgreSQL database state, including Auth database state and application
   catalog/data.
2. Storage object bytes plus bucket configuration and database-backed Storage
   policies.
3. Critical project configuration outside the database.

Recovery is not ready unless all three domains are reconciled in an isolated
target. A database-only restore is insufficient. Supabase documents that
database backups do not contain Storage object bytes, and that Restore to a New
Project does not copy Storage objects/settings or most project-level settings.

Current stage status: **PRODUCTION_DERIVED_LEVEL_2_RESTORE_PASS**. An
owner-approved encrypted logical database and Storage artifact was restored and
reconciled in two independent disposable local Supabase targets. The current
Free plan still supplies neither an automatic daily backup recovery point nor
PITR, and Level 3 project-configuration recovery remains pending.

Official references:

- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
- [Storage S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)
- [Download Storage objects](https://supabase.com/docs/guides/storage/management/download-objects)

## 2. Recovery evidence levels

| Level | Required evidence |
| --- | --- |
| 0 | Reviewed policy, runbook, manifests, stop conditions, and owner gates only |
| 1 | Dated DB and Storage backup artifacts exist; encryption and integrity metadata verified |
| 2 | DB and Storage restore to a new isolated target succeeds; production remains untouched |
| 3 | DB, Storage, and configuration reconciliation succeeds against approved source evidence |

SEC-001 production readiness requires Level 3. Levels must never be inferred
from a successful clean-room bootstrap or synthetic test alone.

## 3. Current platform capability

Read-only inspection on 2026-08-11 established:

- organization plan: Free;
- managed daily backups: unavailable on the current plan;
- PITR: unavailable on the current plan; official eligibility starts on paid
  plans and requires the documented compute/add-on conditions;
- Restore to a New Project: unavailable on the current plan and creates a new
  billable project when eligible;
- paid-plan daily retention is documented as seven days for Pro, fourteen days
  for Team, and up to thirty days for Enterprise; none is a current Free-plan
  recovery point;
- managed physical backups are the current default for eligible newer paid
  projects, while an owner-created logical dump remains the no-managed-backup
  fallback;
- latest managed recovery point: none available through the current-plan
  automatic-backup model;
- owner-created logical dump: one approved encrypted generation now exists
  outside Git and passed two isolated local restores;
- Storage object backup: the same encrypted generation contains the separate
  owner-operated Storage export and passed content-hash reconciliation.

PITR must not be purchased automatically. Current official example pricing is
approximately USD 100/month for seven days, USD 200/month for fourteen days,
and USD 400/month for twenty-eight days, before other required paid resources.
The exact organization-specific total must be shown to and approved by the
owner before purchase.

## 4. Approved RPO and RTO

Viktor approved these recovery objectives on 2026-08-11. Approval establishes
the targets; it does not claim that the current manual Free-plan process meets
them continuously.

| Domain | MVP RPO | MVP RTO | Mature target RPO | Mature target RTO | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| Database | 24 hours | 8 hours | 15 minutes | 2 hours | OWNER_APPROVED_TARGET |
| Storage objects | 24 hours | 12 hours | 4 hours | 4 hours | OWNER_APPROVED_TARGET |
| Critical configuration | Every approved config change | 4 hours | Every approved config change | 2 hours | OWNER_APPROVED_TARGET |

The mature database target requires a paid managed backup/PITR decision. The
Storage target requires an encrypted scheduled export because Supabase database
backups and PITR do not protect object bytes. Configuration changes require an
approved, redacted manifest update in the same operational change window.

## 5. Backup custody and retention

- Database and Storage artifacts must be encrypted before leaving the operator
  workstation and stored outside the Git repository.
- The artifact encryption key must be held separately from the artifact and
  never be placed in Git, chat, logs, or the artifact manifest.
- Source credentials are read-only where the platform supports it. Any target
  credential is scoped only to the isolated restore target.
- No backup job may delete or modify source database rows or Storage objects.
- At least two independently verified generations must exist before an older
  chain is retired.
- Proposed MVP retention is 14 daily generations plus 3 monthly recovery sets;
  owner approval and storage-cost review are required.
- Each generation records only aggregate counts, sizes, redacted path hashes,
  catalog hashes, tool versions, timestamps, and verification results.

## 6. Required proof gates

Database PASS requires a dated source artifact/recovery point, isolated restore,
catalog reconciliation, per-table row-count reconciliation, migration/catalog
coherence, and zero production mutation.

Storage PASS requires both buckets, encrypted object bytes, bucket metadata,
redacted path/content hash reconciliation, zero missing/corrupt objects, and a
successful isolated restore without overwrite.

Configuration PASS requires every manifest field to be classified as captured,
manual, or secret re-entry; an isolated application of all non-secret values;
and human verification of provider/redirect/session/network controls.

Two successful independent Level 3 rehearsals are required before this control
can be treated as proven. Any missing artifact, key, target, count, hash, or
manual setting fails closed.

## 7. Ownership and cadence

- Accountable owner: Viktor / project owner.
- Recovery operator: explicitly appointed owner-operated session.
- Independent verifier: a person who did not produce the artifact.
- Proposed cadence: daily artifact generation, monthly integrity verification,
  quarterly isolated Level 3 rehearsal, and an extra rehearsal before any
  launch-blocking security migration.

No production restore, plan purchase, project creation, credential issuance, or
destructive cleanup is authorized by this document.
