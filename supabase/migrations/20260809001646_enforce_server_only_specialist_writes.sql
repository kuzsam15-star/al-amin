-- User-originated specialist data writes are accepted only by authenticated
-- Next.js server handlers. The browser keeps owner SELECT access, while the
-- service_role performs validated writes after the server proves ownership.

-- Remove every public Data API write grant. Revoking PUBLIC as well as the two
-- API roles prevents an inherited privilege from keeping the endpoint writable.
revoke insert, update, delete on table public.applications
  from public, anon, authenticated;
revoke insert, update, delete on table public.specialist_revisions
  from public, anon, authenticated;

-- Owner SELECT policies remain intact for Cabinet/Application reads. Owner
-- write policies are removed so an accidental future table GRANT alone cannot
-- reopen the bypass.
drop policy if exists "Authenticated owners submit applications" on public.applications;
drop policy if exists "Authenticated users submit their own applications" on public.applications;
drop policy if exists "Anonymous users submit unowned applications" on public.applications;
drop policy if exists "Anyone submits application" on public.applications;
drop policy if exists "Owners update own applications" on public.applications;

drop policy if exists "Owners create own revisions" on public.specialist_revisions;
drop policy if exists "Owners update pending revisions" on public.specialist_revisions;

-- Defense in depth for internal/service-role code: old v1 rows remain readable
-- and status-only moderation updates remain possible, but every new row and
-- every update of applicant-controlled content must use contract version 2.
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
    raise exception 'Changed application content must use contract version 2';
  end if;

  return new;
end;
$$;
revoke all on function public.require_application_contract_v2_on_content_write()
  from public, anon, authenticated;
drop trigger if exists applications_require_contract_v2_on_content_write
  on public.applications;
create trigger applications_require_contract_v2_on_content_write
before insert or update on public.applications
for each row execute function public.require_application_contract_v2_on_content_write();

create or replace function public.require_revision_contract_v2_on_payload_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if jsonb_typeof(new.payload) is distinct from 'object'
       or new.payload->>'contract_version' is distinct from '2' then
      raise exception 'New revision payloads must use contract version 2';
    end if;
  elsif new.payload is distinct from old.payload then
    if jsonb_typeof(new.payload) is distinct from 'object'
       or new.payload->>'contract_version' is distinct from '2' then
      raise exception 'Changed revision payloads must use contract version 2';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.require_revision_contract_v2_on_payload_write()
  from public, anon, authenticated;
drop trigger if exists specialist_revisions_require_contract_v2_on_payload_write
  on public.specialist_revisions;
create trigger specialist_revisions_require_contract_v2_on_payload_write
before insert or update of payload on public.specialist_revisions
for each row execute function public.require_revision_contract_v2_on_payload_write();
