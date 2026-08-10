# AL-AMIN Temporary Catalog-Only Audit Identity — Final SQL Package

## Status and execution boundary

This is a **human-review-only** package. It is not permission to run SQL
automatically, and it must never be executed by Codex. Viktor alone may review
and manually run a selected block in the SQL Editor for the confirmed AL-AMIN
production project.

The Dashboard SQL Editor executes statements with the project's `postgres`
database role. Therefore, even a metadata-only `SELECT` must be reviewed before
execution, and every `CREATE ROLE`, `GRANT`, `REVOKE`, and `DROP ROLE` below is
a production change. This package contains no project reference, connection
string, real password, token, user identifier, or production data.

Use a new, lower-case audit role name such as
`alamin_catalog_audit_YYYYMMDD_hhmm` and a UTC expiry no more than 30 minutes
after the intended audit window. Do not save a populated copy in Git, chat, a
note, shell history, or a synchronized folder.

### Non-negotiable password-handling gate

The template below shows the unavoidable `PASSWORD` clause so a human can
review the exact role attributes. **It is not approved for execution in the
Supabase Dashboard SQL Editor with a real password.** PostgreSQL warns that an
unencrypted password supplied to `CREATE ROLE` can be transmitted in cleartext
and can be retained by client history or server logs. Supabase documents that
Dashboard SQL Editor activity is routed through `postgres` and its default DDL
logging records schema-level statements. A real audit password must not appear
in Dashboard query history, server logs, this repository, chat, or a copied SQL
file.

Therefore this package is **review-complete but execution-blocked** until Viktor
has separately approved a credential-safe owner-operated provisioner that does
not expose the temporary password to those locations. This package does not
define that provisioner, request an owner password, or authorize any workaround
such as an API token, `service_role`, or a copied database connection string.
The preflight and verification queries remain useful as metadata-only review
material, but the creation block must not be run from the Dashboard in the
current workflow.

The package deliberately grants no access to application schemas, tables,
views, sequences, Storage objects, Auth records, or application functions.
The only positive grant is `CONNECT` to the already confirmed database.

