-- P0-09: catalog, identity and privileged-read closure.
-- Forward-only over the verified pre-hardening baseline and P0-08 chain.

begin;

-- Future application objects are opt-in. Existing explicit grants are handled
-- below and are not inferred from platform-wide legacy defaults.
revoke create on schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences from public, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role supabase_admin
  revoke execute on functions from public, anon, authenticated, service_role;

-- A SECURITY INVOKER view cannot safely read the private base relations by
-- itself. These four internal, non-PostgREST functions are narrow projections:
-- fixed columns, fixed publication predicates, fixed search_path.
create or replace function private.catalog_published_specialists_v1()
returns table (
  id uuid,
  slug text,
  full_name text,
  country text,
  city text,
  category_id uuid,
  category_name text,
  category_slug text,
  additional_category_ids uuid[],
  specialization text,
  service_mode text,
  experience_years integer,
  profile_summary text,
  full_description text,
  help_topics jsonb,
  work_offers jsonb,
  avatar_path text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    specialist.id,
    specialist.slug,
    specialist.full_name,
    specialist.country,
    specialist.city,
    specialist.category_id,
    category.name,
    category.slug,
    specialist.additional_category_ids,
    specialist.specialization,
    specialist.service_mode,
    specialist.experience_years,
    specialist.profile_summary,
    specialist.full_description,
    specialist.help_topics,
    specialist.work_offers,
    specialist.avatar_path,
    specialist.published_at
  from public.specialists as specialist
  left join public.categories as category on category.id = specialist.category_id
  where specialist.status = 'published';
$$;

create or replace function private.catalog_published_reviews_v1()
returns table (
  id uuid,
  specialist_id uuid,
  body text,
  would_hire_again boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select review.id, review.specialist_id, review.body,
         review.would_hire_again, review.created_at
  from public.reviews as review
  where review.is_published = true;
$$;

create or replace function private.catalog_published_verification_facts_v1()
returns table (
  specialist_id uuid,
  identity_checked boolean,
  education_checked boolean,
  experience_checked boolean,
  qualifications_checked boolean,
  references_checked boolean,
  sources_checked smallint,
  checked_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    verification.specialist_id,
    verification.identity_checked,
    verification.education_checked,
    verification.experience_checked,
    verification.qualifications_checked,
    verification.references_checked,
    verification.sources_checked,
    verification.checked_at
  from public.verifications as verification
  join public.specialists as specialist on specialist.id = verification.specialist_id
  where specialist.status = 'published'
    and verification.checked_at is not null
    and (
      verification.identity_checked
      or verification.education_checked
      or verification.experience_checked
      or verification.qualifications_checked
      or verification.references_checked
    );
$$;

create or replace function private.catalog_published_trust_badges_v1()
returns table (
  id uuid,
  specialist_id uuid,
  badge_id uuid,
  source text,
  assigned_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select assignment.id, assignment.specialist_id, assignment.badge_id,
         assignment.source, assignment.assigned_at
  from public.specialist_trust_badges as assignment
  join public.specialists as specialist on specialist.id = assignment.specialist_id
  join public.trust_badges as badge on badge.id = assignment.badge_id
  where specialist.status = 'published'
    and badge.is_active = true
    and badge.code <> 'verified';
$$;

revoke all on function private.catalog_published_specialists_v1() from public, anon, authenticated;
revoke all on function private.catalog_published_reviews_v1() from public, anon, authenticated;
revoke all on function private.catalog_published_verification_facts_v1() from public, anon, authenticated;
revoke all on function private.catalog_published_trust_badges_v1() from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.catalog_published_specialists_v1() to anon, authenticated;
grant execute on function private.catalog_published_reviews_v1() to anon, authenticated;
grant execute on function private.catalog_published_verification_facts_v1() to anon, authenticated;
grant execute on function private.catalog_published_trust_badges_v1() to anon, authenticated;

create or replace view public.published_specialists
with (security_invoker = true, security_barrier = true)
as
select
  catalog.id,
  catalog.slug,
  catalog.full_name,
  catalog.country,
  catalog.city,
  catalog.category_id,
  catalog.category_name,
  catalog.category_slug,
  catalog.additional_category_ids,
  catalog.specialization,
  catalog.service_mode,
  catalog.experience_years,
  catalog.profile_summary,
  catalog.full_description,
  catalog.help_topics,
  catalog.work_offers,
  catalog.avatar_path,
  catalog.published_at
from private.catalog_published_specialists_v1() as catalog;

create or replace view public.published_reviews
with (security_invoker = true, security_barrier = true)
as
select catalog.id, catalog.specialist_id, catalog.body,
       catalog.would_hire_again, catalog.created_at
from private.catalog_published_reviews_v1() as catalog;

create or replace view public.published_specialist_verification_facts
with (security_invoker = true, security_barrier = true)
as
select catalog.specialist_id, catalog.identity_checked,
       catalog.education_checked, catalog.experience_checked,
       catalog.qualifications_checked, catalog.references_checked,
       catalog.sources_checked, catalog.checked_at
from private.catalog_published_verification_facts_v1() as catalog;

create or replace view public.published_specialist_trust_badges
with (security_invoker = true, security_barrier = true)
as
select catalog.id, catalog.specialist_id, catalog.badge_id,
       catalog.source, catalog.assigned_at
from private.catalog_published_trust_badges_v1() as catalog;

revoke all on table public.published_specialists from public, anon, authenticated;
revoke all on table public.published_reviews from public, anon, authenticated;
revoke all on table public.published_specialist_verification_facts from public, anon, authenticated;
revoke all on table public.published_specialist_trust_badges from public, anon, authenticated;
grant select on table public.published_specialists to anon, authenticated;
grant select on table public.published_reviews to anon, authenticated;
grant select on table public.published_specialist_verification_facts to anon, authenticated;
grant select on table public.published_specialist_trust_badges to anon, authenticated;

-- Identity mirror: auth.users is authoritative. End users receive a fixed
-- read contract but no direct write path; future columns are closed by default.
drop policy if exists "Users update own account profile" on public.account_profiles;
revoke all on table public.account_profiles from public, anon, authenticated;
grant select (id, email, display_name, avatar_url, created_at, updated_at)
  on table public.account_profiles to authenticated;

create table if not exists private.account_profile_contract_v1 (
  ordinal_position smallint primary key,
  column_name text not null unique,
  control_class text not null check (control_class in ('AUTH_DERIVED','SYSTEM_IMMUTABLE'))
);
revoke all on table private.account_profile_contract_v1 from public, anon, authenticated;
delete from private.account_profile_contract_v1;
insert into private.account_profile_contract_v1(ordinal_position,column_name,control_class) values
  (1,'id','SYSTEM_IMMUTABLE'),
  (2,'email','AUTH_DERIVED'),
  (3,'display_name','AUTH_DERIVED'),
  (4,'avatar_url','AUTH_DERIVED'),
  (5,'created_at','SYSTEM_IMMUTABLE'),
  (6,'updated_at','SYSTEM_IMMUTABLE');

create or replace function private.assert_account_profile_contract_v1()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  actual text[];
  expected text[];
begin
  select array_agg(column_name order by ordinal_position)
    into actual
  from information_schema.columns
  where table_schema = 'public' and table_name = 'account_profiles';

  select array_agg(column_name order by ordinal_position)
    into expected
  from private.account_profile_contract_v1;

  if actual is distinct from expected then
    raise exception using errcode='55000', message='account profile contract registry mismatch';
  end if;
end;
$$;
revoke all on function private.assert_account_profile_contract_v1() from public, anon, authenticated;

create or replace function public.sync_account_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform private.assert_account_profile_contract_v1();
  insert into public.account_profiles(id,email,display_name,avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = coalesce(excluded.display_name,public.account_profiles.display_name),
      avatar_url = coalesce(excluded.avatar_url,public.account_profiles.avatar_url),
      updated_at = pg_catalog.now();
  return new;
end;
$$;

-- Narrow server-rendered moderation reads. Each primitive revalidates current
-- DB membership; the email delivery surface additionally requires signed AAL2.
create or replace function public.read_moderation_applications_v1(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  actor uuid;
  result jsonb;
begin
  actor := private.require_current_moderator();
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode='22023', message='Invalid moderation read bound';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'full_name',a.full_name,'contact',a.contact,'country',a.country,'city',a.city,
    'category_text',a.category_text,'specialization',a.specialization,
    'experience_years',a.experience_years,'profile_summary',a.profile_summary,
    'description',a.description,'help_topics',a.help_topics,'work_offers',a.work_offers,
    'services',a.services,'links',a.links,'recommendations',a.recommendations,
    'status',a.status,'internal_notes',a.internal_notes,'applicant_message',a.applicant_message,
    'created_at',a.created_at,'updated_at',a.updated_at,'resubmitted_at',a.resubmitted_at,
    'main_image_path',a.main_image_path,'gallery_paths',a.gallery_paths,'video_links',a.video_links
  ) order by a.created_at desc),'[]'::jsonb)
  into result
  from (select application.* from public.applications as application order by application.created_at desc limit p_limit) as a;
  return result;
end;
$$;

create or replace function public.read_moderation_profiles_v1(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  actor uuid;
  result jsonb;
begin
  actor := private.require_current_moderator();
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode='22023', message='Invalid moderation read bound';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'full_name',s.full_name,'slug',s.slug,'status',s.status,'city',s.city,
    'verification',(
      select jsonb_build_object(
        'identity_checked',v.identity_checked,'education_checked',v.education_checked,
        'experience_checked',v.experience_checked,'qualifications_checked',v.qualifications_checked,
        'references_checked',v.references_checked,'sources_checked',v.sources_checked
      ) from public.verifications as v where v.specialist_id=s.id limit 1
    ),
    'trust_badges',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',assignment.id,'badge_id',assignment.badge_id,'source',assignment.source,
        'assigned_at',assignment.assigned_at,
        'badge',jsonb_build_object(
          'id',badge.id,'code',badge.code,'title',badge.title,'description',badge.description,
          'icon',badge.icon,'assignment_type',badge.assignment_type,
          'is_active',badge.is_active,'sort_order',badge.sort_order
        )
      ) order by assignment.assigned_at desc)
      from public.specialist_trust_badges as assignment
      join public.trust_badges as badge on badge.id=assignment.badge_id
      where assignment.specialist_id=s.id
    ),'[]'::jsonb)
  ) order by s.updated_at desc),'[]'::jsonb)
  into result
  from (select specialist.* from public.specialists as specialist order by specialist.updated_at desc limit p_limit) as s;
  return result;
