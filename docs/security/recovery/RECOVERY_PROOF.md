# AL-AMIN Recovery Readiness Proof

## 1. Evidence record

- Date: 2026-08-11
- P0-11 starting commit: `64e3c988e99b71154d76aab2cbb97718cabdfa4c`
- Supabase CLI inspected locally: 2.113.0
- Production inspection mode: metadata-only/read-only
- Production rows or Storage objects read: no
- Production mutations: none
- Verdict: **MANUAL_OWNER_APPROVAL_REQUIRED**
- Achieved recovery level: **Level 0 — documentation only**

## 2. Backup capability evidence

Read-only project evidence confirms the organization is on the Free plan. Under
the current official Supabase model:

- automatic daily backups are available on Pro, Team, and Enterprise, not Free;
- PITR is not enabled/eligible under the current Free plan;
- Restore to a New Project is paid-plan/physical-backup functionality and creates
  another billable project;
- no current-plan managed recovery point is available to select;
- database backups omit Storage object bytes;
- Restore to a New Project omits Storage objects/settings, Edge Functions, Auth
  settings/API keys, Realtime settings, and several database/project settings.

No plan purchase or project creation was attempted.

## 3. Database proof

| Item | Result |
| --- | --- |
| Recovery source | NOT AVAILABLE — no managed point and no owner-approved logical artifact |
| Isolated target | NOT CREATED — paid/cost gate and no artifact |
| Restore | NOT RUN |
| Catalog reconciliation | NOT RUN |
| Per-table row counts | NOT RUN; no production rows were queried |
| Schema/catalog hashes | Specification complete; no source artifact to compare |
| Migration coherence | NOT RUN against a restored target |

The verified no-data bootstrap is reproducibility evidence, not a production
backup and not a substitute for a production-derived restore artifact.

## 4. Storage proof

| Item | Result |
| --- | --- |
| Mechanism selected | Official S3-compatible/Storage download path, owner-operated |
| Buckets in scope | `avatars`, `profile-media` |
| Object artifact | NOT CREATED |
| Object count / total bytes | NOT READ |
| Redacted path/content hash manifest | NOT CREATED |
| Isolated restore | NOT RUN |
| Count/hash reconciliation | NOT RUN |

Production credentials were neither requested nor used. No Storage object row,
path, byte, or user file was read.

## 5. Configuration proof

`CONFIG_RECOVERY_MANIFEST.json` records the currently evidenced non-secret
configuration and marks unknown/manual/secret fields explicitly. It covers Auth,
Storage, Realtime, database extensions/settings, Edge Functions, and project
settings without storing project identifiers or secrets.

Result: specification complete, isolated application **NOT RUN**. Redirect URLs,
external provider/SMTP secrets, Realtime settings, compute class, custom domains,
network restrictions, and API configuration still require owner inspection or
re-entry. The machine-readable manifest contains 16 explicit `MUST_REENTER`
markers; this is a recovery work queue, not missing secret values in Git.

## 6. Rehearsals and scenario coverage

| Proof | Result | Reason |
| --- | --- | --- |
| Rehearsal 1 | NOT RUN | No authenticated DB/Storage artifacts and no approved isolated target |
| Rehearsal 2 | NOT RUN | Same gate; repeating synthetic bootstrap would not prove recoverability |
| Accidental DB mutation | PROCEDURE REVIEWED ONLY | No production-derived restore point |
| Project-level DB loss | PROCEDURE REVIEWED ONLY | No production-derived restore point |
| Deleted Storage object | PROCEDURE REVIEWED ONLY | No object artifact |
| Bucket-wide loss | PROCEDURE REVIEWED ONLY | No object artifact |
| Bad migration | PROCEDURE REVIEWED ONLY | No isolated production-derived DB restore |
| Credential/config loss | PROCEDURE REVIEWED ONLY | Manual/secret fields unresolved |
| Complete project loss | PROCEDURE REVIEWED ONLY | All three proof domains incomplete |
| SEC-001 partial deployment | PROCEDURE REVIEWED ONLY | SEC-001 was not deployed |

## 7. Deterministic PASS criteria

- Database: normalized catalog hash and every approved per-table count match;
  zero unexplained catalog/migration difference.
- Storage: source, encrypted artifact, and isolated target match per-bucket count,
  total bytes, and every content hash; missing/corrupt count is zero.
- Configuration: every manifest field is captured, manual, or re-entered; unknown
  count is zero for required fields; isolated checks pass.
- RPO/RTO: actual measured values meet owner-approved targets.
- Cleanup: all temporary credentials and isolated resources are accounted for.

None of these execution criteria was marked PASS without evidence.

## 8. Exact blockers and owner action

1. Approve the proposed RPO/RTO and retention policy.
2. Choose either a paid managed restore path or an owner-operated logical dump.
3. If using managed restore, approve the displayed paid-plan/new-project cost.
4. Generate encrypted DB and Storage artifacts outside Codex using ephemeral
   owner-held credentials.
5. Approve a new isolated target and provide only redacted artifact metadata to
   the verification process.

No credential should be sent to Codex. The next stage must build/review the
owner-side wrapper and run the first isolated restore only after these approvals.

## 9. Cleanup and invariants

No database, project, container, network, volume, Storage object, credential, or
temporary backup file was created by this stage. Therefore there are no residual
recovery resources to remove. Production, remote Supabase state, SEC-001 release
state, historical migrations, and the verified baseline remain unchanged.
