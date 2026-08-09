# Security audit — AL-AMIN

Scope: Next.js App Router, Supabase Auth/PostgreSQL/Storage, server actions and route handlers. The audit intentionally concentrates on exploitable access-control, privacy and input-boundary issues; it is not a certification assessment.

| ID | Risk | Component | Finding and exploitation path | Fix | Verification | Residual risk | Status |
|---|---|---|---|---|---|---|---|
| SEC-01 | High | Auth redirects | A value such as `//attacker.example` passed the previous `startsWith('/')` checks and could become an external redirect after login or OAuth callback. | `safeNextPath` now accepts only a single local path; all login, registration, resend and callback flows use it. | `security-hardening.test.mjs`; source review. | Supabase dashboard redirect allow-list still must include only controlled origins. | Fixed in code |
| SEC-02 | High | Supabase Storage | The public `profile-media` bucket exposed draft and moderation media by predictable object URL before publication. | Bucket becomes private; `/api/media/view` verifies published references or authenticated owner/moderator access. Direct Storage public URLs were removed from the UI. Historical `main-…`/`gallery-…` PNG/JPEG paths remain readable only when already owned and referenced. | Migration assertions; route tests; manual browser check after migration. | Existing objects remain private only after the migration is applied. | Awaiting migration |
| SEC-03 | High | RLS and media ownership | A direct PostgREST write could reference another user's uploaded media in an application or revision. | Database triggers require each media path to exist and belong to the row owner. Revision payload shape and HTTPS links are also checked before moderation RPC can apply it. | Migration review and regression tests; direct RLS test after migration. | Legacy malformed rows are not rewritten automatically. | Awaiting migration |
| SEC-04 | Medium | Privileged PostgreSQL RPC | A security-definer publication helper retained default public EXECUTE rights even though it is intended only for a trigger. | Direct EXECUTE is revoked; trigger continues to invoke it internally. | Migration regression test. | Recheck grants after future SQL functions are added. | Awaiting migration |
| SEC-05 | Medium | Audit log and account mirror | Moderators could submit an audit row with another actor ID; users could alter their account email mirror. | Audit insert requires `actor_id = auth.uid()`; direct updates to `account_profiles` are removed. | Migration regression test. | A moderator can still truthfully log an action under their own ID; audit records are not an independent approval system. | Awaiting migration |
| SEC-06 | Medium | CSRF / request origin | Cookie-authenticated media and application endpoints accepted requests without an explicit canonical Origin comparison. The old application throttle also trusted `x-forwarded-for`. | State-changing endpoints check the configured origin; application throttle is keyed by authenticated user rather than a forgeable forwarding header. | Typecheck and route source tests. | In-memory throttling is only a local convenience. Enforce public-form rate limits at Cloudflare before production. | Fixed in code |
| SEC-07 | Medium | Browser headers | The app had no centrally enforced CSP, anti-framing headers or explicit no-store policy for private routes. | Added CSP compatible with Next, Supabase and supported video embeds; private pages and APIs receive no-store; HSTS is production-only. | `security-hardening.test.mjs`; header check after server restart. | CSP uses `unsafe-inline` for current Next runtime. A nonce-based CSP can be considered after production architecture stabilises. | Fixed in code |
| SEC-08 | Low | Dependencies | The external package audit would export the dependency graph to the registry audit service, which this environment is not authorised to do. | No blind upgrades were made. | Lockfile and production build checked; external advisory audit remains pending. | Newly disclosed vulnerabilities may exist. | Pending authorised external check |
| SEC-09 | High | Public REST data | The profile UI selected safe subsets, but the previous public RLS policies still let an anonymous PostgREST request read `author_contact` from reviews and moderator-only fields (`admin_note`, `assigned_by`) from badge assignments. | Public table reads are removed. The catalog and profile use narrow public views that expose only published review text and non-sensitive badge metadata. | Migration assertions and public-page source checks; direct REST verification after migration. | Published specialist rows still contain technical UUIDs; their public API surface should be narrowed through a dedicated view in a later API version. | Awaiting migration |

## Architecture inventory

- Next.js 16 App Router; public routes include `/`, `/specialists`, `/specialists/[slug]`, informational pages and login/register flows.
- Protected routes: `/apply` and `/cabinet`; moderation route: `/admin` with server-side role checks through `requireModerator` / `requireAdmin`.
- Route handlers: application, media upload/source/view, feedback, admin session and internal email worker.
- Supabase clients: browser anon client, cookie-bound server client and server-only service-role client. Service role is confined to server modules.
- Core RLS tables: applications, specialists, revisions, reviews, complaints, moderators, audit log, email outbox, trust badges, categories, account profiles and Storage objects.
- Security-definer functions use explicit search paths. New direct EXECUTE revocation is included for the publication helper.

## Required follow-up after migration

1. Verify `profile-media` shows **Private** in Supabase Storage and that an anonymous direct object URL returns no content.
2. Verify an anonymous visitor can still see an image belonging to a published specialist via `/api/media/view`.
3. Verify an owner can view their own pending image but another authenticated account receives 403/404.
4. Review function grants and RLS policies whenever a new migration adds a table, view, RPC or bucket.
5. With an anonymous REST request, confirm that `reviews` and `specialist_trust_badges` return no rows while `published_reviews` and `published_specialist_trust_badges` return only the documented public fields.