PostgreSQL roles are cluster-level objects, `VALID UNTIL` expires the password
rather than deleting the role, and a connection limit is only a guardrail. The
cleanup block is therefore mandatory. References: [PostgreSQL `CREATE ROLE`
documentation](https://www.postgresql.org/docs/current/sql-createrole.html) and
[Supabase Dashboard SQL Editor activity guidance](https://supabase.com/docs/guides/troubleshooting/tracking-postgres-role-activity-to-specific-dashboard-users-8d3715).

## 1. Setup SQL

### 1.1 Required preflight — run first, read the result, and stop on any row

These catalog-only queries run in Viktor's existing Dashboard session. They do
not read application rows, call application functions, or change the project.
They are a gate: if any query below returns a row, **do not create the audit
identity**. Record the affected metadata as `UNKNOWN` and close the editor.

The first query checks that the selected database name is the one Viktor
expects. Copy its result into `{{CONFIRMED_DATABASE_NAME}}`; do not guess it.

```sql
-- Expected: exactly one database name that Viktor recognizes as the selected
-- AL-AMIN production database. No table rows are read.
SELECT datname
FROM pg_database
WHERE datname = current_database();
```

```sql
-- Expected: zero rows. A collision means choose a different unique audit name.
SELECT rolname
FROM pg_roles
WHERE rolname = '{{AUDIT_IDENTITY}}';
```

```sql
-- Expected: zero rows. A row means PUBLIC can execute an application or
-- Supabase-managed non-system function. Do not weaken production grants or
-- create the temporary login; this package cannot subtract a PUBLIC grant from
-- one role only.
WITH candidate_functions AS (
  SELECT
    n.nspname AS schema_name,
    p.oid,
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    COALESCE(p.proacl, acldefault('f', p.proowner)) AS acl
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
)
SELECT schema_name, proname, arguments
FROM candidate_functions AS f
WHERE EXISTS (
  SELECT 1
  FROM aclexplode(f.acl) AS a
  WHERE a.grantee = 0
    AND a.privilege_type = 'EXECUTE'
)
ORDER BY schema_name, proname, arguments;
```

```sql
-- Expected: zero rows. A row means PUBLIC has data or mutation access on a
-- non-system relation, including a table, view, materialized view, foreign
-- table, partitioned table, or sequence. Do not create the audit login.
WITH candidate_relations AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS relation_name,
    c.relkind,
    COALESCE(c.relacl, acldefault('r', c.relowner)) AS acl
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
)
SELECT schema_name, relation_name, relkind, a.privilege_type
FROM candidate_relations AS r
CROSS JOIN LATERAL aclexplode(r.acl) AS a
WHERE a.grantee = 0
  AND a.privilege_type IN (
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
    'REFERENCES', 'TRIGGER', 'USAGE'
  )
ORDER BY schema_name, relation_name, a.privilege_type;
```

```sql
-- Expected: zero rows. A row means PUBLIC could create objects in a non-system
-- schema. Do not create the audit login.
WITH candidate_schemas AS (
  SELECT
    nspname AS schema_name,
    COALESCE(nspacl, acldefault('n', nspowner)) AS acl
  FROM pg_namespace
  WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
)
SELECT schema_name, a.privilege_type
FROM candidate_schemas AS s
CROSS JOIN LATERAL aclexplode(s.acl) AS a
WHERE a.grantee = 0
  AND a.privilege_type = 'CREATE'
ORDER BY schema_name;
```

The function check is intentionally strict. PostgreSQL normally grants
`EXECUTE` on new functions to `PUBLIC`; a role receives `PUBLIC` privileges even
with `NOINHERIT`. Removing a `PUBLIC` grant would affect production and is
outside this audit. If the check returns a row, the safe result is to stop:
there is no compliant catalog-only login under this package.

### 1.2 Creation block — template for human review; do not execute in Dashboard

`{{PRIVATE_PASSWORD_HELD_BY_VIKTOR}}` is a placeholder, not a password. It
illustrates the required role clause but must not be replaced in this document
or the Dashboard SQL Editor. A later approved, credential-safe mechanism may
populate it only locally under Viktor's control, after its handling and logging
properties have been reviewed.

```sql
-- Creates one temporary login with restrictive attributes.
-- Gives no membership in any existing role and no ownership of application
-- objects. The password expires at the stated UTC time; the cleanup block still
-- has to delete the role.
CREATE ROLE "{{AUDIT_IDENTITY}}"
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS
  CONNECTION LIMIT 1
  PASSWORD '{{PRIVATE_PASSWORD_HELD_BY_VIKTOR}}'
  VALID UNTIL '{{UTC_EXPIRY_ISO_8601}}';

-- The sole positive grant. It allows a session to reach the already confirmed
-- database; it grants no schema, table, view, sequence, function, Storage, or
-- Auth privilege.
GRANT CONNECT ON DATABASE "{{CONFIRMED_DATABASE_NAME}}"
  TO "{{AUDIT_IDENTITY}}";
```

| Action | What it does | Why it is needed | Positive right created | Residual risk |
| --- | --- | --- | --- | --- |
| `CREATE ROLE ... LOGIN` | Creates a distinct temporary identity | Separates the audit from application and owner accounts | One login only | A role is a production object until cleanup deletes it; in the current Dashboard-only path the password-handling gate blocks execution |
| Restrictive role attributes | Blocks administration, replication, bypass, database creation, and inherited memberships | Prevents privilege escalation | None | Attributes do not neutralize pre-existing `PUBLIC` grants; preflight covers them |
| `CONNECTION LIMIT 1` and `VALID UNTIL` | Bounds concurrent use and password lifetime | Reduces exposure window | At most one normal connection, approximately enforced | It does not delete the role or end an already open session |
| `GRANT CONNECT` | Lets the fixed extractor open one database session | Required for later metadata collection | Connection to the confirmed database only | A connection is not data access, but unexpected effective privileges are checked before extraction |

Never add another `GRANT` to make a missing metadata field visible. Mark that
field `UNKNOWN` instead. In particular, do not grant `USAGE` or `CREATE` on an
application schema; `SELECT` on a table, view, sequence, Auth relation, or
`storage.objects`; `EXECUTE` on an application function; membership in a
Supabase/application role; `pg_read_all_data`; `pg_monitor`; server-file,
replication, or bypass roles; or any `GRANT ALL`.

## 2. Verification SQL

Run these queries after the creation block and before any extractor is allowed
to connect. They inspect role and privilege metadata only. A query that returns
an `unexpected` row is a stop condition: do not broaden access; run the cleanup
block and record the affected evidence as `UNKNOWN`.

```sql
-- Expected: one row with every restrictive attribute shown as false, except
-- rolcanlogin = true; rolconnlimit = 1; and the reviewed UTC expiry.
SELECT
  rolname,
  rolcanlogin,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolinherit,
  rolreplication,
  rolbypassrls,
  rolconnlimit,
  rolvaliduntil
FROM pg_roles
WHERE rolname = '{{AUDIT_IDENTITY}}';
```

```sql
-- Expected: zero rows. The audit identity must not be a member of, or contain,
-- any other role.
SELECT
  parent.rolname AS parent_role,
  member.rolname AS member_role
FROM pg_auth_members AS m
JOIN pg_roles AS parent ON parent.oid = m.roleid
JOIN pg_roles AS member ON member.oid = m.member
WHERE parent.rolname = '{{AUDIT_IDENTITY}}'
   OR member.rolname = '{{AUDIT_IDENTITY}}';
```

```sql
-- Expected: zero rows. This catches effective read/write privileges on every
-- non-system table-like object, including inherited PUBLIC privileges.
WITH candidate_relations AS (
  SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind, c.oid
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
)
SELECT schema_name, relation_name, relkind, privilege_name
FROM candidate_relations AS r
CROSS JOIN LATERAL (
  VALUES
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
    ('REFERENCES'), ('TRIGGER')
) AS wanted(privilege_name)
WHERE has_table_privilege(
  '{{AUDIT_IDENTITY}}', r.oid, wanted.privilege_name
)
ORDER BY schema_name, relation_name, privilege_name;
```

```sql
-- Expected: zero rows. Sequences can reveal/change values, so neither SELECT,
-- USAGE, nor UPDATE is permitted.
SELECT n.nspname AS schema_name, c.relname AS sequence_name, privilege_name
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL (VALUES ('SELECT'), ('USAGE'), ('UPDATE')) AS wanted(privilege_name)
WHERE c.relkind = 'S'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND has_sequence_privilege(
    '{{AUDIT_IDENTITY}}', c.oid, wanted.privilege_name
  )
ORDER BY schema_name, sequence_name, privilege_name;
```

```sql
-- Expected: zero rows. This checks for a DDL path through an application schema
-- or the selected database.
SELECT 'schema CREATE' AS unexpected_privilege, nspname AS object_name
FROM pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND has_schema_privilege('{{AUDIT_IDENTITY}}', oid, 'CREATE')
UNION ALL
SELECT 'database CREATE', datname
FROM pg_database
WHERE datname = '{{CONFIRMED_DATABASE_NAME}}'
  AND has_database_privilege('{{AUDIT_IDENTITY}}', oid, 'CREATE');
```

```sql
-- Expected: zero rows. The audit identity must not execute an application or
-- Supabase-managed non-system function, whether directly granted or inherited
-- through PUBLIC. System-catalog helper functions are outside this test and may
-- be used only by the fixed metadata procedure.
SELECT
  n.nspname AS schema_name,
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND has_function_privilege('{{AUDIT_IDENTITY}}', p.oid, 'EXECUTE')
ORDER BY schema_name, proname, arguments;
```

```sql
-- Expected: zero rows. The identity must own no object and hold no audit-specific
-- default privilege. Ownership would create an unexpected DDL path.
SELECT 'relation ownership' AS unexpected_path,
       n.nspname || '.' || c.relname AS object_name
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_roles AS r ON r.oid = c.relowner
WHERE r.rolname = '{{AUDIT_IDENTITY}}'
UNION ALL
SELECT 'schema ownership', n.nspname
FROM pg_namespace AS n
JOIN pg_roles AS r ON r.oid = n.nspowner
WHERE r.rolname = '{{AUDIT_IDENTITY}}'
UNION ALL
SELECT 'default privilege', defaclnamespace::regnamespace::text
FROM pg_default_acl AS d
JOIN pg_roles AS r ON r.oid = d.defaclrole
WHERE r.rolname = '{{AUDIT_IDENTITY}}';
```

The package does not test a failed `INSERT`, `UPDATE`, `DELETE`, `DROP`,
`CREATE`, `SELECT`, Storage operation, or application function call. Such a
test would itself be an attempted production action or data access. The catalog
privilege checks above are the approved evidence.

## 3. Cleanup SQL

Before cleanup, Viktor closes the extractor and its one audit session. Do not
terminate unrelated sessions. Run the ownership/dependency query first; if it
returns a row, stop and investigate rather than modifying an unrelated object.

```sql
-- Expected: zero rows before DROP ROLE. A non-empty result is a cleanup blocker.
SELECT 'relation ownership' AS dependency,
       n.nspname || '.' || c.relname AS object_name
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_roles AS r ON r.oid = c.relowner
WHERE r.rolname = '{{AUDIT_IDENTITY}}'
UNION ALL
SELECT 'schema ownership', n.nspname
FROM pg_namespace AS n
JOIN pg_roles AS r ON r.oid = n.nspowner
WHERE r.rolname = '{{AUDIT_IDENTITY}}'
UNION ALL
SELECT 'role membership', parent.rolname || ' -> ' || member.rolname
FROM pg_auth_members AS m
JOIN pg_roles AS parent ON parent.oid = m.roleid
JOIN pg_roles AS member ON member.oid = m.member
WHERE parent.rolname = '{{AUDIT_IDENTITY}}'
   OR member.rolname = '{{AUDIT_IDENTITY}}';
```

```sql
-- Remove the only explicit positive grant, then delete the exact temporary role.
-- Do not use REASSIGN OWNED, DROP OWNED, or a broad revoke: they could affect
-- unrelated production objects or roles.
REVOKE CONNECT ON DATABASE "{{CONFIRMED_DATABASE_NAME}}"
  FROM "{{AUDIT_IDENTITY}}";

DROP ROLE "{{AUDIT_IDENTITY}}";
```

```sql
-- Expected: zero rows. This is the deletion attestation.
SELECT rolname
FROM pg_roles
WHERE rolname = '{{AUDIT_IDENTITY}}';
```

After the zero-row deletion result, remove the temporary password from Viktor's
password manager. Retain only redacted evidence, its hashes, and a non-secret
cleanup attestation.

## 4. Human approval checklist

Before running **any** query or statement in this package, Viktor confirms:

- [ ] The correct AL-AMIN production project is open in the Dashboard.
- [ ] This full SQL package has been read, including every `Expected:` result
      and stop condition.
- [ ] The audit role name is new, lower-case, specific to this one run, and has
      no overlap with an existing role.
- [ ] The database name and a UTC expiry of 30 minutes or less are confirmed.
- [ ] No `service_role`, owner password, API key, token, JWT, connection string,
      or user data appears in the document or will be sent to Codex.
- [ ] No real password appears in a Dashboard SQL editor, its history, this
      document, Git, chat, a copied SQL file, or another retained location.
- [ ] A separate credential-safe owner-operated provisioner has been approved;
      otherwise the creation block remains unexecuted.
- [ ] All preflight checks returned zero rows where stated, except the one
      expected database-name confirmation.
- [ ] The cleanup and deletion verification blocks are ready before setup.
- [ ] A non-zero verification result will cause cleanup and `UNKNOWN`, not an
      additional privilege grant.

## 5. Rollback and emergency stop

| Situation | Required response |
| --- | --- |
| A preflight query returns a row | Do not run `CREATE ROLE`. Close the editor, record only the object identifier as `UNKNOWN`, and do not modify a `PUBLIC` or production grant. |
| The Dashboard-only process requires a real password in SQL | Do not run the creation block. This is the expected password-handling blocker; retain no password and select a separately approved credential-safe provisioner or a different audit method. |
| Setup fails before `CREATE ROLE` succeeds | Do not retry with altered permissions. Record the non-secret error class and stop. |
| `CREATE ROLE` succeeds but `GRANT CONNECT` or any verification fails | Do not run the extractor. Run the cleanup block for that exact identity; if it cannot be deleted, stop and retain only a non-secret cleanup-blocker note. |
| A verification query reveals data, mutation, DDL, ownership, membership, or application-function access | Do not test the access. Revoke `CONNECT`, drop the exact temporary role, and mark the evidence scope `UNKNOWN`. Do not change existing production grants as a workaround. |
| A password, token, user record, application row, upload, or secret is displayed or copied | Stop immediately. Do not share the output. Delete local temporary copies, revoke/delete the temporary identity if created, and report only that a safety stop occurred. |
| `DROP ROLE` fails | Do not use `REASSIGN OWNED`, `DROP OWNED`, broad `REVOKE`, or changes to existing roles. End the one audit client session, rerun only the dependency check, and treat any remaining dependency as a cleanup blocker. |

This package never authorizes a migration, schema change, RLS/policy change,
Storage/Auth change, remote CLI use, application query, data export, or
security fix.
