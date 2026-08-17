# P0-09 Catalog, Identity and Privileged-Read Closure

## Security issue

- **Finding IDs:** SEC-010 (remaining local slice), SEC-015, SEC-016, SEC-018 (remaining local read slice), SEC-025.
- **Severity / launch blocker:** High/Medium; pre-launch blockers until local implementation and the later consolidated backend deployment are verified.
- **Roadmap task:** P0-09.
- **Security invariant:** public catalog, client-callable functions, Auth identity mirrors and privileged reads are explicit allowlists; future fields and objects are closed by default.
- **Dependencies:** verified no-data baseline, forward migrations through P0-08, local role matrix, real local TOTP.
- **Status:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT` for SEC-015/016/025; `PARTIALLY_IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT` for SEC-010/018.

## Threat model

- **Actors:** anon, ordinary authenticated owner, another user, moderator AAL1, admin AAL1, admin AAL2, service backend, attacker holding a stale privileged session.
- **Assets:** public catalog integrity, private application/revision data, Auth-derived email, audit/email queues, role membership, function and future-object ACLs.
- **Attack paths:** definer view bypass; future-column exposure; direct trigger/internal RPC invocation; mutable `search_path`; legacy default ACL; owner-written mirrored email; AAL1 email-queue read; stale role membership; shared-cache disclosure; forged role/AAL or `user_metadata` authorization.
- **Expected secure behavior:** four public views retain exact columns and publication filters without base-table grants; only registered functions are client-callable; new tables/sequences/functions are private; Auth is authoritative for account email; privileged reads recheck current DB membership and AAL2; private responses are no-store.
- **Confirmed before-state:** four public views used definer semantics; broad defaults existed for `postgres` and `supabase_admin`; internal/trigger functions were client-executable; owner UPDATE of `account_profiles` was live-reproduced; moderator AAL1 could read the base email queue.
- **Unverified hypotheses:** the historical cause that recreated the live SEC-025 policy remains unknown; local implementation does not prove remote Dashboard MFA enrollment, recent-auth policy or production session revocation.
- **Out of scope:** hosting, remote Auth configuration, monitoring/alerting, provider delivery deduplication, SEC-017/026 and any remote mutation.

## Dependency map

| Boundary | Trusted source | Public/client surface | Fail-closed control |
|---|---|---|---|
| Published catalog | private base tables | four `public.published_*` views | private fixed-column definer projection + invoker/barrier view |
| RPC | public/private functions | explicit registered signatures | revoke-all then named grants; fixed path; manifest assertion |
| Future objects | migration creator | none by default | creator/schema default ACL probes |
| Account identity | `auth.users` trigger | own six-column read contract | no owner DML; versioned field registry |
| Moderation reads | current `moderators` row | three bounded JSON projections | DB membership recheck per call |
| Delivery queue | current admin + signed `aal2` | minimized status projection | AAL1 deny; no recipient/body/raw error |
| Application cache | request session | server-rendered admin page/session hint | `force-dynamic`, `unstable_noStore`, private no-store response |

## Catalog contract inventory

| Public object | Trusted sources | Exact public columns | Publication filter |
|---|---|---|---|
| `published_specialists` | `specialists`, `categories` | `id`, `slug`, `full_name`, `country`, `city`, `category_id`, `category_name`, `category_slug`, `additional_category_ids`, `specialization`, `service_mode`, `experience_years`, `profile_summary`, `full_description`, `help_topics`, `work_offers`, `avatar_path`, `published_at` | specialist status is `published` |
| `published_reviews` | `reviews` | `id`, `specialist_id`, `body`, `would_hire_again`, `created_at` | review is published |
| `published_specialist_verification_facts` | `verifications`, `specialists` | `specialist_id`, five checked flags, `sources_checked`, `checked_at` | published specialist, completed check and at least one positive fact |
| `published_specialist_trust_badges` | `specialist_trust_badges`, `trust_badges`, `specialists` | `id`, `specialist_id`, `badge_id`, `source`, `assigned_at` | published specialist, active badge, non-derived `verified` badge |

All four views have fixed column lists, `security_invoker=true` and
`security_barrier=true`. Anon has no direct read grant on the source relations.
PostgREST/GraphQL can therefore expose only the registered projection shape;
adding a base column does not extend the public contract.

## Function and RPC classification

| Class | Surface |
|---|---|
| `PUBLIC_SAFE_RPC` | No mutable public RPC. The four private catalog helpers are executable only to satisfy their invoker views and are outside the exposed PostgREST schema. |
| `AUTHENTICATED_SAFE_RPC` | `is_admin`, `is_moderator`, `is_valid_help_topics`, `is_valid_work_offers`; fixed-path, side-effect-free helpers used by policy/validation contracts. |
| `MODERATOR_RPC` | named `moderator_decide_*`, `moderate_review`, `moderate_complaint`, and the three bounded `read_moderation_*_v1` projections; each rechecks current membership/transition. |
| `ADMIN_AAL2_RPC` | the named `admin_*` mutation family and `admin_read_email_delivery_v1`; sensitive operations recheck current admin membership and signed AAL2 in DB. |
| `SERVICE_ONLY` | submit gateways, canonical publication/backfill, email claim/ACK and media-cleanup enqueue/claim/authorize/ACK/fail primitives; client EXECUTE revoked. |
| `TRIGGER_ONLY` | identity sync, timestamp/ownership/media guards, event/email enqueue and published-badge synchronization; client EXECUTE revoked. |
| `INTERNAL_PRIVATE` | authorization, audit/event, canonical/reference/cleanup, registry and assertion helpers in `private`; direct client EXECUTE revoked except the exact policy/view helper requirement. |

The migration first revokes every existing `public` function from
`PUBLIC`/`anon`/`authenticated`, then grants the reviewed name set. The
versioned manifest records every resulting client-executable signature and
every public view; an unregistered future object fails verification. No
relevant function remained `UNKNOWN_BLOCKER` in the two final catalogs.

## Identity field contract

| `account_profiles` field | Control class | Owner contract |
|---|---|---|
| `id` | `SYSTEM_IMMUTABLE` | read own; never update |
| `email` | `AUTH_DERIVED` | read own; Auth flow + trusted trigger only |
| `display_name`, `avatar_url` | `AUTH_DERIVED` | read own; trusted Auth metadata sync only |
| `created_at`, `updated_at` | `SYSTEM_IMMUTABLE` | read own; never update |

No role, status, phone, verification or other security field exists in this
table. A future column fails the registry until a reviewed migration assigns a
control class; it does not inherit owner UPDATE.

## Privileged read matrix

| Role | Public catalog | Own identity/application projection | Moderation queues | Delivery queue | Base audit/event/operational ledgers |
|---|---|---|---|---|---|
| anon | allow exact published projections | deny | deny | deny | deny |
| ordinary user / owner | allow exact published projections | allow exact own projections | deny | deny | deny |
| moderator AAL1 | allow | own projection | allow three bounded moderation projections | deny | deny direct base reads |
| admin AAL1 | allow | own projection | allow three bounded moderation projections | deny | deny direct base reads |
| admin AAL2 | allow | own projection | allow three bounded moderation projections | allow minimized delivery status | only separately named contracts; no generic base read |
| service backend | trusted operational access | trusted | trusted | trusted worker path | service-only |

## Affected files

- **Migration:** `supabase/forward-migrations/20260817090000_p009_catalog_identity_privileged_reads.sql`.
- **Source:** admin page, admin session route and cabinet projection.
- **Tests:** role-matrix P009 cases, expected-failure ledger, coverage matrix and the SEC-002 source regression.
- **Documentation:** this record, P0-09 verification, findings/plan/matrix/roadmap/harness and closure map.
- **Explicitly unaffected:** historical 18 migrations, `supabase/bootstrap/*`, `supabase/schema.sql`, package files, remote Supabase, hosting.

## Database changes

- Four private fixed-column catalog functions are the only definer boundary for public rows. Four public views are `security_invoker=true` and `security_barrier=true` and retain the existing exact contracts.
- Existing public function EXECUTE is removed from `PUBLIC`, `anon` and `authenticated`, then only named RLS/action/read contracts are granted back. Internal, trigger and service functions remain non-client-callable.
- Definer functions receive a deterministic `pg_catalog`-first path. `CREATE` on `public` is not available to client roles.
- Default relation/sequence privileges are revoked for the `public` schema for both actual migration creators. Global default function EXECUTE is also revoked because PostgreSQL's built-in `PUBLIC EXECUTE` otherwise survives a schema-local revoke.
- `private.api_surface_manifest_v1` makes an unregistered future public view or newly client-executable function fail verification.
- `account_profiles` owner DML and broad projection are revoked. Authenticated users retain only the six explicit mirrored/system read columns. Trusted Auth trigger sync uses a versioned field registry.
- Three current-membership moderation read functions and one AAL2-only email-delivery function replace page-level service reads. The delivery projection excludes recipient, subject, body/template and raw provider error.
- The moderator base email-queue policy is removed.
- **Data reconciliation:** none. The migration changes catalog contracts only and is forward-only.
- **Production approval:** not granted.

## Before state

- **Environment:** two independent disposable local Supabase projects, fresh verified baseline through P0-08.
- **Fixtures:** synthetic `example.invalid` users, local roles, application/profile/revision/catalog/email rows and real local TOTP.
- **Result:** both runs: **161 PASS / 27 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**.
- **P0-09 red delta:** 15 new XFAIL mapped only to SEC-010/015/016/018/025, plus the seven existing target XFAIL.
- **Secrets/PII:** local keys and passwords remained in process memory; aggregate output contained no identifiers, ports, fixture values or tokens.

## After state

- **Allowed:** anon reads exact published projections; owners read their own fixed account mirror; current moderators read bounded moderation projections; current admin AAL2 reads minimized delivery state; named action RPCs remain available to exact roles.
- **Denied:** base catalog relations to anon; internal/trigger/service RPC; future default client access; account-profile writes; ordinary/AAL1 email queue reads; revoked-role reads; service-role admin page reads; cached privileged response reuse.
- **Future-object contract:** new base columns are absent from projections; new account fields fail the registry; new public views fail the API manifest; new functions/relations/sequences have no client defaults.
- **Failure mode:** unknown/unregistered catalog or identity shape raises a deployment/test error rather than silently widening the API.
- **Residual:** SEC-010 still needs mandatory MFA enrollment/recovery, recent-auth and full Auth session downgrade/revocation plus remote configuration evidence. SEC-018 still needs broader all-action audit completeness and operational monitoring/scheduler evidence.

## Tests

| Scope | Red | Final | Result |
|---|---:|---:|---|
| Run #1 | 161 PASS / 27 XFAIL | 183 PASS / 5 XFAIL | PASS |
| Run #2 | 161 PASS / 27 XFAIL | 183 PASS / 5 XFAIL | PASS |
| XPASS / FAIL / SKIP | 0 / 0 / 0 | 0 / 0 / 0 | PASS |
| DB lint | 0/0/0 | 0/0/0 | PASS |
| Security advisors | 4 ERROR / 8 WARN / 2 INFO | 0 ERROR / 8 WARN / 2 INFO | target ERROR delta PASS |

P009-001..018 cover view mode and exact columns, future columns, internal function ACL, all definer paths, both migration creators' future objects, API/identity registries, trusted Auth sync, ordinary/moderator/admin AAL1/admin AAL2 reads, real TOTP, stale role revocation, unregistered future views, direct base-queue denial and no-store source boundaries.

## Security verification

- [x] Red state reproduced twice outside production.
- [x] Target cases PASS twice.
- [x] Anon/user/moderator/admin AAL1/admin AAL2/service roles covered.
- [x] Direct REST/RPC bypass and future-object probes covered.
- [x] Real local TOTP AAL2 positive path covered.
- [x] Full relevant role matrix and cleanup PASS twice.
- [x] DB lint and target advisor delta PASS.
- [x] Source page no longer imports the service client for privileged reads.
- [x] No remote or production execution.
- [ ] Independent deployment review and live catalog verification: deferred to consolidated pre-launch backend window.

## Rollback / forward-fix

- A rollback must not restore definer views, broad defaults, owner email UPDATE, direct email-queue reads or service-role page queries.
- If a required caller was omitted, add only its exact signature/columns in a reviewed forward fix and update the manifest.
- If the public projection fails, correct the private projection function/view contract; do not grant anon access to private base tables.
- If Auth sync fails after deployment, pause dependent enqueue and forward-fix the trusted sync; never return owner DML.
- Existing remote catalog and rows require preflight during the consolidated deployment. No remote work occurred here.

## Commit

- **Planned message:** `fix(security): close catalog identity and privileged reads`
- **Branch:** `security/hardening`
- **Production release status:** blocked pending consolidated pre-launch backend deployment and remaining P0-10 gates.