end;
$$;

create or replace function public.read_moderation_revisions_v1(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  actor uuid;
  result jsonb;
begin
  actor := private.require_current_moderator();
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode='22023', message='Invalid moderation read bound';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'owner_id',r.owner_id,'payload',r.payload,'status',r.status,
    'moderator_comment',r.moderator_comment,'created_at',r.created_at,'updated_at',r.updated_at,
    'specialist',jsonb_build_object(
      'id',s.id,'owner_id',s.owner_id,'full_name',s.full_name,'country',s.country,'city',s.city,
      'service_mode',s.service_mode,'category_id',s.category_id,
      'additional_category_ids',s.additional_category_ids,'specialization',s.specialization,
      'experience_years',s.experience_years,'profile_summary',s.profile_summary,
      'help_topics',s.help_topics,'work_offers',s.work_offers,'services',s.services,
      'short_description',s.short_description,'full_description',s.full_description,
      'public_contact',s.public_contact,'portfolio_links',s.portfolio_links,
      'video_links',s.video_links,'avatar_path',s.avatar_path,'gallery_paths',s.gallery_paths,
      'recommendations',s.recommendations
    )
  ) order by r.updated_at desc),'[]'::jsonb)
  into result
  from (select revision.* from public.specialist_revisions as revision order by revision.updated_at desc limit p_limit) as r
  join public.specialists as s on s.id=r.specialist_id;
  return result;
