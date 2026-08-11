# AL-AMIN Live Catalog Evidence

## 1. Scope and collection boundary

- **Stage:** P0-02B-B2k, metadata-only evidence collection.
- **Collection date:** 2026-08-11 (Europe/Moscow).
- **Source method:** owner-authenticated Supabase Dashboard, confirmed project `amanat`.
- **Database access mode:** every SQL block ran separately inside `BEGIN TRANSACTION READ ONLY` and ended with `ROLLBACK`.
- **Approved sources:** PostgreSQL catalogs and the five allowlisted columns of `storage.buckets`; Auth settings were read only from configuration pages.
- **Production mutations:** none.
- **Application/Auth/Storage data rows:** not read.

The evidence below is a redacted review artifact. It contains no connection
details, project reference, host, port, API key, JWT, password, user/session
identifier, email address, uploaded-object identifier, or application content.
Raw Dashboard result buffers were not added to the repository.

## 2. Collection result

| Evidence class | Records | Status |
| --- | ---: | --- |
| PostgreSQL version | 1 | Collected |
| Non-system schemas | 10 | Collected |
| Tables/partitioned tables | 51 | Collected |
| Columns | 523 | Collected; 10 default literals redacted |
| User-defined type/enum rows | 128 | Collected |
| Primary/foreign keys | 100 | Collected |
| Indexes | 149 | Collected |
| Table RLS state | 51 | Collected |
| RLS policies | 45 | Collected |
| Relation ACL entries | 1,401 | Collected |
| Schema ACL entries | 62 | Collected |
| Default ACL entries | 300 | Collected |
| Functions | 130 | Collected without bodies or invocation |
| Function ACL entries | 447 | Collected |
| Views | 7 | Collected without selecting view rows |
| View ACL entries | 120 | Collected |
| Non-internal triggers | 25 | Collected without arguments or invocation |
| Storage buckets | 2 | Collected; no `storage.objects` read |
| Auth configuration | 5 control groups | Collected from configuration UI |

PostgreSQL reports version **17.6**.

## 3. Database structure

### 3.1 Schemas and tables

The ten observed non-system schemas are `auth`, `extensions`, `graphql`,
`graphql_public`, `pgbouncer`, `public`, `realtime`, `storage`,
`supabase_migrations`, and `vault`.

Table counts by schema:

| Schema | Tables |
| --- | ---: |
| `auth` | 23 |
| `public` | 15 |
| `realtime` | 3 |
| `storage` | 8 |
| `supabase_migrations` | 1 |
| `vault` | 1 |

`realtime.messages` is the only partitioned table in this inventory. The 15
application tables in `public` are:

`account_profiles`, `application_events`, `applications`, `audit_log`,
`categories`, `complaints`, `email_notifications`, `moderators`, `reviews`,
`site_content`, `specialist_revisions`, `specialist_trust_badges`,
`specialists`, `trust_badges`, and `verifications`.

### 3.2 Public table column inventory

This compact inventory records every public column and its catalog type. `?`
means nullable. Defaults were collected separately; only security-relevant
defaults are summarized below.

