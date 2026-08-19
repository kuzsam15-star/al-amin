-- SEC-001 legacy contract compatibility forward fix.
--
-- Phase A registers canonical provenance before updating a published reference.
-- Historical approved applications may still use contract_version=1. The
-- historical content guard correctly blocks general edits to those rows, but it
-- also blocked the reviewed Phase-A backfill even when only media references
-- changed. This migration admits only that exact, provenance-backed transition.

begin;

do $$
declare
  guard_oid oid;
  already_applied boolean;
  phase_b_present boolean;
  guard_definition text;
begin
  if to_regclass('private.published_media_assets') is null
     or to_regprocedure('public.backfill_canonical_published_media(text,uuid,text,text[],jsonb,jsonb)') is null then
    raise exception using errcode = '55000', message = 'SEC-001 Phase A must precede the legacy contract forward fix';
  end if;

  select p.oid, pg_get_functiondef(p.oid)
  into guard_oid, guard_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'require_application_contract_v2_on_content_write'
    and oidvectortypes(p.proargtypes) = '';

  if guard_oid is null then
    raise exception using errcode = '55000', message = 'Historical application contract guard is missing';
  end if;

  already_applied := coalesce(
    obj_description(guard_oid, 'pg_proc') = 'AL-AMIN SEC-001 legacy canonical backfill compatibility v1',
    false
  );

  select exists (
    select 1
    from pg_constraint
    where conname in (
      'applications_approved_media_canonical',
      'specialists_published_media_canonical'
    )
      and convalidated
  ) into phase_b_present;

  if phase_b_present and not already_applied then
    raise exception using errcode = '55000', message = 'SEC-001 legacy contract forward fix must precede Phase B';
  end if;

  if not already_applied and position(
    'Changed application content must use contract version 2' in guard_definition
  ) = 0 then
    raise exception using errcode = '55000', message = 'Historical application contract guard drift requires review';
  end if;
end;
$$;

