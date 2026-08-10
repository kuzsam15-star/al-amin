# AL-AMIN Temporary Audit Identity Runbook

## 1. Purpose

This runbook prepares Viktor for a future, human-approved creation and use of one temporary catalog-only audit identity. Its sole purpose is to collect redacted live-catalog metadata required for AL-AMIN baseline reconciliation.

The identity is not an application account, not a production operator account, and not a replacement for `service_role`, an Admin/Management API token, or the database-owner account. It must never be used to read business data, Auth users, Storage objects, or any other production rows.

This document is a runbook only. It does not authorize or execute SQL, Dashboard changes, remote connections, role creation, grants, revocations, migrations, or extractor runs.

## 2. Safety rules

- Viktor stores the temporary credential only in his password manager and never shares it with Codex, chat, source control, CI, `.env*`, shell history, or documentation.
- The credential must not be a copied production database password, API key, JWT, `service_role`, or Admin/Management API token.
- The identity is unique to this one AL-AMIN audit, limited to one project, one short audit window, and one connection.
- The identity has no application-data access and no mutation rights. Missing metadata is recorded as `UNKNOWN`; permissions are never broadened for convenience.
- Viktor alone operates the identity and the extractor from a trusted local workstation. Codex receives only a redacted evidence artifact.
- The identity is revoked and deleted immediately after the audit or on the first unexpected permission/result.
- This runbook, `READ_ONLY_ACCESS_PLAN.md`, `AUDIT_IDENTITY_SETUP.md`, `CATALOG_EXTRACTOR_SPEC.md`, and `AUDIT_EXECUTION_CHECKLIST.md` must be reviewed together before any action.

## 3. Recommended creation method

**Where:** the existing AL-AMIN production project, using Viktor's existing owner-controlled Supabase Dashboard SQL Editor only during the separately approved human-execution stage. Do not use the Supabase CLI, an application route, a browser extension, a shared management token, or a remote automation tool.

**How:** Viktor reviews a one-off setup script outside this repository, confirms that it names only the temporary audit identity and the AL-AMIN project, then runs it manually. The script must be approved during P0-02B-B2e; this runbook deliberately does not embed executable SQL.

**Permitted command classes in that later one-off script:**

1. Create one uniquely named, time-bounded temporary login with constrained role attributes and a single connection limit.
2. Give it only the minimum database connection and catalog-metadata visibility required by the fixed extractor.
3. Set an explicit expiry and record the intended audit purpose.
4. After the audit, revoke connection capability and delete that exact temporary identity.

**Commands and methods never to use:**

- `supabase login`, `supabase link`, `supabase db push`, `supabase db pull`, migrations, CLI access-token setup, or any `--linked` command;
- `service_role`, Admin/Management API, database-owner credentials, project secrets, publishable/anon keys, Auth admin APIs, or Dashboard secret/API-key pages;
- broad PostgreSQL roles such as `pg_read_all_data`, `pg_write_all_data`, `pg_monitor`, `pg_read_all_settings`, `pg_read_all_stats`, server-file/program roles, replication roles, or bypass roles;
- membership in `postgres`, `supabase_admin`, `dashboard_user`, `anon`, `authenticated`, `service_role`, `supabase_auth_admin`, `supabase_storage_admin`, or an application moderator/admin role;
- generic `GRANT ALL`, broad schema/table access, default-privilege changes, role reuse, permanent access, or any change to an existing production role.

If the reviewed script requires any command outside the permitted classes, stop and do not run it.

## 4. Minimal permissions

### Permitted capabilities

The approved extractor may inspect only:

- catalog metadata for schemas, tables, columns, constraints, foreign keys, indexes, extensions, and approved non-secret settings;
- RLS state, policies, ACLs, default ACL metadata, and role references required to reason about security boundaries;
- function metadata, security mode, `search_path`, signatures, definitions subject to redaction, and execute-privilege metadata—without executing an application function;
- view metadata, definitions/security options, grants, and trigger metadata;
- Storage bucket configuration and Storage policy metadata, never Storage objects;
- approved Auth configuration metadata visible without visiting user, identity, session, API-key, secret, or log screens.

### Explicitly prohibited capabilities