end;
$$;

create or replace function public.admin_read_email_delivery_v1(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  actor uuid;
  result jsonb;
begin
  actor := private.require_current_admin_aal2();
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode='22023', message='Invalid delivery read bound';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',notification.id,'event_type',notification.event_type,'status',notification.status,
    'attempts',notification.attempts,'created_at',notification.created_at,
    'sent_at',notification.sent_at,
    'error_code',case when notification.last_error is null then null else 'delivery_failed' end
  ) order by notification.created_at desc),'[]'::jsonb)
  into result
  from (select queue.* from public.email_notifications as queue order by queue.created_at desc limit p_limit) as notification;
  return result;
end;
$$;

drop policy if exists "Moderators read email notifications" on public.email_notifications;

-- Remove legacy executable defaults from every existing public function, then
-- opt in only the named browser contracts used by the application/RLS layer.
do $$
declare
  candidate record;
begin
  for candidate in
    select p.oid::regprocedure as signature
    from pg_proc as p
    join pg_namespace as namespace on namespace.oid=p.pronamespace
    where namespace.nspname='public'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated',candidate.signature);
  end loop;
end;
$$;

do $$
declare
  candidate record;
begin
  for candidate in
    select p.oid::regprocedure as signature
    from pg_proc as p
    join pg_namespace as namespace on namespace.oid=p.pronamespace
    where namespace.nspname='public'
      and p.proname = any(array[
        'is_admin','is_moderator','is_valid_help_topics','is_valid_work_offers',
        'moderator_decide_application_v2','moderator_decide_revision_v2',
        'moderate_review','moderate_complaint',
        'admin_transition_application','admin_delete_application','admin_delete_revision',
        'admin_update_specialist_controls','admin_transition_specialist',
        'admin_set_manual_trust_badges','admin_update_site_content','admin_set_moderator_role',
        'admin_upsert_category','admin_delete_category','admin_retry_email_notification',
        'read_moderation_applications_v1','read_moderation_profiles_v1',
        'read_moderation_revisions_v1','admin_read_email_delivery_v1'
      ]::name[])
  loop
    execute format('grant execute on function %s to authenticated',candidate.signature);
  end loop;
end;
$$;

