# AL-AMIN Metadata Evidence Output Schema

## Purpose and status

This document defines the only retained output format permitted for the future
P0-02B-B2k metadata collection. It does not contain live evidence and does not
authorize SQL or Supabase access.

Raw Dashboard results are not evidence artifacts. They are temporary local
inputs that must be validated and redacted before conversion to the files
below. No raw output, screenshot, CSV export, connection detail, or populated
credential may enter Git.

## Artifact set

The future redacted evidence bundle contains only UTF-8 JSON files:

1. `manifest.json`
2. `database.json`
3. `security.json`
4. `functions.json`
5. `views.json`
6. `triggers.json`
7. `storage.json`
8. `auth.json`
9. `redactions.json`
10. `unknowns.json`

Each file must be deterministic: stable key ordering, arrays sorted by
schema/object identifier, UTF-8 without BOM, LF line endings, and no generated
timestamps more precise than the approved audit window. SHA-256 hashes are
calculated only after redaction and validation.

## Global rules

### Globally allowed fields

- `evidence_format_version`;
- `collection_status`: `complete`, `partial`, or `blocked`;
- `collection_window_utc`: date and approved coarse time window only;
- `source_method`: fixed value
  `owner_dashboard_manual_read_only_metadata`;
- `section_status`: `collected`, `redacted`, `unknown`, `not_applicable`, or
  `blocked`;
- schema and database-object identifiers after PII review;
- structural/security metadata explicitly listed in the per-file schemas;
- `redaction_reason`, `unknown_reason`, and stable SHA-256 digest of a redacted
  metadata value;
- validation results and hashes of final redacted artifacts.

### Globally forbidden fields and values

- application, Auth, Storage-object, log, audit, outbox, backup, or migration
  rows;
- row samples, row counts, sequence/current values, query plans, statistics
  values, or business content;
- user IDs, user UUIDs, emails, phone numbers, personal names, identities,
  sessions, MFA factors, refresh/access tokens, profile text, applications,
  reviews, complaints, or uploaded-file metadata;
- passwords, password verifiers, connection strings, database hosts/ports,
  project refs, Dashboard URLs, API keys, JWTs, `service_role`, secret keys,
  OAuth/SMTP secrets, cookies, private keys, or authorization headers;
- browser/operator identifiers, exact session IDs, SQL history IDs, raw errors
  containing secrets, or screenshots;
- internal PostgreSQL OIDs or unstable physical identifiers;
- raw unredacted literals from defaults, constraints, policies, views,
  indexes, bucket identifiers, or function configuration.

Unknown or unsafe values are never guessed. They are represented in
`unknowns.json` and omitted from their normal section.

## `manifest.json`

### Allowed fields

```text
evidence_format_version
collection_status
collection_window_utc
source_method
postgresql_version
query_package_git_commit
sections[]:
  name
  status
  record_count
  artifact_sha256
validation:
  schema_valid
  secret_scan_clear
  pii_scan_clear
  prohibited_field_scan_clear
  redactions_reviewed
  raw_output_destroyed
```

`record_count` is the number of metadata records in the redacted artifact, not
a count of rows in any production relation.

### Forbidden fields

Project ref, database host, port, connection string, owner/operator identity,
browser session, token, raw query text, raw result path, and exact activity
timestamps.

## `database.json`

### Allowed fields

```text
postgresql_version
schemas[]:
  schema_name
tables[]:
  schema_name
  table_name
  table_kind
columns[]:
  schema_name
  table_name
  ordinal_position
  column_name
  data_type
  is_nullable
  identity_mode
  generated_mode
  default_expression | REDACTED
types[]:
  schema_name
  type_name
  type_kind
  enum_sort_order
  enum_label | REDACTED
constraints[]:
  schema_name
  table_name
  constraint_name
  constraint_type
  definition | REDACTED
  is_validated
indexes[]:
  schema_name
  table_name
  index_name
  is_primary
  is_unique
  is_valid
  is_ready
  definition | REDACTED
```

### Forbidden fields

Table contents, row counts, samples, sequence values, statistics, OIDs,
physical storage locations, relation sizes, live activity, query plans, and any
default/constraint/index literal that failed redaction.

## `security.json`

### Allowed fields

```text
tables[]:
  schema_name
  table_name
  rls_enabled
  force_rls
policies[]:
  schema_name
  table_name
  policy_name
  command
  is_permissive
  roles[]
  using_expression | REDACTED
  with_check_expression | REDACTED
relation_privileges[]:
  schema_name
  relation_name
  relation_kind
  grantee
  privilege_type
  is_grantable
schema_privileges[]:
  schema_name
  grantee
  privilege_type
  is_grantable
default_privileges[]:
  owner_role
  schema_name
  object_type_code
  grantee
  privilege_type
  is_grantable
```

Role names are allowed only after email/UUID/name/credential screening.

### Forbidden fields

Results of evaluating a policy, assumed-role data, JWT claims, user IDs,
current user/session values, protected rows, error-based privilege probes, and
unredacted sensitive literals in policy expressions.

## `functions.json`

### Allowed fields

```text
functions[]:
  schema_name
  function_name
  identity_arguments
  return_type
  language
  routine_kind
  security_definer
  volatility
  configured_search_path | REDACTED
  privileges[]:
    grantee
    privilege_type
    is_grantable
```

