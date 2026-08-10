# AL-AMIN Metadata-Only Evidence Query Package

## Status and execution boundary

This document prepares a future, human-operated evidence collection. It does
not authorize execution now. None of the SQL in this document has been run
against local or remote Supabase.

The future operator is Viktor, using the already authenticated Dashboard
session for the confirmed AL-AMIN project. Every query block must be reviewed
and executed separately. Do not paste or run the full document as one script.
After each block, verify the result shape before continuing.

The package reads PostgreSQL system catalogs only, with one explicit exception:
`storage.buckets` may be read for bucket configuration metadata. It never reads
application tables, data-bearing views, Auth users/identities/sessions, or
`storage.objects`.

Authoritative references:

- [PostgreSQL system catalogs](https://www.postgresql.org/docs/current/catalogs.html)
- [PostgreSQL `pg_policy`](https://www.postgresql.org/docs/current/catalog-pg-policy.html)
- [Supabase Storage schema](https://supabase.com/docs/guides/storage/schema/design)
- [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase Auth/Storage/Realtime schema restrictions](https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025)

## Mandatory wrapper for every future SQL block

For future execution, place exactly one approved `SELECT`/`WITH` query between
this wrapper's `SET LOCAL` statements and `ROLLBACK`. A short, read-only
transaction reduces operational risk and prevents accidental DML/DDL in the
same transaction.

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- Paste exactly one approved query from this package here.

ROLLBACK;
```

`ROLLBACK` is intentional even though the transaction is read-only. Do not use
`BEGIN` without `READ ONLY`. Do not insert multiple evidence queries into one
transaction. Do not continue after a timeout, unexpected relation, unexpected
column, or sensitive-looking result.

## Catalog-helper allowlist

The rule “do not execute functions” means **no application, Auth, Storage,
extension, RPC, trigger, or user-defined function may be called**. PostgreSQL
stores several definitions as internal expression trees, so human-readable
metadata requires a small allowlist of built-in catalog helpers. This package
uses only these built-ins and aggregates:

- `current_setting` for the PostgreSQL version only;
- `format_type`;
- `pg_get_expr`;
- `pg_get_constraintdef`;
- `pg_get_indexdef`;
- `pg_get_function_identity_arguments`;
- `pg_get_function_result`;
- `pg_get_viewdef`;
- `acldefault` and `aclexplode`;
- `unnest`, `split_part`, `coalesce`, `array_agg`, and ordinary SQL aggregates.

These helpers render catalog metadata; they do not execute the catalogued
application function, view, trigger, policy, or index expression. Any helper or
function name outside this allowlist is a stop condition.

# 1. Database structure

Allowed evidence: schemas, tables, columns, types, nullability, defaults,
primary keys, foreign keys, and indexes. Object owner names are omitted unless
needed later for a security decision. Internal OIDs are used only for joins and
must not be included in retained evidence.

### 1.1 PostgreSQL version

```sql
SELECT current_setting('server_version') AS postgresql_version;
```

### 1.2 Non-system schemas

```sql
SELECT n.nspname AS schema_name
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname;
```

### 1.3 Tables and partitioned tables

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned_table'
  END AS table_kind
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, c.relname;
```

### 1.4 Columns

Column defaults and generated expressions are metadata, but they can contain
hard-coded literals. Treat `default_expression` as sensitive until the
redaction rules in section 8 pass.

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  a.attnum AS ordinal_position,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  NOT a.attnotnull AS is_nullable,
  CASE a.attidentity
    WHEN 'a' THEN 'always'
    WHEN 'd' THEN 'by_default'
    ELSE NULL
  END AS identity_mode,
  CASE a.attgenerated
    WHEN 's' THEN 'stored'
    WHEN 'v' THEN 'virtual'
    ELSE NULL
  END AS generated_mode,
  pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true) AS default_expression
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef AS ad
  ON ad.adrelid = a.attrelid
 AND ad.adnum = a.attnum
WHERE c.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, c.relname, a.attnum;
```

### 1.5 User-defined types and enum labels

```sql
SELECT
  n.nspname AS schema_name,
  t.typname AS type_name,
  CASE t.typtype
    WHEN 'e' THEN 'enum'
    WHEN 'd' THEN 'domain'
    WHEN 'c' THEN 'composite'
    WHEN 'r' THEN 'range'
    WHEN 'm' THEN 'multirange'
    ELSE 'other'
  END AS type_kind,
  e.enumsortorder,
  e.enumlabel
FROM pg_catalog.pg_type AS t
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_enum AS e ON e.enumtypid = t.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
  AND t.typtype IN ('e', 'd', 'c', 'r', 'm')
ORDER BY n.nspname, t.typname, e.enumsortorder;
```

### 1.6 Primary and foreign keys

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  CASE con.contype
    WHEN 'p' THEN 'primary_key'
    WHEN 'f' THEN 'foreign_key'
  END AS constraint_type,
  pg_catalog.pg_get_constraintdef(con.oid, true) AS definition,
  con.convalidated AS is_validated
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE con.contype IN ('p', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, c.relname, con.contype, con.conname;
```

### 1.7 Indexes

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  i.relname AS index_name,
  ix.indisprimary AS is_primary,
  ix.indisunique AS is_unique,
  ix.indisvalid AS is_valid,
  ix.indisready AS is_ready,
  pg_catalog.pg_get_indexdef(i.oid, 0, true) AS definition
FROM pg_catalog.pg_index AS ix
JOIN pg_catalog.pg_class AS c ON c.oid = ix.indrelid
JOIN pg_catalog.pg_class AS i ON i.oid = ix.indexrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, c.relname, i.relname;
```

No query in this section may be replaced with `SELECT * FROM` an application
schema, table, view, sequence, or materialized view. Do not collect row counts,
samples, sequence values, statistics values, or table contents.

# 2. RLS and policies

### 2.1 RLS state for every non-system table

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, c.relname;
```

### 2.2 Policy definitions

Policy expressions can contain literal values. `using_expression` and
`with_check_expression` remain raw local evidence until redaction passes.

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  p.polname AS policy_name,
  CASE p.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END AS command,
  p.polpermissive AS is_permissive,
  array_agg(
    CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE r.rolname END
    ORDER BY CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE r.rolname END
  ) AS roles,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid, true) AS using_expression,
  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, true) AS with_check_expression
