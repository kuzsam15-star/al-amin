# SEC-003 — Moderator/Admin Field and Transition Boundary

## Security issue

- **Finding ID:** SEC-003, with the action-scoped SEC-010 AAL gate.
- **Название:** Moderator/admin field and transition boundary.
- **Severity / launch blocker:** High / yes.
- **Roadmap task / workflow priority:** P0-05.
- **Security-инвариант этого change:** client roles cannot mutate privileged base
  tables directly. A current moderator may perform only named moderation
  decisions; destructive, role, lifecycle, verification, trust and content
  administration requires a current administrator with a signed AAL2 session.
- **Owner:** AL-AMIN application/database owner.
- **Reviewer(s):** independent adversarial review remains a later gate.
- **Dependencies / prerequisites:** verified no-data baseline; SEC-001 and SEC-002
  forward migrations; real local Auth AAL1/AAL2 role-matrix harness.
- **Status:** IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_BACKEND_DEPLOYMENT.

## Threat model

- **Actors:** anon, ordinary authenticated user, resource owner, moderator AAL1,
  admin AAL1, admin AAL2, service backend, and an attacker controlling a normal
  or moderator account.
- **Prerequisites / attacker access:** a valid client session or direct access to
  the public Data API/RPC endpoint; no service credential is required for the
  confirmed pre-change moderator paths.
- **Assets / trust boundaries:** application ownership and moderation truth;
  specialist publication identity/lifecycle; verification facts; moderator/admin
  membership; badge/content/category administration; audit attribution; the
  signed Auth `aal` claim; service-only publication primitives.
- **Attack paths:** moderator supplies `owner_id` or a hidden protected field;
  sets an admin-only status; self-promotes or assigns another role; calls a
  privileged RPC directly; admin AAL1 performs a sensitive mutation; a client
  forges an `aal` payload; a stale role remains usable; broad Data API UPDATE or
  DELETE bypasses the UI; a permissive `SECURITY DEFINER` function or broad
  `EXECUTE` bypasses RLS; a transition is skipped or replayed; concurrent
  decisions conflict; a client writes a forged audit entry; a service-only
  primitive is exposed.
- **Impact:** account/profile takeover, unauthorized publication or hiding,
  fabricated verification, privileged role escalation, destructive deletion,
  misleading public content, and untrustworthy audit evidence.
- **Expected secure behavior:** role and AAL are revalidated from current
  database membership and the signed JWT at mutation time; payloads never decide
  actor, owner or role; each function has an exact action and field allowlist;
  invalid/replayed transitions fail closed; row locks serialize conflicts; direct
  table DML and non-allowlisted RPC access are denied.
- **Confirmed facts:** pre-change moderator RLS allowed broad `specialists`
  UPDATE and `verifications` ALL; admin policies allowed direct category,
  moderator, site-content and badge DML without AAL; direct moderator audit
  INSERT remained; `updateProfile` combined every profile status with
  verification writes; `requireAdmin` checked role only.
- **Unverified hypotheses:** none are used as authorization input.
- **Out of scope:** mandatory MFA enrollment and privileged private-read AAL2
  coverage outside these mutation actions (residual SEC-010); complete atomic
  outbox/audit guarantees for every legacy action (SEC-018); the weak batch
  revision classifier (SEC-022); broad default ACL/search-path cleanup
  (SEC-015/016); application submission and all wider concurrency findings
  (SEC-007/008); remote deployment.

## Exact action inventory

`ALLOW` means a named action at AAL1. `A2` means a named AAL2-only action.
`SERVICE` means a server-only primitive using disposable/local service authority;
all unlisted combinations are `DENY`.

