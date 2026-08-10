# Read-only Supabase Audit Access Plan

## Goal

Prepare a time-bounded, evidence-only way to inspect the live AL-AMIN Supabase catalog for baseline reconciliation without giving Codex, a third party, or a reusable integration any production administrator, `service_role`, database-owner, or data-export access.

The permitted result is redacted metadata only: object definitions and security posture needed by `BASELINE_ACCEPTANCE_CRITERIA.md`. It excludes table rows, Auth users, sessions, Storage objects, file contents, production secrets, connection strings, JWTs, and database passwords.

No access is created or used by this plan. It is an authorization and operating procedure for a later, separately approved read-only evidence task.

## Security principles

- **Least privilege and single purpose:** the audit identity is restricted to catalog metadata for one project and has no application-data privileges.
- **No credential transfer:** Viktor creates, stores, uses, and later removes any temporary audit credential. It is never pasted into chat, committed, written to `.env*`, or made available to Codex.
- **Owner-operated extraction:** Viktor runs the pre-approved metadata-only extractor locally and supplies only its redacted output. Codex does not log in, link a project, or connect directly to production.
- **Fail closed:** if a required catalog field would require table-data access, `service_role`, an Admin/Management API token, an executable application function, or broader role membership, that field remains `UNKNOWN`; access is not broadened.
- **No hidden data reads:** no query may select from application, Auth, or Storage object tables; count rows; invoke an application function; enumerate users; download files; or create any dump.
- **Time bound and auditable:** use one short-lived identity, one project, one documented purpose, a connection limit, a defined expiry, and recorded cleanup evidence.
- **Redaction before sharing:** scan all output for secrets and personal data. Function source or defaults with a possible secret are retained only by Viktor for review; the shared evidence records a redacted definition/digest and an `UNKNOWN` item.

## Available options

| Option | What it can provide | Security assessment | Decision |
| --- | --- | --- | --- |
| A. Temporary catalog-only database role, operated by Viktor | Detailed Postgres catalog metadata: relations, columns, constraints, indexes, RLS, policies, ACLs, functions, views, triggers, extensions, and database settings where visible | Best complete option if it has no data grants, no privileged memberships, no bypass attributes, and its credential remains with Viktor | **Recommended core access** |
| B. Supabase Dashboard metadata inspection by Viktor | Auth/provider settings and selected Database/Storage metadata visible in the UI without sharing a credential | Useful as a narrow supplementary channel; incomplete for exact grants, default privileges, triggers, and normalized definitions | Supplement only |
| C. Existing integration | Acceptable only if it is already single-project, metadata-only, credential-isolated, time-bound, and independently evidenced not to read data or secrets | Do not assume one exists; validate effective privileges before use | Conditional fallback |
| D. Dashboard Read-Only member role, Management API/MCP, `pg_read_all_data`, replica, dump, or application API key | May expose data, secrets, broad project metadata, or a reusable control path | Incompatible with this audit's no-data/no-admin requirement | Rejected |

Supabase documents that its Dashboard Read-Only role is available only on certain plans, can access secrets, and runs SQL snippets through a role with `pg_read_all_data`. PostgreSQL defines `pg_read_all_data` as read access to all tables, views, and sequences. Those properties violate this audit's no-data requirement. See [Supabase access control](https://supabase.com/docs/guides/platform/access-control) and [PostgreSQL predefined roles](https://www.postgresql.org/docs/current/predefined-roles.html).

## Recommended approach

Use a **Viktor-operated, temporary catalog-only database role** for database metadata, plus a **manual Dashboard configuration checklist** for Auth-only settings that do not live in the Postgres catalog.

The audit role is not an application role and must not be granted application privileges. It exists only long enough for Viktor to run a fixed, separately reviewed catalog extractor from a trusted local workstation. The extractor must address only `pg_catalog` and `information_schema` metadata, plus the minimum Supabase metadata views necessary to inspect bucket configuration and policies. It must never read user/application/Storage-object rows or invoke application functions.

The role credential stays with Viktor. Codex receives only a redacted metadata artifact, not a connection string, password, token, project key, or interactive session. This avoids adding an automated production control channel while still permitting a reproducible evidence record.

Dashboard inspection is restricted to configuration screens needed for provider, email-flow, session, and MFA requirements. Viktor must not open user lists, table rows, Storage object lists, logs containing user data, API-key pages, or secret-management pages. Dashboard inspection fills only fields unavailable from the limited database catalog and must be marked `UNKNOWN` if the UI cannot show them without exposing secrets or data.

## Required permissions

The following is a conceptual minimum for the later, separately approved setup; it is not a command set and must not be applied during this planning stage.

### Audit identity attributes