### Forbidden fields

Function body/source, `prosrc`, `probin`, arbitrary `proconfig` entries,
function results, invocation output, arguments containing real values, secrets,
owner credentials, and unredacted sensitive `search_path` content.

## `views.json`

### Allowed fields

```text
views[]:
  schema_name
  view_name
  view_kind
  security_invoker
  security_barrier
  definition | REDACTED
  grants[]:
    grantee
    privilege_type
    is_grantable
```

### Forbidden fields

Rows returned by a view, view row counts, samples, materialized-view contents,
execution results, and unredacted literals that match secret/PII rules.

## `triggers.json`

### Allowed fields

```text
triggers[]:
  table_schema
  table_name
  trigger_name
  timing
  for_each_row
  on_insert
  on_delete
  on_update
  on_truncate
  function_schema
  function_name
  function_arguments
  enabled_mode
```

### Forbidden fields

Encoded trigger argument values, trigger execution results, table rows, job or
webhook payloads, function bodies, and any invocation of the trigger function.

## `storage.json`

### Allowed fields

```text
buckets[]:
  bucket_id | REDACTED_BUCKET_<digest-prefix>
  bucket_name | REDACTED_BUCKET_<digest-prefix>
  is_public
  file_size_limit
  allowed_mime_types[]
tables[]:
  table_name
  rls_enabled
  force_rls
policies[]:
  table_name
  policy_name
  command
  is_permissive
  roles[]
  using_expression | REDACTED
  with_check_expression | REDACTED
```

### Forbidden fields

Any `storage.objects` row or count, object name/path, object owner, user ID,
object metadata, version, timestamps, uploaded file, signed/public URL,
download/upload result, file content, and Storage secret.

## `auth.json`

Auth evidence is manually recorded configuration metadata, not SQL output.

### Allowed fields

```text
email_sign_in: enabled | disabled | UNKNOWN
email_confirmation: required | not_required | UNKNOWN
enabled_provider_names[] | UNKNOWN
session_controls:
  time_boxing_enabled | UNKNOWN
  inactivity_timeout_enabled | UNKNOWN
  single_session_enabled | UNKNOWN
mfa_controls:
  enrollment_state | UNKNOWN
  verification_state | UNKNOWN
collection_notes[]:
  field
  status
  unknown_reason
```

Durations may be retained only when displayed as configuration values and not
associated with a user/session.

### Forbidden fields

Users, identities, emails, phones, passwords, sessions, refresh/access tokens,
JWTs, MFA factors, recovery codes, provider client IDs/secrets, SMTP settings,
email templates containing values, redirect URLs containing identifiers,
Auth logs, user counts, or screenshots of secret-bearing pages.

## `redactions.json`

### Allowed fields

```text
redactions[]:
  artifact
  object_identifier
  field
  reason_code
  replacement
  original_value_sha256
```

Allowed `reason_code` values:

- `secret_pattern`;
- `credential_or_connection_material`;
- `email_or_phone`;
- `user_or_person_identifier`;
- `application_data_literal`;
- `unsafe_bucket_identifier`;
- `unsafe_role_identifier`;
- `unreviewable_definition`.

### Forbidden fields

The original value, reversible encoding, partial credential, unmasked prefix or
suffix, screenshot, raw line, or source path containing the value.

## `unknowns.json`

### Allowed fields

```text
unknowns[]:
  section
  object_identifier
  field
  reason_code
  required_follow_up
```

Allowed `reason_code` values:

- `unsafe_or_unavailable_in_dashboard`;
- `query_package_schema_mismatch`;
- `blocked_by_sensitive_result`;
- `blocked_by_prohibited_relation`;
- `blocked_by_non_allowlisted_helper`;
- `redaction_prevents_equivalence`;
- `not_exposed_as_database_catalog_metadata`.

### Forbidden fields

Guesses, inferred configuration, copied errors containing data/secrets, user
details, raw output, or a workaround that broadens access.

## Output validation procedure

Before any evidence artifact is accepted:

1. Validate each JSON file against the exact allowed keys above; reject unknown
   keys rather than preserving them.
2. Scan all strings for JWT patterns, API/secret keys, private-key headers,
   password/verifier formats, connection URLs, authorization headers, cookies,
   emails, phones, UUIDs, and user/application content indicators.
3. Review every definition/expression manually for hard-coded literals and
   apply `REDACTED` plus a locally calculated SHA-256 digest where necessary.
4. Confirm `storage.json` contains bucket configuration only and no
   `storage.objects` information.
5. Confirm `auth.json` contains only configuration states and `UNKNOWN`; no user,
   session, provider-secret, SMTP, token, or log field is permitted.
6. Confirm all artifact record counts describe metadata arrays only.
7. Confirm no internal OID, project ref, host, port, Dashboard URL, operator ID,
   query-history ID, or exact session timestamp remains.
8. Calculate SHA-256 hashes of the final redacted files and write only those
   hashes to `manifest.json`.
9. Delete raw Dashboard output and temporary non-redacted files only after the
   redacted artifacts pass validation.
10. Record cleanup and any unavailable field in `unknowns.json`; do not obtain
    it by expanding privileges or querying data.

Failure of any validation step blocks reconciliation. It does not authorize a
new query, broader role, Management API call, or production change.
