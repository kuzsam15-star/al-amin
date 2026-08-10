# Temporary Audit Identity Verification Plan

## Purpose and boundaries

This plan defines future metadata-only checks that Viktor performs after creating the temporary audit identity and before allowing the catalog extractor to run. It is a plan, not executable SQL, and does not authorize a connection or any production change in the current stage.

The checks must use only catalog/privilege metadata predicates and role attributes. They must not probe access by reading a business/Auth/Storage-object row, running an application function, issuing an intentional DML/DDL failure, creating a test object, or exporting any data.

## Required security assertions

| Assertion | Metadata-only verification method | Pass condition | Failure handling |
| --- | --- | --- | --- |
| Metadata access works | Inspect catalog visibility for the explicitly allowlisted schemas/objects | Required structural/security metadata is visible to the temporary identity | Mark missing fields `UNKNOWN`; do not add broad grants |
| Table data access is impossible | Evaluate effective table/view/sequence privileges across application and Auth schemas | No data `SELECT` privilege is effective | Stop; do not test by selecting a row or alter production grants |
| `INSERT` is impossible | Evaluate effective relation privileges | No insert privilege is effective on any application/Auth/Storage-object relation | Stop and revoke/delete the temporary identity |
| `UPDATE` is impossible | Evaluate effective relation privileges | No update privilege is effective | Stop and revoke/delete the temporary identity |
| `DELETE` is impossible | Evaluate effective relation privileges | No delete privilege is effective | Stop and revoke/delete the temporary identity |
| DDL is impossible | Evaluate role attributes, ownership, schema privileges, and database privileges | No create/alter/drop-capable privilege or ownership path exists | Stop and revoke/delete the temporary identity |
| Function execution is prohibited | Evaluate effective execute privileges for application functions, including inherited and `PUBLIC` grants | No mutable application function is executable; privileged/unknown paths block unattended use | Do not modify production ACLs; Viktor may use only the fixed metadata procedure or mark the field `UNKNOWN` |
| Storage objects are inaccessible | Evaluate effective privileges on `storage.objects` and ensure extractor scope omits object rows | No data/read/write privilege is effective and no object listing/download path is used | Stop and revoke/delete the temporary identity |
| No privileged role path exists | Inspect role attributes and memberships | No admin, owner, bypass, replication, file/program, broad predefined, or application-role membership | Stop and revoke/delete the temporary identity |
| Expiry and cleanup controls exist | Inspect expiry, connection limit, active session scope, and cleanup ownership | One short audit window and a named Viktor-led cleanup action | Do not begin collection until corrected by a separately approved action |

## Before audit checklist

- [ ] Canonical Git branch, expected HEAD, and clean working tree are recorded.
- [ ] Viktor approved the exact project, purpose, expiry, connection limit, and cleanup owner.
- [ ] The temporary identity is separate from application users and all existing production roles.
- [ ] Credentials remain only with Viktor and are absent from chat, Git, `.env*`, CI, and shell history.
- [ ] The reviewed setup package contains only the permitted operation classes in `AUDIT_IDENTITY_SQL_REVIEW.md`.
- [ ] Effective privileges meet every required security assertion above.
- [ ] The fixed extractor allowlist, redaction rules, output schema, and emergency-stop conditions are reviewed.
- [ ] Any field that cannot be collected without a disallowed privilege is pre-classified as `UNKNOWN`.

## During audit checklist

- [ ] Viktor alone uses the temporary identity from a trusted local workstation outside the canonical repository.
- [ ] Only the fixed metadata extractor and approved Dashboard Auth configuration checklist are used.
- [ ] The collector reads catalog/configuration metadata only; it does not query rows, counts, logs, users, Storage objects, or files.
- [ ] No application function/RPC/trigger/job/email/Auth/Storage operation is executed.
- [ ] No DML, DDL, migration, role/grant/default-privilege, configuration, Dashboard, or remote mutation occurs.
- [ ] Any request for a credential, broader privilege, data result, mutable function, secret-bearing value, or unexpected target stops the audit immediately.
- [ ] Output is scanned locally for secrets and personal data before it is retained or shared.
- [ ] Redacted/unavailable fields are recorded as `UNKNOWN`; no workaround is attempted.

## After audit cleanup checklist

- [ ] Preserve only the redacted JSON evidence, redacted Markdown summary, hashes, date, and privilege/cleanup attestation.
- [ ] Do not retain raw output, row data, dashboard screenshots with sensitive content, connection strings, credentials, or local temporary artifacts.
- [ ] End the temporary audit session; do not terminate unrelated sessions.
- [ ] Under Viktor's separately approved owner control, remove the identity's connection capability and delete the exact temporary identity.
- [ ] Verify connection denial, no role membership, no object ownership, no grant/default privilege, and no Storage/Auth/job side effect remains.
- [ ] Remove the temporary credential from Viktor's password manager only after deletion is confirmed.
- [ ] Record cleanup result and remaining `UNKNOWN` items; do not generate a baseline, migration, security fix, or production change from the evidence alone.

## Evidence required for approval

The later audit package is acceptable only when it contains:

- a redacted effective-privilege attestation for every assertion above;
- a redacted extractor validation result and evidence hashes;
- a redacted list of `UNKNOWN` items and reasons;
- an expiry/session/cleanup attestation signed off by Viktor;
- confirmation that no production rows, secrets, uploads, or mutable operations were accessed.

Any failed assertion, missing attestation, or unexpected permission is a blocking result. The correct response is cleanup and escalation, not privilege expansion.
