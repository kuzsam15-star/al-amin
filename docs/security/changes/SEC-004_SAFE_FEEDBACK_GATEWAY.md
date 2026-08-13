# SEC-004 Safe Feedback Gateway

Date: 2026-08-13

## Security issue

- **Finding ID:** SEC-004
- **Name:** Direct feedback writes bypass application controls
- **Severity / launch blocker:** High / yes
- **Roadmap task:** P0-06
- **Invariant:** untrusted clients cannot create `reviews` or `complaints`
  directly; one server-controlled gateway is the only creation path.
- **Status:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`

## Threat model

### Assets and actors

Assets are the moderation queue, reviewer/reporter contact data, specialist
reputation, database capacity, and the integrity of protected feedback fields.
Actors are anonymous visitors, authenticated users, bots, cross-origin sites,
moderators/admins using client sessions, and the trusted server backend.

### Attacks

- direct PostgREST INSERT that bypasses route validation and CAPTCHA;
- complaint `internal_notes`, status, owner/role, or publication-field injection;
- `text/plain` and wrong-content-type cross-origin submission;
- malformed, oversized, Unicode/control-character, and HTML-like payloads;
- duplicate, replayed, concurrent, per-account, per-network, and per-target spam;
- forged `X-Forwarded-For`, missing trusted-proxy context, or raw-IP retention;
- CAPTCHA omission, provider failure, token/action/hostname mismatch, or test
  verifier accidentally enabled in production;
- same idempotency key with different content and different keys with the same
  content;
- submission to a missing, draft, suspended, or blocked specialist;
- future database columns silently becoming client controlled.

### Secure invariants

1. `anon` and `authenticated` have neither INSERT grants nor INSERT policies
   on `reviews` or `complaints`.
2. The public `submit_feedback_v1` function is executable only by
   `service_role`, uses a fixed `pg_catalog` search path, explicit types, exact
   column lists, and no dynamic SQL.
3. Server code derives Auth actor, HMAC network fingerprint, idempotency hash,
   payload hash, initial moderation fields, and target eligibility. Client
   payload cannot supply them.
4. The gateway requires exact same origin, JSON, an 8 KiB streamed limit,
   exact field allowlists, bounded normalized text, a v4 idempotency key, and
   successful server-side Turnstile action/hostname validation.
5. Missing configuration, unknown proxy mode, malformed trusted client
   context, CAPTCHA network/provider failure, and database ambiguity fail
   closed with generic responses.
6. Raw addresses, CAPTCHA tokens, service keys, and request bodies are not
   stored in the abuse ledger or logs.
7. Accepted reviews remain `is_published=false` and
   `evidence_checked=false`; accepted complaints remain `status='new'` with
   `internal_notes=null`. Existing named moderation remains unchanged.

## Current contract and dependency map

```text
FeedbackForms
  -> POST /api/reviews or /api/complaints
  -> exact Origin / JSON / streamed byte limit / allowlist
  -> Turnstile Siteverify (server-side, action + hostname)
  -> HMAC fingerprint + derived Auth actor
  -> service-role call to submit_feedback_v1
  -> advisory transaction lock
  -> idempotency / duplicate / rate / target checks
  -> exact INSERT into pending review or new complaint
  -> existing moderator_decide_review / moderator_decide_complaint