| Table | Columns |
| --- | --- |
| `account_profiles` | `id uuid`, `email text?`, `display_name text?`, `avatar_url text?`, `created_at timestamptz`, `updated_at timestamptz` |
| `application_events` | `id uuid`, `application_id uuid`, `actor_id uuid?`, `event_type text`, `message text?`, `is_internal boolean`, `created_at timestamptz` |
| `applications` | `id uuid`, `full_name text`, `contact text`, `country text`, `city text`, `category_text text`, `description text`, `services text`, `links text?`, `recommendations text?`, `consent_truthful boolean`, `consent_personal_data boolean`, `status application_status`, `internal_notes text?`, `call_at timestamptz?`, `created_at timestamptz`, `updated_at timestamptz`, `category_id uuid?`, `additional_category_ids uuid[]`, `specialization text?`, `video_links text[]`, `main_image_path text?`, `gallery_paths text[]`, `owner_id uuid?`, `status_updated_at timestamptz`, `experience_years integer?`, `applicant_message text?`, `resubmitted_at timestamptz?`, `contract_version smallint`, `profile_summary text`, `help_topics jsonb`, `work_offers jsonb` |
| `audit_log` | `id bigint`, `actor_id uuid?`, `entity_type text`, `entity_id uuid?`, `action text`, `details jsonb`, `created_at timestamptz` |
| `categories` | `id uuid`, `name text`, `slug text`, `is_active boolean`, `created_at timestamptz`, `group_name text` |
| `complaints` | `id uuid`, `specialist_id uuid?`, `review_id uuid?`, `reason text`, `description text`, `reporter_contact text`, `materials_links text?`, `status complaint_status`, `internal_notes text?`, `created_at timestamptz` |
| `email_notifications` | `id uuid`, `event_type text`, `user_id uuid?`, `recipient_email text`, `application_id uuid?`, `revision_id uuid?`, `specialist_id uuid?`, `subject text`, `template_data jsonb`, `status text`, `attempts integer`, `last_error text?`, `provider_message_id text?`, `idempotency_key text`, `next_attempt_at timestamptz`, `created_at timestamptz`, `sent_at timestamptz?`, `updated_at timestamptz` |
| `moderators` | `user_id uuid`, `role moderator_role`, `created_at timestamptz` |
| `reviews` | `id uuid`, `specialist_id uuid`, `author_contact text?`, `body text`, `would_hire_again boolean`, `evidence_checked boolean`, `is_published boolean`, `created_at timestamptz` |
| `site_content` | `id boolean`, `brand_name text`, `tagline text`, `hero_title text`, `hero_text text`, `contact_email text`, `about_text text`, `rules_intro text`, `privacy_text text`, `seo_title text`, `seo_description text`, `updated_at timestamptz`, `updated_by uuid?` |
| `specialist_revisions` | `id uuid`, `specialist_id uuid`, `owner_id uuid`, `payload jsonb`, `status text`, `moderator_id uuid?`, `moderator_comment text?`, `created_at timestamptz`, `updated_at timestamptz`, `decided_at timestamptz?` |
| `specialist_trust_badges` | `id uuid`, `specialist_id uuid`, `badge_id uuid`, `assigned_by uuid?`, `assigned_at timestamptz`, `source text`, `admin_note text?` |
| `specialists` | `id uuid`, `owner_id uuid?`, `application_id uuid?`, `category_id uuid?`, `slug text`, `full_name text`, `country text`, `city text`, `services text[]`, `service_mode text`, `experience_years integer?`, `short_description text`, `full_description text?`, `public_contact text?`, `portfolio_links text[]`, `avatar_path text?`, `status profile_status`, `verified_at timestamptz?`, `verification_method text?`, `published_at timestamptz?`, `created_at timestamptz`, `updated_at timestamptz`, `additional_category_ids uuid[]`, `specialization text?`, `video_links text[]`, `gallery_paths text[]`, `recommendations text?`, `contract_version smallint`, `profile_summary text`, `help_topics jsonb`, `work_offers jsonb` |
| `trust_badges` | `id uuid`, `code text`, `title text`, `description text`, `icon text`, `assignment_type text`, `is_active boolean`, `sort_order smallint`, `created_at timestamptz`, `updated_at timestamptz` |
| `verifications` | `id uuid`, `specialist_id uuid`, `identity_checked boolean`, `contacts_checked boolean`, `interview_completed boolean`, `references_checked boolean`, `checked_by uuid?`, `private_notes text?`, `created_at timestamptz`, `education_checked boolean`, `experience_checked boolean`, `qualifications_checked boolean`, `sources_checked smallint`, `checked_at timestamptz?` |

The four public enums are `application_status`, `complaint_status`,
`moderator_role`, and `profile_status`. Across `public`, all 15 primary keys and
all 26 foreign keys are validated. All 31 public indexes are valid and ready;
25 are unique. The full catalog contained 51 primary keys, 49 foreign keys,
and 149 indexes.

Security-relevant defaults include `applications.contract_version = 2`,
`applications.status = new`, `reviews.is_published = false`,
`reviews.evidence_checked = false`, and `complaints.status = new`.

## 4. RLS and policies

RLS is enabled on **40 of 51** non-system tables, including **all 15** public
tables and **all 8** Storage tables. `FORCE ROW LEVEL SECURITY` is not enabled
on any inventoried table.

There are 45 policies: 38 in `public` and 7 in `storage`. All are permissive;
there are no restrictive policies. Public policy inventory:

| Table | Policy | Command | Roles | Predicate summary |
| --- | --- | --- | --- | --- |
| `account_profiles` | Users read own account profile | SELECT | authenticated | `id = auth.uid()` |
| `account_profiles` | Users update own account profile | UPDATE | authenticated | owner in both USING and WITH CHECK |
| `application_events` | Moderators read application events | SELECT | authenticated | `is_moderator()` |
| `application_events` | Owners read own application events | SELECT | authenticated | owner application and not internal |
| `applications` | Admin deletes applications | DELETE | authenticated | `is_admin()` |
| `applications` | Moderator reads all applications | SELECT | authenticated | `is_moderator()` |
| `applications` | Moderator updates applications | UPDATE | authenticated | moderator in USING and WITH CHECK |
| `applications` | Owners read own applications | SELECT | authenticated | `owner_id = auth.uid()` |
| `audit_log` | Moderator reads audit | SELECT | authenticated | `is_moderator()` |
| `audit_log` | Moderator writes audit | INSERT | authenticated | `is_moderator()` |
| `categories` | Admin manages categories | ALL | authenticated | `is_admin()` |
| `categories` | Public reads active categories | SELECT | PUBLIC | active rows only |
| `complaints` | Anyone submits complaint | INSERT | anon, authenticated | status must be `new` |
| `complaints` | Moderator reads complaints | SELECT | authenticated | `is_moderator()` |
| `complaints` | Moderator updates complaints | UPDATE | authenticated | moderator in USING and WITH CHECK |
| `email_notifications` | Moderators read email notifications | SELECT | authenticated | `is_moderator()` |
| `email_notifications` | Owners read own email notifications | SELECT | authenticated | `user_id = auth.uid()` |
| `moderators` | Admin manages moderators | ALL | authenticated | `is_admin()` |
| `moderators` | Users read own moderator role | SELECT | authenticated | `user_id = auth.uid()` |
| `reviews` | Anyone submits review | INSERT | anon, authenticated | not published and not evidence-checked |
| `reviews` | Moderator reads reviews | SELECT | authenticated | `is_moderator()` |
| `reviews` | Moderator updates reviews | UPDATE | authenticated | moderator in USING and WITH CHECK |
| `site_content` | Admins update site content | UPDATE | PUBLIC | `is_admin()` in USING and WITH CHECK |
| `site_content` | Public reads site content | SELECT | PUBLIC | true |
| `specialist_revisions` | Admin deletes specialist revisions | DELETE | authenticated | `is_admin()` |
| `specialist_revisions` | Moderators read revisions | SELECT | authenticated | `is_moderator()` |
| `specialist_revisions` | Owners read own revisions | SELECT | authenticated | `owner_id = auth.uid()` |
| `specialist_trust_badges` | Admins manage specialist badges | ALL | authenticated | `is_admin()` |
| `specialist_trust_badges` | Moderators read specialist badges | SELECT | authenticated | `is_moderator()` |
| `specialists` | Admins delete specialists | DELETE | authenticated | `is_admin()` |
| `specialists` | Moderator reads specialists | SELECT | authenticated | `is_moderator()` |
| `specialists` | Moderators update specialists | UPDATE | authenticated | moderator in USING and WITH CHECK |
| `specialists` | Owners read own specialists | SELECT | authenticated | `owner_id = auth.uid()` |
| `trust_badges` | Admins manage trust badges | ALL | authenticated | `is_admin()` |
| `trust_badges` | Moderators read trust badges | SELECT | authenticated | `is_moderator()` |
| `trust_badges` | Public reads active trust badges | SELECT | PUBLIC | active rows only |
| `verifications` | Moderators manage verifications | ALL | authenticated | `is_moderator()` |
| `verifications` | Moderators read verifications | SELECT | authenticated | `is_moderator()` |

The relation ACL layer is broad: `anon` and `authenticated` have relation
privileges on public objects, with RLS acting as the row-level gate. Neither
client role has `CREATE` on the public schema. Default privileges for objects
created by `postgres` and `supabase_admin` grant client roles broad relation,
sequence, and function privileges by default. No client ACL entry is grantable.

## 5. Functions and RPC surface

The catalog contains 130 functions: 32 in `public`. Twenty-one functions are
`SECURITY DEFINER`; 18 are in `public`. Every observed `SECURITY DEFINER`
function has an explicit `search_path`, but these paths include mutable
application schemas (`public`, and sometimes `storage`) rather than an empty or
catalog-only path.

