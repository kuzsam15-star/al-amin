# SEC-002 — Owner-safe Applications Projection

Date: 2026-08-13

## Security issue

- **Finding ID:** SEC-002
- **Название:** Владелец заявки читает moderator-only колонки через прямой Data API.
- **Severity / launch blocker:** High / yes.
- **Roadmap task / workflow priority:** P0-04.
- **Security-инвариант этого change:** owner-facing application reads are an
  explicit versioned column allowlist; row ownership and column authorization
  are independent enforced boundaries.
- **Owner:** DB/App owner.
- **Reviewer(s):** Security reviewer required before remote deployment.
- **Dependencies / prerequisites:** verified no-data bootstrap, SEC-001 forward
  migrations, disposable role-matrix users, current Supabase Data API grants
  and RLS guidance.
- **Status:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`;
  remote Supabase and production remain unchanged.

## Threat model

- **Actors:** authenticated application owner, another authenticated user,
  anonymous client, moderator client session, trusted server backend.
- **Prerequisites / attacker access:** a normal authenticated owner session and
  the public Data API endpoint; no moderator or service credential is needed.
- **Asset / trust boundary:** moderation notes, scheduling metadata, operational
  fields, the stable owner-facing application contract and future columns.
- **Attack paths:** direct PostgREST explicit selection of `internal_notes` or
  `call_at`; base-table `select=*`; GraphQL field selection where pg_graphql is
  enabled; bypassing Next.js; a view later widened with `*`; an RPC returning a
  base composite row; a future column inherited by a table-level SELECT grant;
  related-table embeds; cross-owner row selection.
- **Impact:** disclosure of moderator reasoning, operational scheduling and any
  future privileged data added to `applications`, despite a safe frontend
  field list.
- **Expected secure behavior:** owners can read only a stable, explicit
  `owner_applications_v1` contract for their rows; direct protected columns and
  base wildcard reads are denied by PostgreSQL privileges; new columns remain
  denied by default; anonymous and cross-owner reads fail; trusted server
  moderation workflows retain the necessary data.
- **Confirmed facts:** live and verified baseline state grant `authenticated`
  table SELECT and retain `Owners read own applications`; RLS filters rows, not
  columns. The current UI happens to select subsets, but the database does not
  enforce that convention. Supabase's current Data API model separately checks
  object/column grants and RLS. Current official column-level security guidance
  confirms that restricted roles cannot use wildcard selection.
- **Unverified hypotheses:** no application GraphQL call site exists in Git.
  Live `graphql_public` exists, so the same PostgreSQL grant boundary is treated
  as applicable even though runtime GraphQL queries are not used by the app.
- **Out of scope:** moderator/admin transition authorization (SEC-003/010),
  application submission races (SEC-007), audit atomicity (SEC-018), changing
  the business meaning of application fields, and any remote deployment.

## Applications column classification

Classification is based on actual owner, moderation, publication, email and
backend call sites rather than column names alone.

| Classification | Columns | Contract treatment |
|---|---|---|
| `OWNER_PUBLIC` | `full_name`, `country`, `city`, `category_id`, `additional_category_ids`, `specialization`, `experience_years`, `profile_summary`, `description`, `help_topics`, `work_offers`, `main_image_path`, `gallery_paths` | Owner-supplied profile material; included because current owner edit/media flows read it. It is not public while the application is pending. |
| `OWNER_PRIVATE` | `id`, `contact`, `status`, `applicant_message`, `created_at`, `updated_at`, `resubmitted_at` | Required for cabinet status, applicant communication and resubmission; included. |
| `MODERATOR_ONLY` | `internal_notes`, `call_at` | Excluded from owner projection and denied to client roles on the base table. |
| `ADMIN_ONLY` | None currently classified solely as admin-only on this relation. | Future admin-only columns are denied by default until an explicit contract is reviewed. |
| `BACKEND_ONLY` | `owner_id`, `category_text`, `services`, `links`, `recommendations`, `video_links` | Required by ownership, legacy publication or trusted workflows but not by current owner reads; excluded. |
| `SYSTEM` | `consent_truthful`, `consent_personal_data`, `status_updated_at`, `contract_version` | Persistence, email/idempotency and validation metadata; excluded. |

The owner projection therefore has exactly 20 columns. An omitted field is not
implicitly safe: adding it requires a new reviewed projection version or an
explicit change to v1 with regression evidence.

## Affected files

- **Production files:** owner reads in `src/app/cabinet/page.tsx`,
  `src/app/apply/page.tsx`, `src/app/api/media/source/route.ts` and
  `src/app/api/media/view/route.ts`; trusted moderation reads in
  `src/app/admin/page.tsx` and `src/app/admin/actions.ts`.
- **Configuration files:** none.
- **Test files:** role-matrix cases, coverage, expected-failure ledger and
  runner; targeted static/source tests if needed.
- **Documentation/evidence files:** this change record,
  `SEC-002_LOCAL_VERIFICATION.md`, findings, hardening plan, test matrix,
  roadmap and harness documentation.
- **Explicitly unaffected files/components:** historical 18 migrations,
  `supabase/bootstrap/baseline.sql`, its manifest/verification, legacy
  `schema.sql`, Auth configuration, Storage policies, SEC-001 migrations and
  remote Supabase.

## Database changes

- **Migration path:** one new generated forward migration in
  `supabase/forward-migrations/`.
- **Exact objects/signatures:** `public.owner_applications_v1` security-invoker
  view; base-table/view grants; owner `application_events` SELECT policy routed
  through the safe view so it no longer depends on protected `owner_id` access.
- **Before grants/policies/ACL:** table-level SELECT for `authenticated`; owner
  and moderator SELECT policies expose every selectable column.
- **After grants/policies/ACL:** table-level SELECT revoked from client roles;
  `authenticated` receives SELECT only on the 20 allowlisted base columns
  needed by a security-invoker view; the view receives explicit authenticated
  SELECT; protected and future columns remain ungranted. Service backend keeps
  its existing trusted access.
- **Views/functions/search_path changes:** explicit-column
  `owner_applications_v1` with `security_invoker=true`; no function and no
  `SECURITY DEFINER` addition.
- **Clean-room replay result:** PASS in two independent disposable projects.
- **Catalog diff result:** PASS for the SEC-002 grant/view/policy contract; no
  unexplained database-lint or Security Advisor delta.
- **Full role-matrix result:** both runs produced `PASS=83`, `XFAIL=22`,
  `XPASS=0`, `FAIL=0`, `SKIP=0`.
- **Seed/data reconciliation:** none; no row mutation required.
- **Production application approval:** Not granted.

## Before state

- **Test matrix ID(s):** DB-02, DB-03, DB-04, DB-23; READ-005;
  APPREAD-001..009.
- **Environment:** two independent disposable local Supabase/PostgreSQL 17
  projects; never remote.
- **Roles/accounts/fixtures:** anon, owner A, user B, moderator AAL1 and local
  service backend; synthetic `example.invalid` users and application rows.
- **Safe reproduction steps:** replay verified baseline and both SEC-001
  migrations, query protected columns/base wildcard, require the missing safe
  projection, and add a synthetic future column only to the disposable DB.
- **Expected failing security invariant:** protected and future columns must be
  unavailable while an explicit owner projection remains usable.
- **Actual result:** both runs produced `PASS=74`, `XFAIL=31`, `XPASS=0`,
  `FAIL=0`, `SKIP=0`. The existing READ-005 and eight new APPREAD cases are the
  nine SEC-002 XFAILs; trusted backend compatibility APPREAD-007 passed.
- **Evidence artifact/hash:** redacted console counts only; no run-specific
  artifact retained.
- **Secrets/PII handling:** local keys/passwords remained in process memory;
  no token, UUID, email, row value or port was printed.

## After state

- **Secure contract:** owners query versioned view `owner_applications_v1`;
  direct base reads are limited to the same safe columns needed for
  security-invoker evaluation; protected/base-wildcard access fails.
- **Allowed positive paths:** own owner projection; trusted server moderation
  reads; existing backend submit/update/publication workflows.
- **Denied direct/bypass paths:** protected base columns, base `*`, protected
  projection fields, anonymous projection, cross-owner projection and future
  columns.
- **Concurrency/idempotency contract:** unchanged; no row mutation introduced.
- **Failure-mode/fail-closed contract:** a newly added column is invisible until
  explicitly classified, granted and added to a reviewed projection.
- **Residual risk:** owner-safe base column grants remain necessary for the
  security-invoker view; the view and grants must be changed together. Hosting
  and remote rollout remain pending.
- **Supporting compatibility correction:** the first post-fix run correctly
  failed `EVENT-001` because its pre-existing policy selected
  `applications.owner_id` under the caller after broad SELECT was revoked. The
  policy now proves ownership through `owner_applications_v1`; this preserves
  the existing non-internal owner event path without exposing `owner_id`.
- **Out-of-scope follow-ups:** SEC-003/007/010/018 and GraphQL runtime testing if
  the application later adopts GraphQL.

## Tests

| Test ID / case | Environment | Role | Expected | Red result | Post-fix status |
|---|---|---|---|---|---|
| READ-005 | disposable local | owner | protected base columns unavailable | XFAIL / SEC-002 | PASS (2/2) |
| APPREAD-001/003 | disposable local | owner | exact v1 projection works | XFAIL / SEC-002 | PASS (2/2) |
| APPREAD-002/009 | disposable local | owner | wildcard/protected bypass denied | XFAIL / SEC-002 | PASS (2/2) |
| APPREAD-004/005 | disposable local | user B / anon | no foreign/anonymous data | XFAIL because required contract absent | PASS (2/2) |
| APPREAD-006 | disposable local | moderator client | no direct protected base read | XFAIL / SEC-002 | PASS (2/2) |
| APPREAD-007 | disposable local | service backend | moderation data retained | PASS | PASS (2/2) |
| APPREAD-008 | disposable local | owner | future column denied and omitted | XFAIL / SEC-002 | PASS (2/2) |

- **Targeted security tests:** role-matrix APPREAD cases and catalog grants.
- **Negative bypass tests:** direct REST explicit fields, wildcard, projection
  unknown fields, future column, cross-owner and anonymous access.
- **Positive allowlisted tests:** owner v1 row and trusted backend moderation
  read.
- **Concurrency/fault-injection tests:** N/A; read-boundary-only change.
- **Migration replay/catalog tests:** PASS in two fresh baseline + ordered
  forward-migration runs.
- **Relevant regression suite:** 115/115 Node tests PASS; typecheck PASS;
  ESLint PASS with 0 errors and 12 pre-existing warnings.
- **Cleanup verification:** PASS after all red and post-fix projects; no
  disposable container, network, volume, directory or credential remains.

## Security verification

- [x] Before-state safely reproduced outside production and recorded as XFAIL.
- [x] Targeted post-change tests PASS.
- [x] All relevant roles verified.
- [x] Direct REST/Data API bypass verified after fix.
- [x] Positive business paths verified.
- [x] Relevant regression suite PASS.
- [x] Migration replay, catalog checks and two role-matrix runs PASS.
- [x] Advisors reviewed for SEC-002 delta.
- [x] Secret/PII scan PASS.
- [x] No test or change was executed against production.
- [ ] Independent review completed.

## Rollback

- **Rollback trigger:** owner flow cannot read its documented v1 fields or
  trusted moderation reads fail after deployment.
- **Decision owner:** DB/App/Security owners.
- **Exact reversible scope:** fix the projection/grant pair forward; do not
  restore broad client SELECT.
- **Safe fallback / feature disable:** temporarily route owner reads only
  through an authenticated server endpoint while base protected columns remain
  revoked.
- **Forward-fix path:** create a reviewed v2 projection or correct the explicit
  v1 column grants in a new forward migration.
- **Data reconciliation:** none.
- **Backup/restore prerequisite:** catalog/recovery evidence required for any
  future remote migration window; no data transformation occurs.
- **Rollback verification tests:** repeat all APPREAD and owner UI tests.
- **Forbidden rollback actions:** table-level SELECT to `authenticated`,
  `GRANT ALL`, a definer view, `SELECT *`, rewriting history, or remote restore
  without approval.

## Commit

- **Planned commit message:** `fix(security): enforce owner-safe application projection`
- **Commit SHA:** Created by the final reviewed SEC-002 commit; see Git history.
- **Branch:** `security/hardening`
- **Files included:** SEC-002 forward migration, minimal owner/moderator source
  changes, harness/tests and SEC-002 evidence documentation.
- **Evidence linked to commit:** two post-fix run summaries and regression
  results.
- **Review approval:** Pending.
- **Finding status after verification:**
  `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT`.
- **Production release status:** BLOCKED / remote unchanged.