```

Before this change, both routes used the public anon client and the two base
tables independently allowed direct `anon`/`authenticated` INSERT. The review
policy only constrained publication flags; the complaint policy only
constrained status and allowed protected `internal_notes` to be supplied.

## Affected files

- **Production:** the two feedback route handlers, `FeedbackForms.tsx`, and
  server-only gateway modules.
- **Database:**
  `supabase/forward-migrations/20260813202524_sec004_safe_feedback_gateway.sql`.
- **Tests:** targeted gateway tests plus role-matrix cases/specification.
- **Recovery:** configuration manifest and runbook for six required values.
- **Explicitly unchanged:** 18 historical migrations, `schema.sql`, verified
  bootstrap/manifest, dependency versions, lockfile, SEC-001/002/003 behavior,
  and all live/remote state.

## Database changes

`private.feedback_ingress` stores only feedback type, target, optional derived
actor UUID, a scope key, HMAC fingerprint, hashed idempotency/payload identity,
result UUID, and timestamp. RLS is enabled; all direct privileges are revoked.

`submit_feedback_v1` takes transaction-scoped advisory locks in the fixed order
network, optional actor, then target. Each lock class has a distinct two-key
namespace, so cross-class hash collisions cannot invert that order; every
enforced counter is atomic. It then:

1. validates exact typed arguments and a currently published target;
2. returns the same result for the same scoped key/payload;
3. rejects the same key with different payload;
4. returns the existing result for equal content within 24 hours;
5. atomically enforces 3/15-minute and 12/day network limits, 5/15-minute and
   20/day authenticated-account limits, 3/day target+scope, and 50/day target;
6. inserts only explicit pending/new columns and records the ledger event.

Thresholds are constants in the reviewed migration. They cannot be weakened by
unbounded runtime environment values. A later threshold change requires a new
reviewed forward migration.

## Before state

Two independent red-phase clean-room runs used the verified baseline plus
SEC-001/002/003 forward migrations and the expanded SEC-004 test specification.
Both produced `108 PASS / 28 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP`.

The 16 SEC-004 XFAIL cases were `CAT-007`, `FEEDBACK-001..003`, and
`FEEDBACK-006..017`. They proved direct anonymous/authenticated review and
complaint insertion, protected complaint-field injection, duplicate creation,
and the absence of the service-only, idempotent, rate-limited gateway.

## After state

Two independent clean-room runs produced
`124 PASS / 12 unrelated XFAIL / 0 XPASS / 0 FAIL / 0 SKIP`. All 16 SEC-004
cases are PASS. The 12 remaining XFAIL entries retain their existing SEC
mappings; no other finding produced XPASS.

Targeted Node tests cover valid review/complaint, content type, malformed and
streamed oversized bodies, exact-field injection, control characters, origin,
idempotency, CAPTCHA success/failure/provider errors, production test-injection
denial, trusted proxy behavior, generic errors, HTML-like stored text, and
credential-free HTTPS evidence links.

## Configuration and recovery

Required deployment values are `FEEDBACK_ALLOWED_ORIGIN`,
`FEEDBACK_TRUSTED_PROXY_MODE`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`TURNSTILE_EXPECTED_HOSTNAME`, `TURNSTILE_SECRET_KEY`, and
`FEEDBACK_FINGERPRINT_SECRET`. The last two are server-only `MUST_REENTER`
secrets. Production rejects `local` proxy mode. The only implemented external
proxy mode is `cloudflare`, using one syntactically valid `CF-Connecting-IP`;
ordinary forwarding headers are never trusted. A different future hosting
provider requires an independently reviewed mode rather than a generic
`X-Forwarded-For` fallback.

The design follows the current Supabase grants/RLS model and explicit function
ACL guidance, and Cloudflare's mandatory server-side Siteverify contract:

- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/functions
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## Residual risk and out of scope

- SEC-011 retention/deletion policy is not implemented by this finding.
- SEC-017 remains open for other routes, edge ingress, and broader resource
  controls; this change verifies the feedback-route subset only.
- Monitoring/alerting, first hosting selection, Turnstile widget creation,
  actual production origin/proxy configuration, and remote deployment remain
  pre-launch gates.
- The Cloudflare widget script introduces an external availability dependency;
  failure disables feedback rather than bypassing verification.

## Rollback / forward-fix

Do not restore anonymous/authenticated table INSERT. If the gateway blocks
legitimate traffic, disable the forms and keep direct DML closed while a
reviewed forward migration adjusts thresholds or validation. Database objects
may be removed only after the application no longer calls them and evidence is
retained. Secret rotation invalidates fingerprint continuity and must be an
owner-approved operational event.

## Commit

- **Planned message:** `fix(security): route feedback through safe gateway`
- **Branch:** `security/hardening`
- **Production release:** not performed; remote finding remains open