Public `SECURITY DEFINER` functions callable by at least one client role are:

| Function | Client EXECUTE | Search path |
| --- | --- | --- |
| `apply_specialist_revision(uuid, boolean, text)` | authenticated | `public` |
| `enqueue_application_email()` | PUBLIC, anon, authenticated | `public` |
| `enqueue_profile_hidden_email()` | PUBLIC, anon, authenticated | `public` |
| `enqueue_revision_email()` | PUBLIC, anon, authenticated | `public` |
| `is_admin()` | PUBLIC, anon, authenticated | `public` |
| `is_moderator()` | PUBLIC, anon, authenticated | `public` |
| `record_application_event()` | PUBLIC, anon, authenticated | `public` |
| `request_specialist_revision_changes(uuid, text)` | anon, authenticated | `public` |
| `return_owner_changes_to_moderation()` | PUBLIC, anon, authenticated | `public` |
| `sync_account_profile()` | PUBLIC, anon, authenticated | `public` |
| `sync_published_verified_badge()` | PUBLIC, anon, authenticated | `public` |

Other public definer functions are restricted to `service_role` in the
observed ACL. Function bodies were deliberately not collected and no function
was invoked, so business-logic exploitability is not established by this
catalog evidence alone.

## 6. Views

Seven views exist: two in `extensions`, four in `public`, and one in `vault`.
The four public views are ordinary views with `security_barrier=true` and
`security_invoker=false`:

| View | Public contract | Client grants |
| --- | --- | --- |
| `published_reviews` | published review id, specialist, body, hiring flag, timestamp | SELECT to anon/authenticated |
| `published_specialist_trust_badges` | active non-verified public badge assignments | SELECT to anon/authenticated |
| `published_specialist_verification_facts` | selected verification facts for published specialists | SELECT to anon/authenticated |
| `published_specialists` | published specialist projection | SELECT to anon/authenticated |

No view was queried for rows. The `vault.decrypted_secrets` view was inventoried
by name and catalog definition only; it was never selected.

## 7. Triggers

There are 25 non-internal triggers: 19 in `public`, 4 in `storage`, 1 in
`auth`, and 1 in `realtime`. All public triggers use normal enabled mode.

| Table | Trigger | Timing/events | Function |
| --- | --- | --- | --- |
| `applications` | `applications_enqueue_email` | AFTER INSERT/UPDATE | `enqueue_application_email` |
| `applications` | `applications_guard_media_ownership` | BEFORE INSERT/UPDATE | `guard_application_media_ownership` |
| `applications` | `applications_guard_owner_update` | BEFORE UPDATE | `guard_owner_application_update` |
| `applications` | `applications_publish_after_approval` | AFTER UPDATE | `publish_after_application_approval` |
| `applications` | `applications_record_event` | AFTER INSERT/UPDATE | `record_application_event` |
| `applications` | `applications_require_contract_v2_on_content_write` | BEFORE INSERT/UPDATE | `require_application_contract_v2_on_content_write` |
| `applications` | `applications_status_updated_at` | BEFORE UPDATE | `track_application_status` |
| `applications` | `applications_updated_at` | BEFORE UPDATE | `set_updated_at` |
| `email_notifications` | `email_notifications_touch` | BEFORE UPDATE | `touch_email_notification` |
| `site_content` | `touch_site_content` | BEFORE UPDATE | `touch_site_content` |
| `specialist_revisions` | `specialist_revisions_enqueue_email` | AFTER INSERT/UPDATE | `enqueue_revision_email` |
| `specialist_revisions` | `specialist_revisions_guard_payload` | BEFORE INSERT/UPDATE | `guard_specialist_revision_payload` |
| `specialist_revisions` | `specialist_revisions_owner_resubmit` | BEFORE UPDATE | `guard_owner_revision_update` |
| `specialist_revisions` | `specialist_revisions_require_contract_v2_on_payload_write` | BEFORE INSERT/UPDATE | `require_revision_contract_v2_on_payload_write` |
| `specialist_revisions` | `specialist_revisions_updated_at` | BEFORE UPDATE | `set_specialist_revision_updated_at` |
| `specialists` | `specialists_enqueue_hidden_email` | AFTER UPDATE | `enqueue_profile_hidden_email` |
| `specialists` | `specialists_owner_changes_to_moderation` | BEFORE UPDATE | `return_owner_changes_to_moderation` |
| `specialists` | `specialists_updated_at` | BEFORE UPDATE | `set_updated_at` |
| `trust_badges` | `trust_badges_updated_at` | BEFORE UPDATE | `set_trust_badge_updated_at` |