FROM pg_catalog.pg_policy AS p
JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL unnest(p.polroles) AS role_list(role_oid)
LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = role_list.role_oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
GROUP BY n.nspname, c.relname, p.oid, p.polname, p.polcmd,
         p.polpermissive, p.polqual, p.polwithcheck, p.polrelid
ORDER BY n.nspname, c.relname, p.polname;
```

This query inspects policy expression trees; it does not evaluate a policy,
assume a role, or select a protected row.

### 2.3 Effective relation ACL entries

This catalog query records explicit/default ACL metadata for tables, views,
materialized views, partitioned tables, and foreign tables. It does not test a
privilege by selecting from the relation.

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned_table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
    WHEN 'f' THEN 'foreign_table'
  END AS relation_kind,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, c.relname, grantee, acl.privilege_type;
```

### 2.4 Schema ACLs and default privileges

```sql
SELECT
  n.nspname AS schema_name,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_namespace AS n
CROSS JOIN LATERAL pg_catalog.aclexplode(
  coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, grantee, acl.privilege_type;
```

```sql
SELECT
  owner_role.rolname AS owner_role,
  coalesce(n.nspname, 'ALL_SCHEMAS') AS schema_name,
  d.defaclobjtype AS object_type_code,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_default_acl AS d
JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = d.defaclrole
LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
ORDER BY owner_role, schema_name, object_type_code, grantee, acl.privilege_type;
```

# 3. Functions

The package collects signatures, return types, security mode, explicit
`search_path`, and effective ACL metadata. It deliberately omits function body
source (`prosrc`, `probin`, and `pg_get_functiondef`) and never calls a
catalogued function.

### 3.1 Function metadata

```sql
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) AS return_type,
  l.lanname AS language,
  CASE p.prokind
    WHEN 'f' THEN 'function'
    WHEN 'p' THEN 'procedure'
    WHEN 'a' THEN 'aggregate'
    WHEN 'w' THEN 'window'
  END AS routine_kind,
  p.prosecdef AS security_definer,
  CASE p.provolatile
    WHEN 'i' THEN 'immutable'
    WHEN 's' THEN 'stable'
    WHEN 'v' THEN 'volatile'
  END AS volatility,
  search_path_setting.configured_search_path
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
LEFT JOIN LATERAL (
  SELECT split_part(setting, '=', 2) AS configured_search_path
  FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS settings(setting)
  WHERE setting LIKE 'search_path=%'
  LIMIT 1
) AS search_path_setting ON true
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, p.proname,
         pg_catalog.pg_get_function_identity_arguments(p.oid);
```