- `SELECT` from application tables, Auth tables, `storage.objects`, views containing rows, sequences containing values, logs, audit/outbox records, or any row count/export/dump;
- `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `MERGE`, `COPY`, DDL, configuration changes, migrations, extension changes, role changes, grants, revocations, or default-privilege changes;
- function/RPC execution, trigger/job/email execution, Auth operations, Storage operations, user creation, or upload/download operations;
- `BYPASSRLS`, superuser-like attributes, role inheritance from privileged identities, server-side file/program access, replication, backend signalling, or direct access to any production credential.

## 5. Verification steps

Before the identity is used, Viktor must verify from metadata only:

1. **Identity attributes:** temporary name, expiry, connection limit, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, no ownership of application objects, and no privileged membership.
2. **No table-data access:** no effective data `SELECT` on application, Auth, or Storage-object relations; no broad predefined role that supplies it; no rights to create a view/function as a bypass.
3. **No mutation rights:** no DML, DDL, role administration, configuration, migration, job, Storage, or Auth capability.
4. **No function execution:** no direct execute grant on application functions. If `PUBLIC` grants could permit a mutable function, do not make the identity available to Codex or unattended tooling; use only Viktor's fixed procedure or record the affected evidence as `UNKNOWN`.
5. **Extractor boundary:** the reviewed extractor is fixed, metadata-only, has an allowlist of catalog sources, has no dynamic object execution, and passes its output redaction checklist.

An unexpected attribute, grant, membership, output, or access request is an emergency stop condition. Do not solve it by adding a grant or switching to an owner credential.

## 6. Extractor execution

**Where it runs:** only on Viktor's trusted local workstation, outside the canonical repository and outside any synchronized/shared folder. Codex does not run it and does not receive a connection string or credential.

**Inputs:** the locally held temporary credential and the fixed, separately reviewed metadata extractor. The execution must follow `CATALOG_EXTRACTOR_SPEC.md` and `AUDIT_EXECUTION_CHECKLIST.md` exactly.

**Permitted outputs:**

- one redacted UTF-8 JSON metadata evidence file;
- one redacted UTF-8 Markdown summary containing counts, object identifiers, matches, drift, unknowns, and redaction outcomes;
- one short privilege/expiry/cleanup attestation without a credential or project secret;
- content hashes for the redacted artifacts.

**Prohibited outputs:** raw query output, rows, screenshots of data/secret pages, connection strings, user identifiers, Auth/Storage contents, logs, dumps, SQL backups, tokens, or unredacted function literals.

Before sharing any output, Viktor runs the approved secret/PII scan and withholds anything flagged. After redaction, temporary raw files and local shell history entries created for the run are removed; only the redacted evidence and attestation may be retained for review.

## 7. Cleanup

After a successful run—or immediately after a stop condition—Viktor must:

1. end the temporary audit session;
2. under separately approved owner control, revoke the temporary identity's database connection capability;
3. delete that exact temporary role/login; do not keep it for the next audit;
4. verify that the identity cannot connect and retains no membership, object ownership, grant, default privilege, job, Storage, or Auth effect;
5. remove the temporary credential from the password manager only after deletion is confirmed;
6. retain only redacted evidence, content hashes, audit date, and cleanup attestation.

Cleanup must not modify application roles, RLS policies, table data, Storage rules, Auth settings, or existing production credentials.

## 8. Emergency stop

Stop immediately and do not continue if there is a suspected credential leak, unexpected privilege, data result, secret-bearing output, mutable-function path, incorrect project, or accidental remote action.

- **Credential leak:** do not paste or test the credential. Viktor immediately ends the session, revokes/deletes the temporary identity through the owner-controlled recovery path, and treats all produced evidence as untrusted until reviewed.
- **Incorrect rights:** do not add a grant, use an existing admin account, or retry with a broader role. Revoke/delete the temporary identity and document the denied requirement as `UNKNOWN`.
- **Erroneous access or data output:** stop collection, do not redistribute the output, remove local copies from the temporary workspace, preserve only a minimal incident note without the data, and reassess before any new audit attempt.
- **Possible production change:** stop, record the exact action/time without sensitive values, and escalate to Viktor. Do not attempt an improvised rollback.

## 9. Approval checklist

Before any future manual execution, Viktor confirms:

- [ ] The one-off setup and cleanup SQL were reviewed for the exact temporary identity and AL-AMIN project.
- [ ] Access is temporary, single-project, time-bounded, and has a single connection limit.
- [ ] No `service_role`, owner password, Admin/Management API token, project key, or production dump is involved.
- [ ] The identity has no data-read, mutation, DDL, role-management, Auth, Storage, or application-function execution capability.
- [ ] The working tree is clean and the expected Git HEAD is recorded before evidence collection.
- [ ] The fixed extractor, allowlist, redaction rules, output format, and stop conditions were reviewed.
- [ ] Viktor will hold the credential locally and provide only redacted evidence plus cleanup attestation.
