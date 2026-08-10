# Catalog Metadata Extractor Specification

## Purpose and boundary

This specification defines a future fixed extractor for AL-AMIN live-catalog evidence. It collects only metadata required by `BASELINE_ACCEPTANCE_CRITERIA.md` and produces a redacted artifact for reconciliation. It is not an application client, migration tool, database dump, schema generator, or security test runner.

The extractor must be executed only after the temporary audit identity is separately approved and only by Viktor. This document contains no executable SQL and authorizes no remote connection.

## Allowed metadata scope

### Database

- schemas and exposed-schema classification;
- tables, columns, types, nullability, defaults, generated expressions, owners, and dependency metadata;
- primary keys, unique/check/exclusion constraints, foreign keys, validation state, sequences, and indexes;
- extensions, extension versions, PostgreSQL version, and explicitly approved non-secret configuration settings.

### Security

- RLS enabled/forced state for relevant tables;
- policy name, table, command, role, permissive/restrictive mode, `USING`, and `WITH CHECK` metadata;
- object ACLs and default ACLs for relevant schemas, relations, functions, and views;
- role names and effective metadata-relevant memberships only, without user records or credential metadata.

### Functions

- function schema, name, argument types, return type, language, volatility, owner, and dependencies;
- `SECURITY DEFINER`/invoker mode, effective `search_path`, and execute grants/revocations;
- a normalized definition only after secret/PII review. If a definition has a suspicious literal, record a stable digest and a redaction reason instead of the literal.

### Views and triggers

- view name, definition/dependencies, owner, security options, and grants;
- trigger name, target table, timing, events, condition metadata, enabled state, and invoked function;
- no execution of a view, trigger function, RPC, or application function.

### Storage

- bucket identifier, public/private state, file-size limit, allowed MIME types, and safe bucket configuration metadata;
- Storage policy metadata only: policy name, command, roles, `USING`, and `WITH CHECK`;
- no read of `storage.objects`, no object enumeration, no file metadata beyond bucket configuration, and no upload/download operation.

### Auth configuration

- only manually recorded configuration metadata that is available without opening user, session, token, secret, API-key, or log screens;
- provider enablement class, confirmation/recovery-flow requirements, session policy requirements, and MFA/AAL requirements where visible;
- any unavailable or unsafe field is recorded as `UNKNOWN`, never inferred from a user record or secret-bearing page.

## Prohibited collection

The extractor must never collect, query, count, export, infer, or retain:

- table, view, materialized-view, sequence, Auth, Storage-object, log, audit, outbox, or application rows;
- users, email addresses, phone numbers, names, IDs, sessions, identities, MFA factors, profile/application/review/complaint content, or uploaded files;
- passwords, connection strings, API keys, JWTs, service-role material, OAuth/SMTP secrets, project secrets, or credential metadata;
- query plans that reveal row samples, database dumps, backups, replication output, or application-function results;
- any output produced by executing a mutable function, RPC, trigger, job, email flow, Auth action, or Storage operation.

## Output redaction rules

- Emit object metadata only; omit values that are not required to establish structure or security semantics.
- Scan the complete output before sharing for secret patterns, personal data, URLs with credentials, JWT-like strings, private-key headers, and hard-coded function literals.
- Replace a suspicious definition/value with `REDACTED`, record the object identifier, a stable digest, and a short non-sensitive reason. Do not include the original value in the shared artifact.
- Do not emit raw credentials, project endpoints, user IDs, row identifiers, timestamps linked to user activity, or exact production infrastructure identifiers when an abstract identifier is sufficient.
- Treat an incomplete/redacted field as `UNKNOWN` for baseline equivalence until a safe, approved verification method exists.

## Validation checklist

Before accepting an extractor run, verify all of the following:

- the input identity and target project were approved, time-bounded, and used only by Viktor;
- the extractor uses a fixed allowlist of catalog metadata sources and has no dynamic object execution path;
- no application/Auth/Storage-object table reads, row counts, dumps, data exports, or function calls occurred;
- output has sections for Database, Security, Functions, Views, Triggers, Storage, Auth configuration, Extensions/settings, Redactions, and Unknowns;
- every policy/function/view/trigger ACL item has an object identifier and a collection status;
- every unavailable item is `UNKNOWN` with a reason rather than silently omitted;
- output secret/PII scan passes before the artifact is shared;
- the artifact can be compared to Git documents without requiring a live connection.

## Expected file format

The future extractor produces one UTF-8 JSON evidence file and one UTF-8 Markdown summary. Both include only metadata and use this top-level shape:

- `evidence_format_version`;
- `collection_scope` and `collection_status`;
- `collected_at_utc` rounded to the audit run, without user/session details;
- `database`, `security`, `functions`, `views`, `triggers`, `storage`, `auth_configuration`, and `extensions_settings` sections;
- `redactions` and `unknowns` arrays with object identifier, reason, and stable digest where applicable;
- `validation` results and a content hash of the final redacted JSON.

The Markdown summary reports only counts, object identifiers, accepted matches, drift, unknowns, and redaction outcomes. It must never reproduce source values that were redacted from the JSON artifact.
