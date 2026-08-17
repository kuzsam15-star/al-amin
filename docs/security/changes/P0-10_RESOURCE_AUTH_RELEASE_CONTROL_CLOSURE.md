# P0-10 — Resource, Auth and release-control closure

## Security issue

- **Finding IDs:** SEC-017, SEC-026; local closure/evidence for SEC-005, SEC-009–014, SEC-018–021.
- **Severity / launch blocker:** SEC-017 Medium/launch blocker; SEC-026 Low/non-blocker; historical severities remain unchanged.
- **Roadmap:** final locally implementable pre-launch package.
- **Invariant:** attacker-controlled bytes, decoded media, lists, queries, provider responses and workers are bounded; privileged enrollment/session handling fails closed; the tested release bytes cannot be reported ready after drift, an advisory, a secret, an unknown finding or a failed recovery gate.
- **Status:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_FINAL_BUNDLE_FREEZE`.

## Threat model

Actors are anonymous callers, authenticated owners, abusive clients, stolen privileged sessions, compromised/stale workers and an operator selecting the wrong release artifact. Assets are availability, moderation/media integrity, Auth sessions, secrets, recovery generations and the exact migration/source bundle.

Threats include oversized or chunked bodies without `Content-Length`; multipart/list amplification; decompression, dimension and pixel bombs; repeated decode/cache-key amplification; unbounded result pages, queues, retries or `Promise.all`; hanging providers and huge error bodies; attacker-controlled log fields; admin access without an enrolled factor; forged/stale role or AAL; unsafe redirects; missing Dashboard controls; dirty/wrong Git state; modified baseline/migration; stale recovery evidence; dependency advisories; client-bundle secrets; and a release candidate that differs from tested bytes.

The endpoint or worker fails closed when a security limit is invalid or production acknowledgement is absent. External systems are never contacted by the release gate. Hosting ingress/WAF behavior remains a separate SEC-020 proof.

## Resource inventory and contract

| Operation | Boundary | Classification after P0-10 |
|---|---|---|
| Application submit | authenticated before body; streamed JSON 96 KiB; 32 fields; explicit schema | SAFE_BOUNDED |
| Feedback review/complaint | existing SEC-004 streamed 8 KiB, exact origin, Turnstile, rate/idempotency | SAFE_BOUNDED |
| Media upload | authenticated before multipart; 13 MiB aggregate; 12 MiB source; one file; bounded executor | SAFE_BOUNDED |
| Media decode/canonicalize | 10k × 10k and 40 MP; one frame; 8 s processing; WebP <= 5 MiB | SAFE_BOUNDED |
| Media view | one exact query key/path; byte cap; canonical bytes immutable/cacheable; private decode bounded | SAFE_BOUNDED |
| Public catalog/reference lists | explicit columns/order; 100/200 row caps | SAFE_BOUNDED |
| Moderator/admin queues | P0-09 exact bounded RPCs, role/AAL, no-store | SAFE_BOUNDED |
| Email provider/worker | 8 s timeout; 16 KiB response cap; batch <= 25; transactional lease/retry | SAFE_BOUNDED |
| Cleanup worker | batch <= 25; lease/retry; exact object; fail-closed reference/provenance | SAFE_BOUNDED |
| SEC-001 backfill/recovery tools | checkpointed/bounded operator tools; no automatic production use | SAFE_BOUNDED_OPERATOR_ONLY |
| Auth provider and hosting ingress | exact desired state/checklist; not locally mutable/provable | PENDING_REMOTE_CONFIGURATION / HOSTING_DEPENDENT |

`src/lib/resource-limits.mjs` is the narrow configuration contract. Every integer has a safe default plus an accepted minimum/maximum. Negative, zero, NaN and unlimited values are rejected. Production routes/workers require `ALAMIN_RESOURCE_LIMITS_ACK=v1`; this is a non-secret reviewed-config acknowledgement, not a bypass.

## Media and Storage boundary

Browser writes no longer create unregistered owner objects. The server validates/transcodes a unique submission to WebP, uploads with no-overwrite semantics, computes SHA-256, and registers exact Storage identity/owner/hash/size through the service-only `register_submission_media_v1`. Direct owner INSERT is revoked. Existing SEC-001 canonical publication and SEC-006 cleanup remain intact; the cleanup reference registry advances from eight to nine sources and handles service-owned submission objects only with the provenance ledger.

This closes the four SEC-017 matrix expectations: authenticated-before-body application submit, WebP-only Storage policy, validated WebP source, and public canonical bytes without request-time Sharp decode.

## Auth boundary

The Next.js 16 Proxy uses the official Supabase SSR request/response cookie synchronization and `getClaims()` validation. Private paths are no-store. Current moderator/admin membership remains DB-authoritative. A privileged identity without a verified TOTP factor is routed only to `/admin/mfa`; sensitive admin reads/actions still require signed AAL2 server and DB gates. The enrollment page performs `enroll` followed by `challengeAndVerify` and never handles another account's factor.

Recent-auth is not inferred from an unsupported client timestamp or mutable metadata. Exact recent-auth UX and full Auth session time-box/single-session settings remain owner-applied Dashboard/product decisions. Leaked-password protection, CAPTCHA, password policy, URLs, SMTP and session settings are recorded as `PENDING_CONSOLIDATED_REMOTE_CONFIGURATION`.

Official contracts consulted: Supabase TOTP MFA, Auth sessions, and Next.js SSR guidance (`https://supabase.com/docs/guides/auth/auth-mfa/totp`, `https://supabase.com/docs/guides/auth/sessions`, `https://supabase.com/docs/guides/auth/server-side/nextjs`).