### 3.2 Function privileges

```sql
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, p.proname,
         pg_catalog.pg_get_function_identity_arguments(p.oid),
         grantee, acl.privilege_type;
```

# 4. Views

Definitions are metadata, but they can contain hard-coded literals. Retain a
definition only after local secret/PII redaction. This package never selects
from the view itself.

### 4.1 View definitions and security properties

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS view_name,
  CASE c.relkind
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
  END AS view_kind,
  coalesce('security_invoker=true' = ANY(c.reloptions), false) AS security_invoker,
  coalesce('security_barrier=true' = ANY(c.reloptions), false) AS security_barrier,
  pg_catalog.pg_get_viewdef(c.oid, true) AS definition
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, c.relname;
```

### 4.2 View grants

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS view_name,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_temp_'
  AND n.nspname !~ '^pg_toast_temp_'
ORDER BY n.nspname, c.relname, grantee, acl.privilege_type;
```

# 5. Triggers

This query reads trigger catalog rows only. It does not call the trigger
function and omits encoded trigger arguments, which may contain arbitrary
literals.

```sql
SELECT
  table_ns.nspname AS table_schema,
  table_class.relname AS table_name,
  t.tgname AS trigger_name,
  CASE
    WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF'
    WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE'
    ELSE 'AFTER'
  END AS timing,
  (t.tgtype & 1) <> 0 AS for_each_row,
  (t.tgtype & 4) <> 0 AS on_insert,
  (t.tgtype & 8) <> 0 AS on_delete,
  (t.tgtype & 16) <> 0 AS on_update,
  (t.tgtype & 32) <> 0 AS on_truncate,
  function_ns.nspname AS function_schema,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS function_arguments,
  t.tgenabled AS enabled_mode
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS table_class ON table_class.oid = t.tgrelid
JOIN pg_catalog.pg_namespace AS table_ns ON table_ns.oid = table_class.relnamespace
JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace AS function_ns ON function_ns.oid = p.pronamespace
WHERE NOT t.tgisinternal
  AND table_ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND table_ns.nspname !~ '^pg_temp_'
  AND table_ns.nspname !~ '^pg_toast_temp_'
ORDER BY table_ns.nspname, table_class.relname, t.tgname;
```

# 6. Storage metadata

`storage.buckets` is the sole approved non-catalog relation in this package.
Supabase documents it as bucket configuration metadata. The query must select
only the five columns below. Do not add row counts, timestamps, owners, custom
metadata, or joins.

### 6.1 Bucket configuration

```sql
SELECT
  b.id AS bucket_id,
  b.name AS bucket_name,
  b.public AS is_public,
  b.file_size_limit,
  b.allowed_mime_types
FROM storage.buckets AS b
ORDER BY b.id;
```

If one of these documented columns is absent, stop and mark the bucket field
`UNKNOWN`. Do not inspect another Storage relation to compensate.

### 6.2 Storage RLS state and policies

```sql
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'storage'
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname;
```

```sql
SELECT
  c.relname AS table_name,
  p.polname AS policy_name,
  CASE p.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END AS command,
  p.polpermissive AS is_permissive,
  array_agg(
    CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE r.rolname END
    ORDER BY CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE r.rolname END
  ) AS roles,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid, true) AS using_expression,
  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, true) AS with_check_expression
FROM pg_catalog.pg_policy AS p
JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL unnest(p.polroles) AS role_list(role_oid)
LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = role_list.role_oid
WHERE n.nspname = 'storage'
GROUP BY c.relname, p.oid, p.polname, p.polcmd, p.polpermissive,
         p.polqual, p.polwithcheck, p.polrelid
ORDER BY c.relname, p.polname;
```

Hard prohibition: do not query, count, join, inspect, or export
`storage.objects`. Do not call Storage APIs or download a file.

# 7. Auth metadata