create or replace function private.is_sec001_legacy_application_canonical_backfill(
  old_application public.applications,
  new_application public.applications
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  old_path text;
  new_path text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role'
     or old_application.id is distinct from new_application.id
     or old_application.owner_id is null
     or old_application.owner_id is distinct from new_application.owner_id
     or old_application.status is distinct from 'approved'
     or new_application.status is distinct from 'approved'
     or old_application.contract_version is distinct from new_application.contract_version
     or new_application.contract_version is not distinct from 2
     or (
       to_jsonb(new_application) - array['main_image_path', 'gallery_paths', 'updated_at']::text[]
       is distinct from
       to_jsonb(old_application) - array['main_image_path', 'gallery_paths', 'updated_at']::text[]
     )
     or (
       old_application.main_image_path is not distinct from new_application.main_image_path
       and old_application.gallery_paths is not distinct from new_application.gallery_paths
     ) then
    return false;
  end if;

  if (old_application.main_image_path is null) <> (new_application.main_image_path is null) then
    return false;
  end if;

  if old_application.main_image_path is not null then
    if old_application.main_image_path is distinct from new_application.main_image_path
       and old_application.main_image_path like 'published/%' then
      return false;
    end if;

    if new_application.main_image_path not like (
      'published/' || new_application.owner_id::text || '/backfill-applications/' || new_application.id::text || '/%'
    ) or not exists (
      select 1
      from private.published_media_assets asset
      where asset.owner_id = new_application.owner_id
        and asset.source_entity_type = 'backfill-applications'
        and asset.source_entity_id = new_application.id
        and asset.slot = 'avatar'
        and asset.canonical_path = new_application.main_image_path
        and asset.retired_at is null
        and (
          old_application.main_image_path is not distinct from new_application.main_image_path
          or asset.source_path = old_application.main_image_path
        )
    ) then
      return false;
    end if;
  end if;

  if cardinality(coalesce(old_application.gallery_paths, '{}'::text[]))
     is distinct from cardinality(coalesce(new_application.gallery_paths, '{}'::text[])) then
    return false;
  end if;

  for position_index in 1..cardinality(coalesce(new_application.gallery_paths, '{}'::text[])) loop
    old_path := old_application.gallery_paths[position_index];
    new_path := new_application.gallery_paths[position_index];

    if old_path is null or new_path is null then
      return false;
    end if;
    if old_path is distinct from new_path and old_path like 'published/%' then
      return false;
    end if;
    if new_path not like (
      'published/' || new_application.owner_id::text || '/backfill-applications/' || new_application.id::text || '/%'
    ) or not exists (
      select 1
      from private.published_media_assets asset
      where asset.owner_id = new_application.owner_id
        and asset.source_entity_type = 'backfill-applications'
        and asset.source_entity_id = new_application.id
        and asset.slot = 'gallery-' || (position_index - 1)::text
        and asset.canonical_path = new_path
        and asset.retired_at is null
        and (old_path is not distinct from new_path or asset.source_path = old_path)
    ) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.is_sec001_legacy_application_canonical_backfill(
  public.applications,
  public.applications
) from public, anon, authenticated, service_role;

create or replace function public.require_application_contract_v2_on_content_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.contract_version is distinct from 2 then
      raise exception 'New applications must use contract version 2';
    end if;
    return new;
  end if;

  if new.contract_version is distinct from old.contract_version
     and new.contract_version is distinct from 2 then
    raise exception 'Changed application contract version must be 2';
  end if;

  if row(
    new.full_name, new.contact, new.country, new.city, new.category_text,
    new.category_id, new.additional_category_ids, new.specialization,
    new.experience_years, new.profile_summary, new.description,
    new.help_topics, new.work_offers, new.services, new.links,
    new.recommendations, new.main_image_path, new.gallery_paths,
    new.video_links, new.consent_truthful, new.consent_personal_data
  ) is distinct from row(
    old.full_name, old.contact, old.country, old.city, old.category_text,
    old.category_id, old.additional_category_ids, old.specialization,
    old.experience_years, old.profile_summary, old.description,
    old.help_topics, old.work_offers, old.services, old.links,
    old.recommendations, old.main_image_path, old.gallery_paths,
    old.video_links, old.consent_truthful, old.consent_personal_data
  ) and new.contract_version is distinct from 2 then
    -- Keep the private predicate in a nested PL/pgSQL branch. PostgreSQL may
    -- reorder a single SQL boolean expression and would otherwise attempt this
    -- deliberately non-client-callable helper for ordinary contract-v2 writes.
    if not private.is_sec001_legacy_application_canonical_backfill(old, new) then
      raise exception 'Changed application content must use contract version 2';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.require_application_contract_v2_on_content_write() is
  'AL-AMIN SEC-001 legacy canonical backfill compatibility v1';

revoke all on function public.require_application_contract_v2_on_content_write()
  from public, anon, authenticated, service_role;

do $$
declare
  helper_oid oid;
  guard_oid oid;
begin
  helper_oid := to_regprocedure(
    'private.is_sec001_legacy_application_canonical_backfill(public.applications,public.applications)'
  );
  guard_oid := to_regprocedure('public.require_application_contract_v2_on_content_write()');

  if helper_oid is null or guard_oid is null
     or not (select prosecdef from pg_proc where oid = helper_oid)
     or coalesce((select proconfig = array['search_path=pg_catalog'] from pg_proc where oid = helper_oid), false) is not true
     or has_function_privilege('anon', helper_oid, 'EXECUTE')
     or has_function_privilege('authenticated', helper_oid, 'EXECUTE')
     or has_function_privilege('service_role', helper_oid, 'EXECUTE')
     or has_function_privilege('anon', guard_oid, 'EXECUTE')
     or has_function_privilege('authenticated', guard_oid, 'EXECUTE')
     or has_function_privilege('service_role', guard_oid, 'EXECUTE')
     or obj_description(guard_oid, 'pg_proc') is distinct from 'AL-AMIN SEC-001 legacy canonical backfill compatibility v1'
     or not exists (
       select 1 from pg_trigger
       where tgname = 'applications_require_contract_v2_on_content_write'
         and tgrelid = 'public.applications'::regclass
         and not tgisinternal
     ) then
    raise exception using errcode = '55000', message = 'SEC-001 legacy contract forward fix verification failed';
  end if;
end;
$$;

commit;
