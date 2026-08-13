begin;

-- SEC-002: RLS filters rows, not columns. Remove the broad client SELECT
-- privilege before exposing a stable owner contract.
revoke select on table public.applications from public, anon, authenticated;

-- A security-invoker view evaluates the existing owner/moderator RLS policies
-- as the caller, so authenticated needs only these exact underlying columns.
-- Omitted and future columns remain inaccessible by default.
grant select (
  id,
  full_name,
  contact,
  country,
  city,
  category_id,
  additional_category_ids,
  specialization,
  experience_years,
  profile_summary,
  description,
  help_topics,
  work_offers,
  main_image_path,
  gallery_paths,
  status,
  applicant_message,
  created_at,
  updated_at,
  resubmitted_at
) on table public.applications to authenticated;

create or replace view public.owner_applications_v1
with (security_invoker = true, security_barrier = true)
as
select
  id,
  full_name,
  contact,
  country,
  city,
  category_id,
  additional_category_ids,
  specialization,
  experience_years,
  profile_summary,
  description,
  help_topics,
  work_offers,
  main_image_path,
  gallery_paths,
  status,
  applicant_message,
  created_at,
  updated_at,
  resubmitted_at
from public.applications;

revoke all on table public.owner_applications_v1
  from public, anon, authenticated;
grant select on table public.owner_applications_v1 to authenticated;

comment on view public.owner_applications_v1 is
  'SEC-002 owner-facing application projection v1; explicit allowlist; security invoker; future columns denied by default.';

-- Preserve the existing positive owner event path without re-granting
-- applications.owner_id. The view's caller RLS proves ownership, while this
-- policy continues to exclude internal events.
drop policy if exists "Owners read own application events"
  on public.application_events;
create policy "Owners read own application events"
on public.application_events
for select
to authenticated
using (
  not is_internal
  and exists (
    select 1
    from public.owner_applications_v1 owner_application
    where owner_application.id = application_id
  )
);

-- Fail closed if a platform/default-ACL difference leaves the unsafe surface
-- reachable or changes the intended view security mode.
do $$
declare
  actual_columns text[];
  expected_columns constant text[] := array[
    'id',
    'full_name',
    'contact',
    'country',
    'city',
    'category_id',
    'additional_category_ids',
    'specialization',
    'experience_years',
    'profile_summary',
    'description',
    'help_topics',
    'work_offers',
    'main_image_path',
    'gallery_paths',
    'status',
    'applicant_message',
    'created_at',
    'updated_at',
    'resubmitted_at'
  ]::text[];
begin
  if has_table_privilege('authenticated', 'public.applications', 'SELECT') then
    raise exception 'SEC-002: authenticated retains broad applications SELECT';
  end if;

  if has_column_privilege('authenticated', 'public.applications', 'internal_notes', 'SELECT')
     or has_column_privilege('authenticated', 'public.applications', 'call_at', 'SELECT')
     or has_column_privilege('authenticated', 'public.applications', 'owner_id', 'SELECT') then
    raise exception 'SEC-002: a protected applications column remains selectable';
  end if;

  if not has_column_privilege('authenticated', 'public.applications', 'id', 'SELECT')
     or not has_table_privilege('authenticated', 'public.owner_applications_v1', 'SELECT')
     or has_table_privilege('anon', 'public.owner_applications_v1', 'SELECT') then
    raise exception 'SEC-002: owner projection grants do not match the reviewed contract';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'owner_applications_v1'
      and c.relkind = 'v'
      and coalesce('security_invoker=true' = any(c.reloptions), false)
      and coalesce('security_barrier=true' = any(c.reloptions), false)
  ) then
    raise exception 'SEC-002: owner projection is not a security-invoker barrier view';
  end if;

  select array_agg(column_name order by ordinal_position)
  into actual_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'owner_applications_v1';

  if actual_columns is distinct from expected_columns then
    raise exception 'SEC-002: owner projection column contract mismatch';
  end if;
end;
$$;

commit;