## SEC-026 adjudication

SEC-026 is fixed locally rather than accepted: table-level anonymous SELECT is replaced by an exact column grant over `site_content` public content fields. `updated_by` remains protected and admin mutation remains AAL2 controlled. `CONTENT-004` becomes PASS; there is no retained SEC-026 XFAIL or risk acceptance.

## Database change

- **Migration:** `supabase/forward-migrations/20260817103731_p010_resource_auth_release_controls.sql`.
- **Objects:** private `submission_media_assets`, registration/ownership helpers, reference-registry v9, updated SEC-006 service-object cleanup primitives, profile-media policy/bucket contract, exact `site_content` grants.
- **ACL:** provenance and registration are service-only; owner/client direct insert remains denied; public content cannot select operational actor UUID.
- **Replay:** verified baseline plus all nine ordered forward migrations passed twice.
- **Role matrix:** 188 PASS / 0 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP twice.
- **Production approval:** not granted; remote backend unchanged.

## Before/after evidence

Before P0-10, two independent local runs were 183 PASS / 5 XFAIL, with `CAT-008`, `STORAGE-007..009` mapped only to SEC-017 and `CONTENT-004` to SEC-026. No unexpected result existed.

After P0-10, the same case inventory is 188 PASS and zero non-PASS classifications. N/N+1 streamed-body, field/type, image metadata/pixel, concurrency/queue, bounded-provider-response, production acknowledgement, Auth Proxy/MFA/redirect/no-store and SEC-026 grant tests pass. The release gate has an explicit fail-closed result for every injected integrity/security failure.

## Failure and rollback

Boundary failures return generic 400/413/415/503 results without echoing bodies, provider output, media paths or credentials. A full queue fails before decode; timeouts abort provider/media work; already-proven transaction/cleanup leases remain authoritative.

Do not roll back by reopening direct Storage insert, restoring public `updated_by`, removing streaming limits, widening queue/query caps, disabling MFA/AAL gates, or altering applied migration history. If a legitimate payload exceeds a limit, review evidence and ship a bounded forward fix. If Proxy behavior regresses, fail closed on private routes while the exact cookie contract receives a forward fix.