Encoded trigger arguments and trigger-function bodies were not collected.

## 8. Storage metadata

| Bucket | Public | Size limit | Allowed MIME types |
| --- | --- | ---: | --- |
| `avatars` | yes | 2 MiB | JPEG, PNG, WebP |
| `profile-media` | no | 5 MiB | JPEG, PNG, WebP |

All eight Storage tables have RLS enabled; none uses FORCE RLS. Seven policies
exist on `storage.objects`:

- authenticated moderators may INSERT/DELETE in `avatars`;
- PUBLIC may SELECT `avatars`;
- authenticated owners may SELECT/INSERT/UPDATE/DELETE in
  `profile-media/submissions/<auth.uid()>/`.

No `storage.objects` row, count, name, path, owner, metadata, or file was read.

## 9. Auth configuration metadata

| Control | Live state |
| --- | --- |
| Email sign-in | enabled |
| Email confirmation | required |
| Enabled providers | Email, Google |
| Single-session enforcement | disabled |
| Session time-boxing | disabled (`never`) |
| Inactivity timeout | disabled (`never`) |
| TOTP enrollment | enabled |
| MFA verification | disabled |

No Auth user, identity, session, factor, token, log, provider client ID, or
provider secret was opened or retained.

## 10. Redactions and validation

Ten `public.site_content` default expressions were redacted: one email literal
and nine application-content literals. Only object name, reason, replacement,
and a locally calculated SHA-256 were retained:

| Object | Reason | SHA-256 |
| --- | --- | --- |
| `public.site_content.contact_email` | email literal | `bf110360a721c180425f8953f1c7da1c1486ad1732dbea6c6596d2cb63351533` |
| `public.site_content.brand_name` | application content | `cac335014a4726c6b7859c8b277de5111c3f7cbe3d0d1889c54cf9754600e86b` |
| `public.site_content.tagline` | application content | `3cefa775b2dc87ab0282329ac61c939237602e1a2bc8a74dfacdc9cb740b7126` |
| `public.site_content.hero_title` | application content | `3cefa775b2dc87ab0282329ac61c939237602e1a2bc8a74dfacdc9cb740b7126` |
| `public.site_content.hero_text` | application content | `d4abe664339ecbd7cf76c9d3cd70adfc0fa7391ef6064b0a64b6d28783c49620` |
| `public.site_content.about_text` | application content | `f1d2963080a4c2fb0038cc523644a6cd2799a449912bc3b7d1796db025a1c3a4` |
| `public.site_content.rules_intro` | application content | `bf83218734bbd46c71e5f1dc9620c164e8bdc9f0ebf969123acd81af70212fa4` |
| `public.site_content.privacy_text` | application content | `ecd5eca75594d25ae4eaea9e7844fb6dfd5f6fa930b86473971dcac1eb2d11e6` |
| `public.site_content.seo_title` | application content | `4ce2e4067a28e62005e6c5d2cab3610bddf1d9487560e13bd7138cdc5f4ba5ca` |
| `public.site_content.seo_description` | application content | `bcbdf5bcdd4cb2c2a41ddcfb3bc25c7578accd48ec03455b9a5eb02ab5dd1f25` |

Post-redaction scans found no JWT, key, password, private-key header,
connection URI, email, user UUID, project reference, host, IP address, or
application-row content in retained evidence.

## 11. Known limits

- Extension names/versions and database settings beyond PostgreSQL version are
  `UNKNOWN`: the approved package contained no query for them.
- Function bodies, view ownership, role membership, object ownership, and
  Auth provider secret-bearing configuration were intentionally omitted.
- Catalog evidence establishes configuration and privilege surfaces, not
  successful or failed access for concrete roles. Role-matrix tests remain
  required.
- Because the tracked migration chain is not clean-room reproducible, exact
  end-to-end equivalence cannot be proven from migrations alone.
