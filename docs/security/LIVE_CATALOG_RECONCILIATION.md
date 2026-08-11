# Live vs Git reconciliation

## Scope

This reconciliation compares the redacted live catalog evidence captured in
P0-02B-B2k with tracked `supabase/schema.sql`, all tracked migrations, the
architecture/dependency documents, and `SECURITY_FINDINGS.md`. It does not
compare production rows and does not assert that non-replayable migration
history is a canonical baseline.

## Confirmed matches

1. **Core application schema exists live.** All 15 expected public tables are
   present with the later application/revision/publication columns described by
   the Git snapshot. The legacy `schema.sql` contains only the initial subset;
   later columns and objects correspond to subsequent migrations.
2. **RLS coverage matches the intended baseline boundary.** All 15 public
   tables and all 8 Storage tables have RLS enabled. This matches the general
   architecture and tracked RLS statements. FORCE RLS is absent everywhere.
3. **Target server-only specialist-write migration is reflected live.** There
   is no owner/anonymous INSERT policy on `applications` and no owner
   INSERT/UPDATE policy on `specialist_revisions`. The contract-v2 trigger
   functions/triggers from
   `20260809001646_enforce_server_only_specialist_writes.sql` are present.
4. **Anonymous review/complaint writes are confirmed.** Live policies permit
   `anon` and `authenticated` INSERT into `reviews` and `complaints`, matching
   `schema.sql`, later retained policy history, and finding **SEC-004**.
5. **Media owner mutation surface is confirmed.** `profile-media` is private,
   but authenticated owners may INSERT/UPDATE/DELETE objects under their own
   `submissions/<auth.uid()>` prefix. This matches later Storage policies and
   finding **SEC-001**; a private bucket does not make published canonical
   object paths immutable.
6. **Published view design is confirmed.** The four public published views use
   `security_barrier=true`, `security_invoker=false`, and grant SELECT to
   `anon`/`authenticated`, matching tracked migrations and **SEC-015**.
7. **Broad function/default ACL exposure is confirmed.** Client roles receive
   broad default relation/sequence/function privileges, and several public
   trigger or privileged helper functions remain directly executable. This
   matches the enabling-risk evidence in **SEC-016**.
8. **Moderator/admin predicates are present.** Live moderator/admin policies
   use `is_moderator()` or `is_admin()` as described by the Git schema and
   security findings. This confirms the boundary exists, but does not prove
   the complete role-transition matrix or AAL2 enforcement.
9. **Storage bucket privacy state matches late hardening intent.** `avatars` is
   public and `profile-media` is private, matching the later hardening
   direction and architecture documentation.

## Confirmed drift

1. **`account_profiles` owner UPDATE policy returned live.** Live contains
   `Users update own account profile` for `authenticated`, with owner USING and
   WITH CHECK predicates. Tracked migration
   `202607300001_security_hardening.sql` explicitly drops this policy and no
   later tracked migration recreates it. This is confirmed production catalog
   drift and independently confirms **SEC-025**.
2. **`profile-media` MIME configuration differs from the latest tracked
   assignment.** Live permits JPEG, PNG, and WebP. The tracked
   `202607300001_security_hardening.sql` sets the bucket to WebP-only, and no
   later tracked migration changes `allowed_mime_types`. The live bucket is
   therefore broader than the latest tracked configuration statement.
3. **Auth control evidence is now stronger than the prior documentation.** The
   live Dashboard confirms TOTP enrollment is enabled but MFA verification is
   disabled; single-session, time-boxing, and inactivity timeout are also
   disabled. Earlier findings recorded dashboard enrollment/configuration as
   unknown. This is not a Git schema drift item, but it confirms the operational
   control gap behind **SEC-010**.

## Unknown

1. **Cause of catalog drift.** Metadata proves the owner UPDATE policy and
   MIME configuration differ from tracked history, but does not identify who
   or what recreated/changed them. SQL history, audit logs, and operator data
   were intentionally not read.
2. **Full migration equivalence.** The 18 historical migrations cannot replay
   from an empty database and timestamps do not encode their true dependency
   order. Therefore absence of an observed difference is not proof that live
   equals the migration directory.
3. **Function logic and exploitability.** Function bodies and functions were
   not executed. ACL metadata proves callable surfaces, but not whether every
   call can be exploited or which internal checks succeed.
4. **Role matrix behavior.** Catalog policies and grants were recorded, but no
   anon/authenticated/owner/moderator/admin fixture was created and no access
   probe was executed.
5. **Complete Auth equivalence.** Provider names and selected security controls
   were visible. Provider secrets, user/session/factor records, email templates,
   redirect identifiers, and admin APIs were correctly excluded.
6. **Extensions and relevant settings.** Extension versions and database
   settings beyond PostgreSQL 17.6 are unknown because the approved package did
   not include those queries.
7. **Storage contents and referential integrity.** Bucket/policy metadata was
   captured, but no object row or file was read. Orphans, path reuse, published
   byte immutability, quotas, and cleanup safety remain untested.
8. **View owner effects.** `security_invoker=false` is confirmed, but view owner
   identity was deliberately omitted. Role-matrix tests are still required to
   prove the exact exposed row/column boundary.

## Security implications

- **SEC-001 remains confirmed:** authenticated owner UPDATE/DELETE of media
  objects can bypass moderation integrity unless canonical published paths are
  immutable and controlled by a trusted writer.
- **SEC-004 remains confirmed:** direct anonymous review/complaint INSERT is a
  database-level bypass of application validation and anti-abuse controls.
- **SEC-010 is strengthened:** MFA verification and session hardening are not
  active in the observed Auth configuration.
- **SEC-015 remains confirmed:** the four public views do not use
  `security_invoker=true` and are client-readable.
- **SEC-016 remains confirmed:** default privileges and callable public
  functions create an opt-out rather than opt-in API surface.
- **SEC-025 remains confirmed drift:** an owner can update all columns of its
  own auth-mirror row, including the email used by notification workflows.
- The evidence does not close any finding. It establishes an authoritative
  catalog target for bootstrap design and future tests.

## Baseline requirements

The future no-data bootstrap baseline must:

1. Capture all 15 public tables, columns, constraints, indexes, enums, views,
   functions, triggers, bucket definitions, grants/default privileges, RLS
   states, and policies represented by the accepted live target.
2. Treat the two confirmed drift items as explicit design decisions, not copy
   them silently. In particular, the baseline must not reintroduce the
   `account_profiles` owner UPDATE policy or broaden `profile-media` MIME types
   without a reviewed acceptance decision.
3. Use explicit opt-in grants and function EXECUTE allowlists; do not reproduce
   broad default privileges merely because they exist live.
4. Preserve application behavior while correcting known security boundaries
   through separately reviewed forward changes. Catalog capture is evidence,
   not permission to encode current vulnerabilities as the desired state.
5. Produce deterministic redacted schema/ACL inventories and pass two empty
   clean-room replays before role-matrix work begins.
6. Add role-matrix tests for anon, authenticated owner A, owner B, moderator,
   admin, and trusted server/service paths, including Storage and RPC paths.
7. Add an Auth configuration manifest for email confirmation, enabled provider
   names, session controls, MFA enrollment, and MFA verification without
   exporting users or secrets.

## Reconciliation decision

The live catalog is necessary evidence but is **not safe to copy verbatim**.
Strategy C remains the recommended direction: generate a versioned, no-data
bootstrap for new local/CI/staging environments from a reviewed combination of
live catalog evidence, Git source, historical migrations, and security
requirements. Production migration history remains immutable. The next gate is
to approve the exact target-state decisions for every confirmed drift and
security-sensitive ACL before generating any SQL.
