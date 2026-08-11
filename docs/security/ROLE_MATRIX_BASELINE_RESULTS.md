# AL-AMIN Role-Matrix Baseline Results

Date: 2026-08-11

Starting Git HEAD: `cda9870db8bcc1e56fd8b201304b1c99670d9cdb`

Baseline: `alamin-no-data-v1` pre-hardening state

## 1. Two-run result

Two independent disposable projects used different project IDs, ports, Auth
users, UUIDs, Storage paths, and database volumes. Both re-applied the verified
baseline from an empty local Supabase stack. The stable result sets matched
exactly.

| Run | PASS | XFAIL | XPASS | FAIL | SKIP | Cleanup |
|---|---:|---:|---:|---:|---:|:---:|
| Run #1 | 49 | 24 | 0 | 0 | 0 | PASS |
| Run #2 | 49 | 24 | 0 | 0 | 0 | PASS |

The baseline run is successful because there are no unexpected failures,
XPASS results, or unexplained skips, and every XFAIL maps to an already open
finding.

## 2. Expected failures

| Finding | XFAIL cases | Confirmed before-state |
|---|---|---|
| SEC-001 | CAT-008, STORAGE-007, STORAGE-008, STORAGE-010 | non-WebP direct upload and referenced canonical replacement remain possible |
| SEC-002 | READ-005 | owner direct Data API projection exposes protected application columns |
| SEC-003 | SPEC-003, SPEC-004, SPEC-005 | moderator can cross protected owner/lifecycle/verification boundaries |
| SEC-004 | CAT-007, FEEDBACK-001, FEEDBACK-002, FEEDBACK-003 | direct anonymous/authenticated feedback insertion remains open |
| SEC-010 | ROLE-004, RPC-002, AUDIT-004 | privileged AAL1 content, RPC, and queue paths are not gated by AAL2 |
| SEC-015 | CAT-002 | all four public views lack `security_invoker=true` |
| SEC-016 | CAT-003, CAT-004, CAT-005 | internal function execution, mutable search paths, and broad defaults remain |
| SEC-017 | CAT-008, STORAGE-007, STORAGE-008, STORAGE-009 | MIME/content boundary permits unnormalized or invalid direct media |
| SEC-018 | AUDIT-003, AUDIT-004 | direct moderator audit insert and privileged queue boundary remain |
| SEC-025 | CAT-006, PROFILE-001 | owner UPDATE policy permits mirrored email mutation |
| SEC-026 | CONTENT-004 | public base content exposes the operational actor column |

One case may map to more than one finding, so the finding-row counts do not
sum to 24.

## 3. Confirmed secure before-state

The 49 PASS cases include cross-owner application/profile/revision isolation,
revoked direct application writes, owner direct published-specialist update
denial, ordinary-user privilege denial, moderator self-promotion denial,
revoked-role immediate denial through the live database role lookup, exact
public projection columns, unpublished-row exclusion, cross-owner/private
Storage denial, SVG/oversize rejection, public avatar read, ordinary-user
content/audit denial, and all-table RLS coverage.

Real local TOTP enrollment, challenge, and verification produced an AAL2
session. The approved AAL2 positive site-content and revision-decision paths
passed. These positive tests do not compensate for the separate AAL1 XFAIL
cases.

## 4. Storage and RPC coverage

Storage uses the actual local Storage API. Thirteen cases exercise both
buckets and cover own/foreign paths, private/public reads, update/delete,
format allowlisting, configured size limit, content validation, and replacement
of a path already referenced by a published specialist.

RPC coverage combines catalog checks with the allowlisted
`apply_specialist_revision` call. An ordinary user is denied; an AAL1 moderator
currently succeeds and is XFAIL under SEC-010; a real AAL2 admin succeeds.
Unknown or trigger functions are never called.

## 5. Not automated by this harness

The local role matrix does not claim to prove:

- SEC-006 cleanup fault behavior or Storage restore;
- SEC-007/SEC-008 concurrency and idempotency invariants;
- SEC-009/SEC-019 dependency and supply-chain state;
- SEC-011 production Auth provider/leaked-password/rate settings;
- SEC-012 Git/CI/release provenance beyond this local commit;
- SEC-013 backup and restore;
- SEC-014 deployed SSR Proxy/session refresh behavior;
- SEC-017 sustained abuse, image decompression corpus, or platform quotas;
- SEC-020/SEC-024 deployed TLS, cookie, header, CSP, and logging controls;
- SEC-021 monitoring, retention, and incident response;
- SEC-022 semantic revision classification;
- SEC-023 production-scale query-plan performance.

These remain open at their recorded severity. They are represented as
`NOT_AUTOMATED` entries with reasons rather than false PASS results.

## 6. Release implication

`ROLE_MATRIX_HARNESS_READY` means the disposable local regression mechanism is
ready. It does not mean AL-AMIN is secure for production or that any of the 26
findings is fixed. The 24 XFAIL cases are an executable record of the approved
pre-hardening risk. Production remains prohibited until the roadmap and release
gates are complete.

The next finding-scoped stage is P0-03A: SEC-001 immutable canonical published
media threat analysis and test-first fix.