- one uniquely named, project-specific audit login;
- `LOGIN` only for the short audit window, with a single connection limit and a fixed expiry;
- `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, and no ownership of application objects;
- no membership in `postgres`, `supabase_admin`, `service_role`, `dashboard_user`, `anon`, `authenticated`, `supabase_auth_admin`, `supabase_storage_admin`, or any application moderation/admin role;
- no membership in `pg_read_all_data`, `pg_write_all_data`, `pg_monitor`, `pg_read_all_settings`, `pg_read_all_stats`, `pg_stat_scan_tables`, server-file roles, signal roles, replication roles, or broad internal Supabase roles;
- database connection permission limited to the one AL-AMIN project, and only the normal visibility required for system catalog inspection.

### Metadata scope

The approved extractor may obtain only:

- object names, schemas, column/type/constraint/index metadata, dependency metadata, and extension/version metadata;
- RLS enabled/forced state, policy definitions, role references, and ACL/default-ACL metadata;
- function signatures, return types, language, security mode, `search_path`, owners, ACLs, and redacted/hashed definitions;
- view definitions/security options/ACLs and trigger definition metadata;
- bucket configuration and `storage.objects` policy metadata without reading `storage.objects` rows;
- PostgreSQL version and security-relevant non-secret settings;
- manually recorded, redacted Auth configuration metadata from the Dashboard.

Before use, Viktor must verify and record that the proposed identity has no effective `SELECT` privilege on application, `auth`, or `storage` data tables. If `PUBLIC` grants allow execution of a mutable application function, the role is not suitable for unattended or Codex-operated access; the output must instead be produced directly by Viktor using the fixed metadata extractor, or the affected field remains `UNKNOWN`.

## Forbidden permissions

- table, view, sequence, or Storage-object data access, including `SELECT`, row counts, exports, backups, replicas, or dumps;
- all write privileges: `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`, `COMMENT`, `SECURITY LABEL`, `COPY`, migration actions, and configuration changes;
- `BYPASSRLS`, `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION`, server-file/program roles, backend signalling, or role membership that supplies those capabilities;
- `service_role`, secret keys, publishable/anon keys, Management API access tokens, project database password, Auth admin APIs, Dashboard secret access, or a persistent CLI login/link;
- execution of application RPCs, triggers, background jobs, email functions, Auth operations, or Storage operations;
- access to Auth users, identities, sessions, MFA factors, uploaded files, application rows, reviews, complaints, audit records, or logs.

## User steps

These are instructions for Viktor to review and explicitly authorize in a later task. Do not perform them now.

1. Confirm the target is the single AL-AMIN production project and that the audit window is acceptable. Record a human-readable audit purpose and a short expiry.
2. Check whether an existing integration already meets every required and forbidden permission above. If not, do not repurpose an admin, application, or Dashboard Read-Only identity.
3. In a separately approved owner-controlled action, create one temporary catalog-audit login with only the attributes and scope stated above. Generate its credential in Viktor's password manager; do not disclose it to Codex or store it in the repository.
4. Before catalog collection, verify effective privileges are metadata-only. In particular, verify no table-data `SELECT`, no broad predefined-role membership, no bypass attribute, and no effective ability to invoke a mutable application function unattended. Any failure ends the attempt rather than broadening access.
5. Run the separately reviewed, fixed metadata extractor locally. It must use an allowlist of catalog views and queries, never dynamic object execution, never `SELECT` from business/Auth/Storage-object tables, and never row counts or dumps.
6. Run a local secret/PII scan on the extractor output. Redact or withhold any suspicious literal, identifier, email, token, URL with credentials, function body constant, or configuration value. Preserve only the safe metadata required for the evidence manifest.
7. Use the Dashboard only for the limited Auth configuration checklist. Do not open user, secret, API-key, table-data, object-data, or log pages. Record unavailable fields as `UNKNOWN`.
8. Provide the redacted metadata evidence and a privilege/expiry attestation for reconciliation. Do not provide a connection string, password, token, JWT, project secret, service-role key, or database dump.

## Cleanup after audit

1. End all audit sessions and preserve only the redacted evidence artifact and the audit attestation.
2. In a separately approved owner action, revoke the audit identity's project connection capability and remove the temporary login/role. Do not retain it for convenience or future testing.
3. Delete the temporary credential from Viktor's password manager only after removal is confirmed; do not store it in tickets, source, documents, shell history, CI variables, or `.env*` files.
4. Verify the identity can no longer connect and that no memberships, grants, default privileges, scheduled jobs, storage rules, or Auth settings were changed by the audit.
5. Record only the cleanup result, expiry, evidence hash, and discrepancy references. Do not retain production data, raw dashboard screenshots with sensitive content, or function source that contains secrets.

The resulting catalog evidence may support reconciliation but does not authorize baseline generation, security fixes, migrations, or any production change.
