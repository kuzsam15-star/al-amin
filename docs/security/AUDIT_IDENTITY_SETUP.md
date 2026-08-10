# Temporary Catalog-Only Audit Identity Setup

## Purpose

Define the human-controlled procedure for a short-lived production identity that can support metadata-only catalog evidence for AL-AMIN baseline reconciliation. The identity is not an application user, does not replace production administration, and must never be used to read business/Auth/Storage-object data or make a change.

This document is preparation only. It does not authorize identity creation, credential sharing, connection, SQL execution, or any Supabase change.

## Security principles

- **Least privilege:** permit only the metadata visibility required by the approved extractor; do not grant data access as a shortcut.
- **Temporary access:** one project, one stated audit purpose, one short expiry, and a single connection limit.
- **No application data:** no rows, counts, users, identities, sessions, uploads, logs, exports, or backups.
- **No mutation rights:** no DDL/DML, privilege changes, role administration, configuration changes, or application-function execution.
- **Human-held credential:** Viktor creates, stores, uses, and destroys any credential. It is never shared with Codex, pasted into chat, committed, written to an environment file, or placed in CI.
- **Fail closed:** unavailable metadata remains `UNKNOWN`; permissions must not be broadened to complete a report.

## Required capabilities

The later identity requires only the following conceptual capabilities, subject to an explicit human approval:

- connect to the one AL-AMIN database during the approved audit window;
- read system-catalog and information-schema metadata necessary to enumerate schemas, objects, dependencies, constraints, indexes, RLS state, policies, ACLs, functions, views, triggers, extensions, and non-secret settings;
- read the explicitly approved metadata fields for Storage buckets and Storage policies, never `storage.objects` rows;
- provide metadata needed for a redacted, fixed-format evidence artifact;
- no more access than required for the fixed catalog extractor.

The identity must be a separate, uniquely named, short-lived login with a defined expiry and single connection limit. It must be `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, own no application objects, and inherit no application or internal administrative roles.

## Explicitly forbidden permissions

The temporary identity must not receive or effectively inherit:

- `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `MERGE`, or row-level `SELECT` on application, Auth, or Storage-object data;
- DDL or schema actions, including `CREATE`, `ALTER`, `DROP`, `COMMENT`, `SECURITY LABEL`, migrations, or extension changes;
- `GRANT`, `REVOKE`, role membership changes, default-privilege changes, configuration changes, job scheduling, or connection-management privileges;
- Auth administration, user/identity/session/MFA access, Storage object operations, uploads/downloads, or Dashboard/API-key/secret access;
- `service_role`, database-owner/admin membership, `BYPASSRLS`, broad PostgreSQL predefined roles, replication, server-file/program access, backend signalling, or Management API access;
- application RPC, mutable functions, trigger invocation, email/outbox functions, or any function whose execution can cause an observable side effect;
- credentials, tokens, JWTs, passwords, production dumps, logs, or personal data in the resulting evidence.

If existing `PUBLIC` function grants would allow the identity to execute a mutable function, the identity is unsuitable for unattended use. Do not compensate by changing production grants in this workflow; Viktor must operate a fixed metadata-only procedure himself, or the relevant evidence remains `UNKNOWN`.

## Lifecycle

1. **Create.** After a separate human approval, Viktor creates one named identity scoped to the audit and records its purpose, expiry, connection limit, and intended extractor version. The credential is generated and retained only in Viktor's password manager.
2. **Use.** Viktor alone runs the approved metadata-only extractor from a trusted local workstation. Codex receives only the redacted output artifact and never obtains a live connection or credential.
3. **Verify.** Before and after extraction, Viktor verifies effective privileges: no data reads, no mutating rights, no broad memberships, no bypass attributes, no active unexpected sessions, and no output containing secrets or personal data.
4. **Revoke.** Immediately after successful extraction—or on the first unexpected permission/result—Viktor ends the audit session and revokes the identity's project connection capability under a separately approved owner action.
5. **Delete.** Viktor removes the temporary login and deletes its local credential only after connection denial is confirmed. Preserve only the redacted evidence, an evidence hash, the audit date, and cleanup attestation.

## Human approval points

Only Viktor may approve or perform the following actions:

- confirm the exact AL-AMIN project and the permitted audit window;
- approve identity creation, scope, expiry, connection limit, and local credential storage;
- verify effective permissions before use and execute the extractor locally;
- decide whether a Dashboard metadata screen can be viewed without exposing data/secrets;
- stop the audit on any unexpected output or permission request;
- revoke and delete the identity, verify loss of access, and attest cleanup.

Codex must not create the identity, receive its credential, initiate a remote connection, use Dashboard/CLI/MCP access, or perform any of the actions above.
