# Temporary Audit Identity SQL Review

## Scope and status

This is a human-review package for the future P0-02B-B2e setup. It identifies the minimum one-off SQL operation classes that Viktor may review and, only after approval, execute manually in the AL-AMIN Supabase Dashboard SQL Editor.

It contains no executable SQL, password, project identifier, connection string, or credential. It does not authorize any operation in the current stage.

## Proposed SQL operations

| Proposed operation | Purpose | Capability created | Risk | Required verification | Reversal |
| --- | --- | --- | --- | --- | --- |
| Create one uniquely named temporary audit login | Create a distinct identity for one catalog-evidence run | Only an authenticated database session, subject to subsequent limits | A login could be mis-scoped, retained, or receive implicit/public privileges | Confirm temporary name, one-project scope, expiry, connection limit, no object ownership, and safe role attributes | End its session, remove its connection capability, then delete the exact identity |
| Set restrictive role attributes | Prevent administration, replication, bypass, inheritance, and broad persistence | No positive application privilege; only restrictive attributes | Omitting one restrictive attribute can create escalation or operational risk | Confirm `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, no privileged membership, and no application ownership | Delete the temporary identity; do not modify existing roles |
| Allow a connection only to the intended database | Permit the future fixed extractor to reach the one approved project | Database connection, not data access | Connection alone can expose effective `PUBLIC` privileges or unexpected objects | Confirm no connection to another project and a single-connection limit | Remove the connection capability before identity deletion |
| Preserve system-catalog visibility only as needed | Permit inspection of system/information metadata used by the fixed extractor | Metadata visibility, subject to standard catalog access controls | An unnecessary schema/table privilege could expose application rows | Confirm every requested metadata field is available without `SELECT` on application, Auth, or Storage-object relations | Remove any audit-specific metadata grant; do not broaden application schemas |
| Explicitly avoid application-object grants | Keep table/view/sequence/function/Storage-object data unavailable | None; this is a negative requirement | Existing inherited or `PUBLIC` rights can still create an effective privilege | Evaluate effective table, schema, function, and role privileges before extraction | Block the audit if a disallowed effective privilege exists; do not change production grants as a workaround |
| Set a short expiry and a single connection limit | Bound duration and blast radius | Time-limited access for the audit window | Expiry alone does not clean up a leaked credential or existing session | Record expiry and limit; verify the session count and planned cleanup owner | End session, remove connection capability, delete identity, and confirm connection denial |
| Cleanup: remove connection capability and delete the exact identity | Erase the temporary access after evidence collection | None after completion | Deletion can fail if the role owns objects or has remaining dependencies | Verify no ownership, memberships, grants, default privileges, scheduled work, or active audit session remain | A failed cleanup is a blocker; do not leave a dormant identity |

## Minimal grant strategy

The starting position is **no application grants**. The setup may grant only the minimum connection and catalog-metadata visibility required by `CATALOG_EXTRACTOR_SPEC.md`, after Viktor verifies each requested field cannot be collected through existing standard catalog visibility.

The review must reject any proposal for:

- data `SELECT` on application, Auth, Storage-object, log, audit, outbox, or view rows;
- `pg_read_all_data`, `pg_write_all_data`, `pg_monitor`, settings/stats roles, replication roles, server-file/program roles, signalling roles, or any broad internal Supabase role;
- `service_role`, database-owner/admin membership, Dashboard/API access token, existing application role, user account, or permanent audit identity;
- DML, DDL, migration, configuration, role membership, default-privilege, Auth, Storage, or application-function privilege;
- generic/broad grants, including `GRANT ALL`, grants to an application schema, or a change to an existing production role.

If `PUBLIC` already makes a mutable application function executable by the temporary identity, that is a hard stop for unattended use. The solution is not to alter production grants in this audit package; Viktor may only run the fixed metadata procedure himself, or the affected evidence is marked `UNKNOWN`.

## Review and execution controls

Before any future execution, Viktor must verify that the one-off script:

1. addresses only the exact temporary identity and the AL-AMIN project;
2. contains only the approved operation classes above;
3. has explicit restrictive attributes, expiry, connection limit, and cleanup operations;
4. grants no application data/DDL/DML/function execution capability;
5. contains no secret, password, token, service key, project ref, data query, migration, or command against an existing role;
6. is paired with the metadata-only verification plan and cleanup checklist.

The script is reviewed and executed by Viktor only. Codex must not receive the script after it is populated with a credential, and must not execute it remotely.

## Post-audit removal strategy

Cleanup is mandatory and is part of the same approval package:

1. finish the metadata collection and retain only redacted evidence;
2. end the audit session without touching unrelated sessions;
3. remove the temporary identity's ability to connect to the approved database;
4. delete the exact temporary identity after confirming it owns no objects and has no residual membership/grant/default-privilege dependency;
5. verify connection denial and record only a redacted cleanup attestation.

Do not preserve the role for reuse, convert it to an application role, or retain its credential after deletion.
