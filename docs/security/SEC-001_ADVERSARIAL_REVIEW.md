# SEC-001 Independent Adversarial Review

Date: 2026-08-11

Candidate reviewed: `35881e15f26673b89600a62bb56aa981f74c6310`

Disposition: `INDEPENDENTLY_REVIEWED_LOCAL_READY_FOR_CONTROLLED_DEPLOYMENT`

This review treated the P0-03A implementation as untrusted. It used only the
verified local bootstrap, disposable Supabase projects, synthetic data, and
the pinned local toolchain. No production or remote Supabase endpoint was
used.

## Confirmed bypasses in the candidate

### 1. Stale moderator review (High, SEC-001)

The admin page displayed one `applications.updated_at` or
`specialist_revisions.updated_at`, but the publication action re-read and
approved the latest payload without proving it was the reviewed version. An
owner could change pending media after moderator review and before the
service-only publication RPC.

Two independent red runs reproduced both variants as `MEDIA-019` and
`MEDIA-020`: **68 PASS / 25 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**. The two new
XFAIL entries mapped only to the already-open SEC-001 finding.

The correction passes an expected `updated_at` from the rendered review to the
server action and into the row-locking publication RPC. The RPC compares it
inside the same transaction before registering provenance or changing a
publication reference. Stale decisions fail closed; a fresh reviewed version
passes.

### 2. Phase B owner/provenance gap (High, SEC-001)

The candidate Phase B accepted an avatar whose text merely matched the
canonical path shape. It did not prove that the path belonged to the row owner
or that an active provenance record bound it to the exact approved application
or published specialist.

The correction makes Phase B preconditions owner-aware and requires active
ledger provenance. Application records must bind to their exact application;
specialist records must bind to their exact specialist. Validated constraints
also use the owner-aware path predicate. A foreign canonical-looking
substitution is denied in both independent rehearsals.

### 3. Backfill was not executable (deployment blocker)

The original runbook described the required behavior but supplied no reviewed
implementation that could prove dry-run, interruption, resume, database
failure, or idempotency. A credential-free owner-operated core now exists at
`tests/security/helpers/sec001-backfill.mjs`. It accepts an explicit runtime
service client, is dry-run by default, logs no row identifiers or paths, and
uses a service-only optimistic database cutover after verified Storage copy.
It never deletes old source objects.

## Attack matrix

| Area | Adversarial condition | Result / coverage |
|---|---|---|
| Path | `../`, encoded traversal, duplicate separator, backslash and Unicode separator confusion | AUTOMATED_DENY — path unit tests and `MEDIA-017` |
| Path | wrong owner, entity, slot, submission-as-canonical, client canonical input, bucket confusion | AUTOMATED_DENY — owner parser, ledger binding, fixed bucket, `MEDIA-004/005/018` |
| Storage | canonical INSERT/UPDATE/DELETE/upsert by owner, user B, moderator or anon | AUTOMATED_DENY — `MEDIA-004/005`, Storage role cases, byte re-read |
| Storage | same-path submission overwrite, foreign read/update/delete, active source delete | AUTOMATED_DENY — `MEDIA-001/013/014/015/016` |
| Content | MIME/extension spoof, malformed/truncated/zero-byte, SVG/unsupported, excessive pixels | AUTOMATED_DENY — `published-media-security.test.mjs` |
| Hash | identical retry, same bytes/different source, different entity, different bytes at same canonical path | AUTOMATED_PASS/DENY — hash unit tests, rehearsal conflict injection |
| Hash | stale/missing provenance or foreign-owner canonical reference | AUTOMATED_DENY — Phase B and database invariant tests |
| Race | source missing before copy; Storage success followed by DB mismatch; resume after interruption | AUTOMATED_DENY/PASS — deployment rehearsal |
| Race | stale application/revision review | AUTOMATED_DENY — `MEDIA-019/020` |
| Race | concurrent replay of one application/revision decision | AUTOMATED_PASS — `MEDIA-021/022` |
| Race | overlapping revision approval and rejection | AUTOMATED_PASS — `MEDIA-023`; exactly one terminal decision |
| Race | two distinct revisions approved concurrently | NOT_COVERED — broader state-order invariant remains SEC-008 and was not silently adjudicated as SEC-001 |
| Authorization | direct client publication primitive, caller-controlled owner/entity/path | AUTOMATED_DENY — RPC ACL catalog assertions, descriptor validation, server action allowlist |
| Cleanup | active canonical deletion by a client, old source deletion after cutover, dangerous dangling DB reference | AUTOMATED_DENY/PASS — role matrix and rehearsal |
| Cleanup | lifecycle GC of old canonical objects | NOT_COVERED — intentionally remains SEC-006 |
| Serving | arbitrary path, private submission, bucket switch, unreferenced canonical path | AUTOMATED_DENY — strict route parser plus database-reference checks |
| Serving | edge/CDN cache invalidation in production | NOT_COVERED — requires controlled production evidence; no live claim is made |

## Static review results

- Service-key construction remains in `server-only` modules and has no client
  import path.
- Canonicalization always selects `profile-media`, decodes with Sharp under a
  pixel limit, re-encodes WebP, hashes stored bytes, uses `upsert=false`, and
  accepts retry only after re-download and exact hash match.
- Browser payloads cannot choose owner, specialist, status, canonical path, or
  provenance fields.
- Publication functions are `SECURITY DEFINER`, have a fixed `search_path`,
  revoke client execution, and grant only `service_role`.
- Client Storage policies cover only the exact owner submission namespace;
  no client mutation policy covers `published/`.
- Media serving permits only strict profile-media paths already referenced by
  an approved application, published specialist, or allowed revision context;
  it does not expose signed URLs or a caller-selected bucket.
- Cleanup helpers match submission paths only and do not delete canonical
  media. Broader cleanup correctness remains SEC-006.
- No SQL string is built from a browser-controlled identifier in the
  publication or backfill database functions.

## Migration review

Phase A remains compatible with existing legacy rows and adds policies,
ledger, guards, reviewed-version RPCs, and a service-only backfill primitive.
Phase B runs in a transaction, fails before adding constraints while any
legacy/unproven published reference exists, and passes only after complete
owner/provenance reconciliation. Reapplying Phase B after success is
idempotent in both rehearsals.

Local database lint is **0 ERROR / 0 WARN / 0 INFO**. A review-time ambiguous
PL/pgSQL variable (`source_path`, SQLSTATE 42702) was found before commit and
renamed; it is covered by clean replay. Security advisors remain the unrelated
pre-hardening baseline of **4 ERROR / 8 WARN / 0 INFO**.

## Residual risk and adjudication

SEC-001 is ready only for the controlled production readiness gate. It is not
`FIXED_LIVE`. Production inventory, backups/restore readiness, approved
credentials, maintenance ownership, monitoring, backfill, Phase B, and
post-deployment evidence still do not exist in this local stage. SEC-006,
SEC-008, SEC-010, SEC-017 and every other open finding retain their severity
and status.
