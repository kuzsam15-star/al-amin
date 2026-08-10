# Credential-safe audit provisioning

## Problem

AL-AMIN needs live Supabase catalog evidence for a future no-data bootstrap
baseline. The evidence must contain database and security metadata only; it
must not expose application rows, Auth users, Storage objects, credentials, or
secrets, and it must not change production.

The proposed temporary PostgreSQL login has two independent problems:

1. A password embedded in `CREATE ROLE` or `ALTER ROLE` inside the Dashboard SQL
   Editor can be retained in editor history or database statement logging.
   PostgreSQL explicitly warns that a password supplied in SQL may be exposed
   through client history or server logs.
2. A newly created role still receives effective `PUBLIC` privileges. In this
   project, any `PUBLIC` table privilege or application-function `EXECUTE`
   privilege would make a nominally catalog-only login broader than intended.
   `NOINHERIT` does not remove `PUBLIC` privileges.

The safest option must therefore minimize total risk, not merely avoid writes.
It must account for credential handling, effective privileges, production
traces, cleanup reliability, and the chance of accidentally reading real data.

Relevant current platform facts:

- Supabase supports custom Postgres roles and has offered Dashboard role
  management, but the published role guidance still describes password logins
  through `CREATE ROLE ... LOGIN PASSWORD` and does not document a
  catalog-only, password-safe, expiring role profile.
- The Supabase Platform Read-Only role and read-only SQL path use
  `supabase_read_only_user`, which has PostgreSQL `pg_read_all_data`. This is
  mutation-safe but **not data-inaccessible** and therefore fails the AL-AMIN
  no-production-row requirement.
- Project-scoped Supabase MCP can be configured with `read_only=true`, but
  Supabase warns against connecting MCP to production, and read-only mode still
  does not create the required catalog-only boundary.
- The Dashboard SQL Editor operates through the project's `postgres` role and
  records operator/source metadata. This is too privileged for unattended
  extraction, but it can support a short, human-operated, fixed metadata-only
  procedure without creating or transmitting a new credential.

Sources:

