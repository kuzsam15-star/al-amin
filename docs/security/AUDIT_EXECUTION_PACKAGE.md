# AL-AMIN Audit Execution Package

## 1. Purpose

This package is the final pre-execution control set for a future AL-AMIN live-catalog evidence run. Its intended outcome is:

- redacted live catalog metadata required by the baseline acceptance criteria;
- a security reconciliation of that metadata against the Git snapshot and security documents;
- evidence for a future no-data bootstrap baseline decision.

It is not a baseline, migration, security fix, production deployment, data export, or production-data audit. The evidence must contain metadata only and must not include rows, user information, uploads, credentials, or secrets.

## 2. Human actions required

Only Viktor performs the following steps during the future approved execution. None are performed by this package now.

1. Confirm the canonical repository is on `security/hardening`, the expected HEAD is recorded, and the working tree is clean.
2. Review this package together with `READ_ONLY_ACCESS_PLAN.md`, `AUDIT_IDENTITY_SETUP.md`, `CATALOG_EXTRACTOR_SPEC.md`, `AUDIT_EXECUTION_CHECKLIST.md`, `AUDIT_IDENTITY_RUNBOOK.md`, `AUDIT_IDENTITY_SQL_REVIEW.md`, and `AUDIT_IDENTITY_VERIFICATION_PLAN.md`.
3. Confirm the exact AL-AMIN production project, audit window, temporary identity name, expiry, connection limit, and cleanup owner. Do not continue if any target is ambiguous.
4. Open only the correct project's Supabase Dashboard SQL Editor using Viktor's existing owner-controlled session. Do not open secret/API-key pages, user lists, table rows, Storage object lists, logs, or unrelated projects.
5. Paste only the separately human-reviewed one-off setup script that satisfies `AUDIT_IDENTITY_SQL_REVIEW.md`. Do not paste any ad-hoc SQL, migration, dump, Data API request, or application command.
6. Verify the temporary identity using the metadata-only assertions in `AUDIT_IDENTITY_VERIFICATION_PLAN.md`. Stop on any unexpected effective privilege; do not broaden access.
7. Run the fixed extractor locally outside the repository, using only Viktor-held temporary credentials. Scan and redact output before sharing it.
8. Perform the documented cleanup: end the audit session, revoke the temporary identity's connection capability, delete that exact identity, verify connection denial, and remove the credential after confirmation.

## 3. SQL execution policy

The current preparation stage permits **no SQL execution**. In the later human-approved stage, SQL is allowed only when all of the following are true:

- Viktor has reviewed the exact one-off script and verified it is limited to the temporary identity for the correct AL-AMIN project;
- the script contains only the approved setup/expiry/connection-limit/catalog-metadata-scope operations and the matching cleanup operations;
- the script creates no application object, migration, seed, function, policy, view, trigger, bucket, Auth setting, or production data change;
- the script has no credential literal, no production database password, no service/secret key, and no project secret;
- the verification plan confirms no data read, mutation, DDL, role escalation, broad predefined role, application-function execution, or Storage-object access;
- cleanup is reviewed before setup and has a named Viktor-led owner.

Never execute SQL that reads application/Auth/Storage-object rows, runs a function/RPC, creates a test object, changes an existing role, grants broad access, creates a permanent role, runs a migration, exports data, or touches a remote project other than the exact approved AL-AMIN target.

## 4. Extractor execution

**Where it runs:** Viktor's trusted local workstation, outside the canonical repository and outside shared/synchronized folders. Codex does not receive a connection, credential, or raw output.

**How it starts:** Viktor manually launches the separately reviewed fixed metadata extractor only after the temporary identity has passed every verification assertion. Nothing starts automatically before this human action.

**Automatic work after the manual launch:** the fixed extractor may collect its allowlisted catalog metadata, normalize it, apply redaction rules, validate the output schema, and calculate content hashes. It must not dynamically execute application objects, enumerate rows, call application functions, or change the project.

**Files it creates locally:**

- redacted UTF-8 JSON metadata evidence;
- redacted UTF-8 Markdown summary of counts, object identifiers, matches, drift, unknowns, and redactions;
- redacted privilege/expiry/cleanup attestation;
- content hashes for the redacted artifacts.

**Redaction:** remove/withhold emails, names, user IDs, rows, uploads, credentials, passwords, tokens, JWT-like strings, API keys, private-key material, connection strings, secret-bearing literals, and raw screenshots. A field that cannot be shared safely becomes `UNKNOWN` with a reason and stable digest where appropriate.

## 5. Evidence validation

Before any evidence is used for reconciliation, Viktor verifies:

- [ ] output contains metadata only: schemas, relations, columns, constraints, indexes, RLS/policies, ACLs, functions/views/triggers metadata, bucket metadata/policies, allowed Auth configuration metadata, extensions, and approved settings;
- [ ] no application/Auth/Storage-object rows, row counts, user records, emails, uploads, files, logs, exports, backups, or dumps are present;
- [ ] no password, token, JWT, API key, service-role material, project secret, connection string, or private key is present;
- [ ] every inaccessible/redacted field is marked `UNKNOWN`, not inferred;
- [ ] the evidence passes the local secret/PII scan and format validation;
- [ ] the evidence, extractor validation output, privilege attestation, and cleanup attestation can be reviewed without a live connection.

## 6. Cleanup procedure

Immediately after collection, or at the first stop condition, Viktor must:

1. stop the audit process and end only the temporary audit session;
2. retain only redacted evidence, hashes, and attestations;
3. under the approved owner-controlled process, revoke the temporary identity's connection capability;
4. delete the exact temporary identity after verifying no ownership/membership/grant/default-privilege dependency remains;
5. verify that the identity can no longer connect and that no role, data, Auth, Storage, migration, or configuration change remains;
6. remove the temporary credential from Viktor's password manager only after deletion/denial is confirmed;
7. record cleanup and remaining `UNKNOWN` items without retaining sensitive artifacts.

Do not leave a dormant audit identity, reuse the credential, retain raw output, or attempt a self-directed rollback of an unexpected production action.

## 7. Final approval checklist

- [ ] Git clean and expected branch/HEAD recorded.
- [ ] Temporary identity purpose, project, expiry, connection limit, and cleanup owner approved by Viktor.
- [ ] No `service_role`, owner password, Admin/Management API token, application user, or production data export is involved.
- [ ] The one-off setup/cleanup SQL was reviewed by Viktor and is limited to the approved operations.
- [ ] Effective privileges meet every assertion in `AUDIT_IDENTITY_VERIFICATION_PLAN.md`.
- [ ] The extractor allowlist, local execution location, redaction scan, output format, and stop conditions were reviewed.
- [ ] Cleanup plan is ready before the identity is created.
- [ ] Any unknown or unsafe requirement is accepted as `UNKNOWN` rather than solved by privilege expansion.