No Auth SQL query is approved in this package.

Provider enablement, email confirmation, session policies, and MFA controls are
service configuration, not reliable PostgreSQL catalog metadata. Querying
`auth.users`, `auth.identities`, `auth.sessions`, `auth.refresh_tokens`, MFA
factor tables, audit logs, or other Auth relations is prohibited.

At the future collection stage, Viktor may manually record only these visible
Dashboard configuration states without opening a provider's secret fields or a
user/session page:

- email sign-in enabled/disabled;
- email confirmation required/not required;
- enabled provider names only, without client IDs or secrets;
- session time-boxing controls, represented as booleans or durations only;
- MFA verification/enrollment policy state, without factors or user records.

If a state is not visible without opening a secret-bearing or user-bearing
screen, record the field as `UNKNOWN` with reason
`unsafe_or_unavailable_in_dashboard`. Do not use Management API, Admin API,
Auth API, browser developer tools, logs, or database tables as a workaround.

# 8. Redaction rules

Raw query results are temporary local evidence and must remain outside Git,
chat, synchronized folders, and shared screenshots. Before an artifact can be
retained or reconciled, apply all rules below:

1. Remove passwords, SCRAM/MD5 verifiers, connection strings, URI credentials,
   JWT-like values, publishable/anon/secret/service-role keys, OAuth/SMTP
   secrets, private-key material, cookies, tokens, and authorization headers.
2. Remove emails, phone numbers, personal names, application/user UUIDs,
   application IDs embedded as literals, profile/application/review/complaint
   content, file paths tied to users, and uploaded-object identifiers.
3. Inspect every default, constraint, policy, view, index, and search-path
   expression for literals. Replace a suspicious literal or entire expression
   with `REDACTED`; record only object identifier, reason, and a SHA-256 digest
   calculated locally after collection.
4. Bucket names/IDs are allowed only as Storage configuration identifiers. If a
   bucket identifier contains an email, user UUID, personal name, or other PII,
   replace it with `REDACTED_BUCKET_<stable-digest-prefix>`.
5. Role names are allowed security metadata. Redact any role name that matches
   an email address, personal name, UUID, or credential pattern.
6. Remove internal numeric OIDs, project refs, database hostnames, IP addresses,
   connection ports, Dashboard URLs, operator IDs, query-history IDs, and exact
   collection-session identifiers from retained artifacts.
7. Never infer a redacted value. Use `UNKNOWN` with a non-sensitive reason.

## Pre-execution static safety checklist

Before future execution, a reviewer must parse the SQL statements, not perform
a naive word search. Policy/ACL metadata legitimately contains string literals
such as `'INSERT'`, `'UPDATE'`, `'DELETE'`, or `'CREATE'`; those values describe
privileges and are not mutating statements. The reviewer confirms:

- [ ] Every block starts with `BEGIN TRANSACTION READ ONLY` and ends with
      `ROLLBACK` when assembled for execution.
- [ ] Evidence statements begin only with `SELECT` or `WITH`.
- [ ] No statement begins with or contains an executable `INSERT`, `UPDATE`,
      `DELETE`, `MERGE`, `TRUNCATE`, `COPY`, `CREATE`, `ALTER`, `DROP`, `GRANT`,
      `REVOKE`, `COMMENT`, `DO`, `CALL`, `EXECUTE`, `PREPARE`, migration command,
      or dynamic SQL operation. Descriptive string literals are not executed.
- [ ] No `FOR UPDATE`, `FOR SHARE`, advisory lock, temporary object, or session
      role change is present.
- [ ] Every relation is `pg_catalog.*`, except the exact allowlisted
      `storage.buckets` query.
- [ ] No query references application tables, data-bearing views,
      `auth.users`, `auth.identities`, `auth.sessions`, tokens, logs,
      `storage.objects`, migration tables, backups, or user content.
- [ ] Every function call is a built-in from the catalog-helper allowlist; no
      application, Auth, Storage, RPC, extension, trigger, or user-defined
      function is called.
- [ ] No statement uses `SELECT *`, row counts on data relations, sampling,
      query plans, sequence values, or object contents.
- [ ] The output schema and redaction scan are ready before collection starts.

Any failed check blocks execution. Do not edit the live query to work around a
failure; return to documentation review.