| Action | anon/user/owner | moderator AAL1 | admin AAL1 | admin AAL2 | service backend |
|---|---|---|---|---|---|
| Approve application with canonical media | DENY | server action initiates after current-role check | same moderator contract | same moderator contract | SERVICE |
| Reject/request changes on application | DENY | ALLOW | ALLOW as moderator | ALLOW as moderator | SERVICE recovery only |
| Change arbitrary application status/owner | DENY | DENY | DENY | owner DENY; archive/restore A2 | SERVICE |
| Delete application | DENY | DENY | DENY | A2 | SERVICE recovery only |
| Approve/reject/request changes on revision | DENY | ALLOW named RPC | ALLOW as moderator | ALLOW as moderator | SERVICE only for canonical media copy |
| Direct specialist publication-field mutation | DENY | DENY | DENY | DENY; named lifecycle A2 only | SERVICE |
| Verification grant/revoke | DENY | DENY | DENY | A2 | SERVICE recovery only |
| Manual trust-badge assignment/removal | DENY | DENY | DENY | A2 | SERVICE recovery only |
| Moderator/admin membership or role assignment | DENY | DENY | DENY | A2, no self-change | SERVICE break-glass only |
| Profile/application/revision lifecycle deletion | DENY | DENY | DENY | A2 | SERVICE recovery only |
| Site-content management | DENY | DENY | DENY | A2 | SERVICE recovery only |
| Category administration | DENY | DENY | DENY | A2 named RPC | SERVICE recovery only |
| Email retry reset | DENY | DENY | DENY | A2 | SERVICE delivery worker |
| Review/complaint decision | DENY | ALLOW named RPC | ALLOW as moderator | ALLOW as moderator | SERVICE recovery only |
| Audit append | DENY | only inside named RPC | only inside named RPC | only inside named RPC | internal/service transaction |

## Sensitive field classification

| Relation | OWNER_MUTABLE | MODERATOR_MUTABLE | ADMIN_MUTABLE (AAL2 named action) | SERVICE_ONLY / IMMUTABLE_SYSTEM |
|---|---|---|---|---|
| `applications` | applicant contract fields only through owner server flow | `status` to `changes_requested`/`rejected`, `internal_notes`, `applicant_message` through decision RPC | archive/restore/delete through exact RPC | `owner_id`, canonical media, contract/version/timestamps and approval publication primitive |
| `specialists` | none directly; revision payload only | none directly | allowlisted lifecycle `status`; verification is separate data | `owner_id`, `application_id`, slug/publication/media/content fields, `published_at`, created/updated timestamps |
| `specialist_revisions` | payload through owner server flow while active | decision status, moderator ID/comment and decided timestamp only inside named RPC | delete through AAL2 RPC | `owner_id`, `specialist_id`, row identity/timestamps |
| `verifications` | none | none | explicit fact booleans, source count, checked actor/time through named RPC | row identity/specialist identity and created timestamp |
| `account_profiles` | current legacy owner policy remains SEC-025 | none | none in this change | mirrored `email`/identity and timestamps remain out of scope SEC-025 |
| `moderators` | none | own membership SELECT only | target membership/role via AAL2 named RPC; self-change denied | `created_at` and actor identity |
| `categories` | none | none | exact catalog fields via AAL2 named RPC | row identity/created timestamp |
| `site_content` | public read contract only | none | exact ten text fields via AAL2 named RPC | `id`, `updated_by`, `updated_at` |
| `trust_badges` / assignments | public published projection only | none | manual active badge IDs via AAL2 named RPC | assignment actor/time/source and automatic badges |
| `reviews` / `complaints` | existing intake stays SEC-004 | exact moderation fields via named RPC | same moderation contract | identities, authors/reporters, content and timestamps |
| `audit_log` | none | none directly | none directly | actor/action/target/timestamp written only by trusted functions |

Future columns inherit no client DML privilege and are therefore
`SERVICE_ONLY` until a reviewed named action explicitly lists them.

## Transition state machines

### Applications

| From | To | Actor / AAL | Preconditions | Side effects / audit |
|---|---|---|---|---|
| `new`, `screening`, `info_required`, `changes_requested`, `call_required`, `call_scheduled` | `changes_requested` | moderator or admin / AAL1 | expected `updated_at`; non-empty applicant message | moderator fields only; named audit event |
| same active set | `rejected` | moderator or admin / AAL1 | expected `updated_at` | terminal decision and named audit event |
| same active set | `approved` | controlled publication service after current moderator server check | expected `updated_at`; canonical media verified | existing SEC-001 atomic publication path plus actor audit |
| active non-approved or `rejected` | `withdrawn` | admin AAL2 | current expected status | archive audit |
| `withdrawn` | `new` | admin AAL2 | current expected status | restore audit |

Any other transition is denied. A stale timestamp, replay, or competing action
loses the row-lock/state check and changes nothing.

### Specialist revisions

