# Catalog Audit Execution Checklist

This checklist is for a future, separately approved audit run. It does not authorize any access or action in the current preparation stage.

## Before

- [ ] Canonical Git branch and expected HEAD are recorded; working tree is clean.
- [ ] The planned scope is metadata-only and targets the single approved AL-AMIN project.
- [ ] Viktor approved the audit window, purpose, expiry, and cleanup owner.
- [ ] The temporary catalog-only identity is approved, time-bounded, and has a single connection limit.
- [ ] Credentials are held only by Viktor; none are shared with Codex, chat, Git, `.env*`, CI, or shell history.
- [ ] Effective privileges were checked: no data `SELECT`, no DML/DDL, no role/configuration rights, no bypass attributes, no broad predefined-role memberships, and no mutable-function execution path.
- [ ] The extractor version, allowlist, redaction rules, output format, and stop conditions were reviewed.
- [ ] A safe local destination for redacted evidence is chosen; no production dump or raw dashboard capture will be retained.

## During

- [ ] Viktor alone initiates the approved metadata-only access; Codex has no remote connection.
- [ ] Use only the fixed extractor and the approved Dashboard Auth configuration checklist.
- [ ] Read only catalog/configuration metadata; do not read rows, row counts, users, logs, Storage objects, uploads, or files.
- [ ] Do not run mutations, migrations, DDL/DML, privilege changes, role changes, Auth actions, Storage actions, or application functions.
- [ ] Do not use `service_role`, Admin/Management API, database-owner credentials, project secrets, dashboard secret pages, CLI login, or project link.
- [ ] Stop immediately if a request asks for broader access, a credential, a data table, a mutable function, a secret-bearing configuration value, or an unexpected result.
- [ ] Scan output locally for secrets and personal data before any evidence is shared.
- [ ] Mark inaccessible fields `UNKNOWN`; do not infer values or widen permissions.

## After

- [ ] Preserve only the redacted JSON evidence, redacted Markdown summary, content hash, collection date, and privilege/expiry attestation.
- [ ] Reconcile the evidence against the Git snapshot, security findings, and baseline acceptance criteria without a new remote query.
- [ ] End the audit session and verify there are no remaining unexpected sessions.
- [ ] Viktor revokes the identity's connection capability and deletes the temporary identity under separately approved owner control.
- [ ] Verify the removed identity cannot connect and has no remaining role membership, grant, default privilege, job, Storage, or Auth effect.
- [ ] Remove the local temporary credential from Viktor's password manager only after revocation/deletion is confirmed.
- [ ] Record cleanup outcome and unresolved `UNKNOWN` items; do not create a baseline, migration, fix, or production change from the evidence alone.