- [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase Platform access control](https://supabase.com/docs/guides/platform/access-control)
- [Supabase MCP security and read-only mode](https://supabase.com/docs/guides/ai-tools/mcp)
- [Supabase Dashboard SQL Editor activity](https://supabase.com/docs/guides/troubleshooting/tracking-postgres-role-activity-to-specific-dashboard-users-8d3715)
- [PostgreSQL `CREATE ROLE`](https://www.postgresql.org/docs/current/sql-createrole.html)

## Options

### Option A — Supabase Dashboard native database-role creation

**Description.** Viktor creates and later deletes a custom Postgres login using
the Dashboard role-management UI, if that UI is available for the project.

| Criterion | Assessment |
| --- | --- |
| Security | Better than pasting a plaintext password into SQL only if the UI has a documented secret-safe backend; current public documentation does not establish that guarantee. |
| Minimum rights | Custom role attributes may be configurable, but a role still receives `PUBLIC` privileges and the UI does not prove a catalog-only profile. |
| Audit traces | Role creation/deletion and related administration remain production changes. Password-handling and UI-history behavior are not sufficiently documented for this use. |
| Removal | UI deletion is possible, but deletion can fail if the role owns objects or has dependencies. |
| Metadata-only suitability | Unproven. No published native preset guarantees catalogs without rows/functions. |
| Wrong-access risk | Medium to high because one checkbox, inherited/default privilege, or `PUBLIC` function can exceed the boundary. |

**Decision:** reject for this audit unless Supabase provides project-specific,
documented evidence that the UI creates an expiring catalog-only login without
exposing or retaining the password and without data/function privileges.

### Option B — PostgreSQL role provisioning without a plaintext password in SQL history

**Description.** An owner-operated secure Postgres client creates the restrictive
role and sets its password through an interactive password facility such as
`psql`'s `\password`, rather than embedding a plaintext password in SQL text.

| Criterion | Assessment |
| --- | --- |
| Security | Avoids plaintext in local command history, but requires a direct owner database connection, careful verifier/log handling, TLS validation, and secure local credential storage. |
| Minimum rights | Potentially strongest if preflight proves no disallowed `PUBLIC` rights and the role receives only `CONNECT`; missing metadata must remain `UNKNOWN`. |
| Audit traces | Role DDL, password-verifier handling, connection activity, verification, and deletion still leave legitimate production audit traces. |
| Removal | Explicit `REVOKE CONNECT` and exact `DROP ROLE`; deletion must be verified. Cleanup failure remains possible. |
| Metadata-only suitability | Conditional. It is suitable only after effective-privilege preflight passes; otherwise the role is not catalog-only. |
| Wrong-access risk | Medium. Owner connection mistakes, wrong target, `PUBLIC` grants, or an incomplete cleanup can violate the boundary. |

This option also conflicts with the current workstream's boundary: do not ask
for, copy, or expose the production database-owner password. No approved local
owner connection or password-safe operator path currently exists. Creating one
would be a separate, human-approved access expansion.

**Decision:** retain only as a future fallback after separate approval. Do not
perform it during the current audit package.

### Option C — Existing Supabase Read-Only / Management API / MCP mechanism

**Description.** Use a project-scoped Supabase Read-Only member, the beta
read-only SQL endpoint, or project-scoped MCP with `read_only=true`.

| Criterion | Assessment |
| --- | --- |
| Security | Strong prevention of mutations, especially with project scoping and restricted feature groups. It still authorizes reads that are broader than catalog metadata. |
| Minimum rights | Fails the requirement. Supabase documents that `supabase_read_only_user` has `pg_read_all_data`; the Platform Read-Only role can also access secrets. |
| Audit traces | Platform/OAuth/API/MCP access and query traces remain. A token or OAuth session adds another credential surface. |
| Removal | Member/OAuth/token/MCP access can be revoked, but requires platform access management and post-revocation verification. |
| Metadata-only suitability | No. A fixed query may be metadata-only, but the identity itself can read production rows. |
| Wrong-access risk | High for this threat model because an accidental or injected `SELECT` can return real data while remaining technically read-only. |

**Decision:** reject. Read-only is not equivalent to catalog-only.

### Option D — Owner-operated fixed metadata capture without a new audit identity

**Description.** Viktor uses his already authenticated owner-controlled
Dashboard session to run a separately reviewed, fixed, `READ ONLY` transaction
containing only allowlisted catalog queries. No role, password, token, API key,
MCP connection, CLI login, or database connection string is created or shared.
The procedure is manual, one block at a time, with an explicit human approval
before execution and output redaction before any artifact leaves Viktor's
machine.

| Criterion | Assessment |
| --- | --- |
| Security | Lowest credential and provisioning risk. The session itself is highly privileged, so safety depends on a fixed reviewed query package, `READ ONLY` transaction enforcement, one-action-at-a-time execution, and immediate stop on unexpected output. |
| Minimum rights | Not least privilege at the account level; it is least-action at the procedure level. No new identity receives any right. |
| Audit traces | Only the reviewed metadata query text and existing Dashboard operator attribution are expected; no role/password DDL, new credential, membership, or cleanup DDL is introduced. Query results must not be saved as Dashboard snippets or screenshots. |
| Removal | No access object exists to revoke. Cleanup consists of closing the query/result tabs, deleting raw local output, retaining only redacted evidence and hashes, and ending the audit window. Existing owner access remains unchanged. |
| Metadata-only suitability | Yes, if the package queries only approved `pg_catalog`/`information_schema` metadata plus explicitly approved Storage/Auth configuration metadata, never application/Auth/Storage-object rows. |
| Wrong-access risk | Medium because the operator session is privileged; reduced by human review, exact allowlist, `READ ONLY`, no dynamic SQL, no application function calls, no saved snippets, and output validation. |

**Decision:** recommended under the current constraints.

## Recommended approach

Use **Option D: owner-operated fixed metadata capture without creating a new
audit identity**.

This is the safest available method because it introduces no new production
credential, role, membership, grant, API token, direct database connection, or
cleanup dependency. It also avoids Supabase's broad `pg_read_all_data`
read-only role and avoids putting a temporary password in SQL/history/logs.

The tradeoff is explicit: Viktor's Dashboard session remains privileged. This
is acceptable only for a short human-operated procedure whose SQL is reviewed
in advance and structurally constrained to:

1. one transaction declared `READ ONLY`;
2. fixed `SELECT` statements against an allowlist of catalog sources;
3. no dynamic SQL, DDL, DML, `COPY`, dump, migration, RPC, application-function
   call, user/session/log query, Storage-object query, or data-bearing view;
4. schema-qualified object references;
5. bounded statement and output size;
6. one action at a time with Viktor's confirmation;
7. local redaction/validation before evidence is shared;
8. `UNKNOWN` for any field that cannot be collected safely.

This recommendation supersedes execution of the role-creation block in
`AUDIT_IDENTITY_FINAL_SQL_PACKAGE.md`. That document remains evidence of the
rejected/conditional provisioning design and its verification requirements; it
must not be executed in the current Dashboard-only workflow.

If a separately authenticated catalog-only identity remains a non-negotiable
requirement, this stage is blocked until Supabase supplies a documented
catalog-only JIT profile or Viktor approves a secure local owner-operated client
path and the effective-privilege preflight passes. Do not improvise one.

## Required Viktor actions

Before any live evidence collection, Viktor must:

1. keep the confirmed AL-AMIN project open and make no Dashboard configuration
   change;
2. review the future exact metadata-query package in full before running it;
3. verify that every statement is a schema-qualified, allowlisted metadata
   `SELECT` inside a `READ ONLY` transaction;
4. confirm that no statement reads application rows, Auth users/sessions,
   `storage.objects`, logs, uploaded files, secrets, or data-bearing views;
5. execute one approved block at a time and stop on any unexpected row shape,
   sensitive value, permission request, or non-`SELECT` statement;
6. save raw results only in a temporary local folder outside Git and outside
   synchronized/shared folders;
7. run the approved secret/PII scan and retain only redacted JSON/Markdown,
   hashes, counts, object identifiers, `UNKNOWN` items, and an attestation;
8. close the audit/result tabs and remove raw temporary output after validation.

Viktor must not share his Dashboard session, browser cookies, owner password,
project secrets, API keys, tokens, connection string, raw query output, or raw
screenshots with Codex.

## Forbidden actions

- Do not execute `AUDIT_IDENTITY_FINAL_SQL_PACKAGE.md` in the current Dashboard
  workflow.
- Do not create a database role, login, password, membership, grant, default
  privilege, API key, token, MCP authorization, or direct database connection.
- Do not use Platform Read-Only, `supabase_read_only_user`, `pg_read_all_data`,
  `service_role`, a secret key, Management API write access, `supabase login`,
  `supabase link`, or an application user as a substitute.
- Do not read application/Auth/Storage-object rows, row counts, user records,
  emails, uploaded files, logs, backups, dumps, or secrets.
- Do not execute DML, DDL, migrations, functions/RPCs, triggers, jobs, Auth
  operations, Storage operations, dynamic SQL, or error-based privilege probes.
- Do not save SQL as a shared Dashboard snippet or retain raw Dashboard
  screenshots/results.
- Do not broaden production permissions to make an unavailable metadata field
  visible. Record it as `UNKNOWN`.

## Cleanup

Because the recommended approach creates no audit identity, cleanup must not
run `REVOKE`, `DROP ROLE`, `DROP OWNED`, `REASSIGN OWNED`, or any other database
mutation.

After the last approved metadata block, Viktor:

1. ends the read-only transaction normally;
2. closes the SQL Editor result and query tabs without saving a shared snippet;
3. confirms no role, login, grant, token, MCP authorization, CLI link, or direct
   database credential was created;
4. scans the local output and retains only redacted evidence and hashes;
5. deletes raw temporary output and any non-redacted screenshots;
6. records a short cleanup attestation and the list of `UNKNOWN` fields;
7. verifies that Git remains unchanged except for approved documentation.

No production access is removed because no new access was created. Viktor's
pre-existing owner account remains governed by the organization's normal access
controls; this audit package does not modify it.