| From | To | Actor / AAL | Preconditions | Side effects / audit |
|---|---|---|---|---|
| `pending` | `changes_requested` | moderator/admin AAL1 | non-empty comment, locked row | moderator fields and audit |
| `pending` | `rejected` | moderator/admin AAL1 | non-empty comment, locked row | moderator fields and audit |
| `pending` | `approved` | moderator/admin AAL1; service backend only when media copy is needed | locked row; owner/profile match; canonical media contract | allowlisted profile publication and audit |

Replay or a non-pending source status is denied. Full SEC-008/018 coverage is not
claimed merely because this change serializes the touched decision paths.

## Affected files

- **Production files:** `src/app/admin/actions.ts`, `src/app/admin/page.tsx`,
  `src/lib/auth.ts`; only privileged server/UI boundaries.
- **Database changes:** one generated forward migration under
  `supabase/forward-migrations/`; no historical or baseline edit.
- **Test files:** role-matrix case/ledger/coverage/runner plus focused Node
  contract tests.
- **Documentation/evidence:** this file, `SEC-003_LOCAL_VERIFICATION.md`, and
  minimal finding/plan/matrix/roadmap/harness status updates.
- **Explicitly unaffected:** verified baseline and manifest, historical 18
  migrations, legacy `schema.sql`, SEC-001/002 migrations, owner application
  projection, dependencies/lockfile, remote Supabase and hosting.

## Before state

- **Environment:** disposable local Supabase only.
- **Fixtures:** synthetic `example.invalid` Auth users and random local UUIDs.
- **Expected failing invariant:** broad moderator/admin DML and missing named/AAL
  actions produce only approved SEC-003/010 XFAIL.
- **Secrets/PII:** local tokens remain process memory; no fixture identifiers or
  values are printed or committed.
- **Evidence:** two independent red-phase runs each produced 88 PASS / 36 XFAIL /
  0 XPASS / 0 FAIL / 0 SKIP. The added failures mapped only to approved SEC-003
  and mutation-scoped SEC-010 expectations.

## After state

- **Secure contract:** no client base-table privileged mutation; exact named
  functions with current role, signed AAL, fixed `search_path`, row locks,
  explicit transitions and authoritative audit actor.
- **Allowed positive paths:** AAL1 moderation decisions; AAL2 admin lifecycle,
  verification, badge, role, category, content, retry and deletion actions.
- **Denied bypasses:** direct REST DML, ordinary-user RPC, moderator/admin AAL1
  admin RPC, client-provided role/AAL/owner fields, stale role, replay and invalid
  transitions.
- **Failure mode:** fail closed and retain the old row on authorization,
  transition, validation or audit error.
- **Residual risk:** SEC-010 remains partial pending privileged read/MFA/recent-auth
  work; SEC-018 remains open outside transactions added here.

## Tests

The role matrix provides direct REST/RPC negatives, real local TOTP AAL2
positives, role revocation, replay/concurrency and a transaction-rolled-back
future-column probe. Two final independent runs each produced 108 PASS /
16 unrelated XFAIL / 0 XPASS / 0 FAIL / 0 SKIP. Database lint was 0/0/0;
security advisors remained at the unrelated pre-hardening 4 ERROR / 8 WARN /
0 INFO. Existing Node tests passed 119/119, typecheck passed, and ESLint passed
with 0 errors and 12 pre-existing warnings.

## Rollback

- **Safe fallback:** disable the affected UI actions while retaining revoked
  client DML. Never restore broad table UPDATE/DELETE or generic RPC access.
- **Forward fix:** replace only the failing named function with a stricter
  forward migration; do not rewrite applied history.
- **Data reconciliation:** none is expected because the migration does not
  rewrite live rows. Any observed inconsistency requires separate read-only
  reconciliation before another mutation.
- **Rollback verification:** all direct-DML denial and role/AAL cases must remain
  PASS.
- **Forbidden rollback:** `GRANT ALL`, moderator generic UPDATE, AAL bypass,
  migration-history rewrite or remote restore.

## Commit

- **Planned commit message:** `fix(security): enforce moderator and admin boundaries`
- **Commit SHA:** recorded by the final reviewed commit for this change.
- **Branch:** `security/hardening`
- **Finding status after verification:** SEC-003 local verified pending
  pre-launch backend deployment; SEC-010 partial local verification only.
- **Production release status:** NOT DEPLOYED; remote Supabase unchanged.