-- Preserve service-only grants explicitly after default privilege removal.
grant execute on function public.read_moderation_applications_v1(integer) to service_role;
grant execute on function public.read_moderation_profiles_v1(integer) to service_role;
grant execute on function public.read_moderation_revisions_v1(integer) to service_role;
grant execute on function public.admin_read_email_delivery_v1(integer) to service_role;

-- Existing definer bodies that predate P0-09 keep compatibility while using a
-- deterministic pg_catalog-first path. CREATE on public is revoked above.
do $$
declare
  candidate record;
begin
  for candidate in
    select p.oid::regprocedure as signature
    from pg_proc as p
    join pg_namespace as namespace on namespace.oid=p.pronamespace
    where namespace.nspname in ('public','private')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig,'{}')) as setting
        where setting like 'search_path=pg_catalog%'
      )
  loop
    execute format(
      'alter function %s set search_path=pg_catalog, public, private, storage, auth, extensions',
      candidate.signature
    );
  end loop;
end;
$$;

-- The manifest makes future public views and future client-callable functions
-- fail closed until an explicit migration registers their contract.
create table if not exists private.api_surface_manifest_v1 (
  object_kind text not null check (object_kind in ('VIEW','FUNCTION')),
  object_identity text not null,
  classification text not null,
  allowed_roles text[] not null,
  primary key (object_kind,object_identity)
);
revoke all on table private.api_surface_manifest_v1 from public, anon, authenticated;
delete from private.api_surface_manifest_v1;

insert into private.api_surface_manifest_v1(object_kind,object_identity,classification,allowed_roles) values
  ('VIEW','public.owner_applications_v1','OWNER_PROJECTION',array['authenticated']),
  ('VIEW','public.published_reviews','PUBLIC_CONTRACT',array['anon','authenticated']),
  ('VIEW','public.published_specialist_trust_badges','PUBLIC_CONTRACT',array['anon','authenticated']),
  ('VIEW','public.published_specialist_verification_facts','PUBLIC_CONTRACT',array['anon','authenticated']),
  ('VIEW','public.published_specialists','PUBLIC_CONTRACT',array['anon','authenticated']);

insert into private.api_surface_manifest_v1(object_kind,object_identity,classification,allowed_roles)
select
  'FUNCTION',
  format('%I.%I(%s)',namespace.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
  case
    when namespace.nspname='private' and p.proname like 'catalog_published_%' then 'PUBLIC_PROJECTION_HELPER'
    when namespace.nspname='private' then 'RLS_HELPER'
    when p.proname like 'admin_%' then 'ADMIN_CONTRACT'
    when p.proname like 'read_moderation_%' or p.proname like 'moderator_%' or p.proname like 'moderate_%' then 'MODERATOR_CONTRACT'
    else 'AUTHENTICATED_HELPER'
  end,
  array_remove(array[
    case when has_function_privilege('anon',p.oid,'EXECUTE') then 'anon' end,
    case when has_function_privilege('authenticated',p.oid,'EXECUTE') then 'authenticated' end
  ],null)
from pg_proc as p
join pg_namespace as namespace on namespace.oid=p.pronamespace
where namespace.nspname in ('public','private')
  and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'));

create or replace function private.assert_api_surface_manifest_v1()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actual_views text[];
  expected_views text[];
  actual_functions text[];
  expected_functions text[];
begin
  select array_agg(format('%I.%I',namespace.nspname,class.relname) order by class.relname)
    into actual_views
  from pg_class as class
  join pg_namespace as namespace on namespace.oid=class.relnamespace
  where namespace.nspname='public' and class.relkind='v';

  select array_agg(object_identity order by object_identity)
    into expected_views
  from private.api_surface_manifest_v1 where object_kind='VIEW';

  select array_agg(
    format('%I.%I(%s)',namespace.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
    order by format('%I.%I(%s)',namespace.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
  )
    into actual_functions
  from pg_proc as p
  join pg_namespace as namespace on namespace.oid=p.pronamespace
  where namespace.nspname in ('public','private')
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'));

  select array_agg(object_identity order by object_identity)
    into expected_functions
  from private.api_surface_manifest_v1 where object_kind='FUNCTION';

  if actual_views is distinct from expected_views
     or actual_functions is distinct from expected_functions then
    raise exception using errcode='55000', message='API surface manifest mismatch';
  end if;
end;
$$;
revoke all on function private.assert_api_surface_manifest_v1() from public, anon, authenticated;

select private.assert_account_profile_contract_v1();
select private.assert_api_surface_manifest_v1();

comment on view public.published_specialists is
  'P0-09 explicit public catalog contract via private fixed-column definer projection and security-invoker view.';
comment on function public.admin_read_email_delivery_v1(integer) is
  'P0-09 AAL2-only minimized delivery metadata; recipient, subject, template and raw provider error are excluded.';

notify pgrst, 'reload schema';

commit;
