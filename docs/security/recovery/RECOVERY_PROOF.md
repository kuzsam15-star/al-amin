# AL-AMIN Recovery Readiness Proof

## 1. Evidence record

- Date completed: 2026-08-13.
- Production source mode: read-only.
- Production mutations: none.
- Credentials persisted in Git or evidence: none.
- Plaintext recovery residuals: zero.
- Disposable Docker residuals: zero.
- Verdict: **RECOVERY_LEVEL_3_PROVEN**.

## 2. Encrypted backup and Level 2 evidence

The owner-operated workflow created one authenticated `age`-encrypted database
and Storage archive outside the repository. Its passphrase remained owner-held.
The temporary S3 key was deleted before encryption. Raw database rows, Auth
records, Storage paths, object bytes, passwords, and keys are absent from Git.

Two independent disposable local restore targets produced matching results:

| Domain | Result |
| --- | --- |
| Database | PASS x2; 47 table counts reconciled |
| Auth database state | PASS x2; five users reconciled by count only |
| Storage | PASS x2; 36 objects reconciled by SHA-256 |
| Archive authentication | PASS |
| Cleanup | PASS; zero residual resources |

No production row or object was changed during export or proof.

## 3. Level 3 configuration evidence

`CONFIG_RECOVERY_MANIFEST.json` v2 records 67 unique configuration fields:

| Classification | Count |
| --- | ---: |
| `PROVEN_RESTORABLE` | 13 |
| `PROVEN_MANUAL_REENTRY` | 48 |
| `PROVEN_NOT_APPLICABLE` | 6 |
| `UNKNOWN_BLOCKER` | 0 |

Seven secrets are named `MUST_REENTER`; values are not stored. Every secret has
an explicit source/custodian. Every manual field has an exact Dashboard or
provider path, expected non-secret state, verification, and failure impact.

Two independent disposable local runs used different project IDs and ports.
Both reconstructed and verified PostgreSQL 17, required extensions, Auth,
PostgREST/Data API, Storage, Kong, Realtime, local email delivery, exact bucket
metadata, and current provider/session configuration equivalents. Synthetic
secrets remained memory/environment-indirected. External OAuth and SMTP calls
were zero. Each run cleaned its containers, networks, volumes, and workdir.

The detailed record is `CONFIG_RECOVERY_REHEARSAL.md`.

## 4. Complete-project-loss decision

The documented walkthrough starts with only the owner-held encrypted archive,
the canonical Git repository, the redacted manifest, and credentials retained by
the owner or external providers. It covers replacement-project creation,
database/Auth restore, Storage restore, secret re-entry, provider and redirect
configuration, SMTP, Realtime, Data API, required extensions, deployment
rewiring, reconciliation, and fail-closed cutover approval.

Walkthrough result: **PASS**. No replacement production project was created and
no cutover was attempted during this proof.

## 5. RPO/RTO decision

The process is compatible with the approved MVP targets:

- Database: RPO 24 hours, RTO 8 hours.
- Storage: RPO 24 hours, RTO 12 hours.
- Configuration: RPO every approved change, RTO 4 hours.

This is capability evidence, not proof that daily cadence or incident-time RTO
is continuously achieved. Those remain ongoing operational controls.

## 6. Security decision and remaining work

SEC-013 is `RECOVERY_READINESS_PROVEN`. Its High historical severity remains in
the ledger, while its MVP launch-blocker role is removed because Level 2 remains
valid, Level 3 passed twice, critical unknowns are zero, and secret/manual
mappings are complete.

The backup system is not declared ideal. Automated generation and retention,
lost-key testing, managed PITR, measured incident RTO, and recurring independent
exercises remain maturity work.

For SEC-001, the recovery prerequisite is now satisfied. Production deployment
remains unauthorized because the exact release wrapper, target identity and
checkpoint controls, production migration/source mechanism, backfill controls,
monitoring window, and human release approvals remain incomplete.
