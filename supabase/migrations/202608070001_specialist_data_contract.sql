-- A single, backward-compatible specialist contract shared by applications,
-- first publication, owner revisions and the public profile.

create or replace function public.is_valid_help_topics(value jsonb)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case
    when value is null or jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 12 then false
    else not exists (
      select 1 from jsonb_array_elements(value) as item
      where jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item->'title') is distinct from 'string'
        or char_length(trim(item->>'title')) not between 2 and 140
        or (
          item ? 'description'
          and jsonb_typeof(item->'description') not in ('string', 'null')
        )
        or char_length(coalesce(item->>'description', '')) > 300
    )
  end;
$$;

create or replace function public.is_valid_work_offers(value jsonb, allow_legacy_mode boolean default true)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case
    when value is null or jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 12 then false
    else not exists (
      select 1 from jsonb_array_elements(value) as item
      where jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item->'title') is distinct from 'string'
        or char_length(trim(item->>'title')) not between 2 and 160
        or (item ? 'mode' and jsonb_typeof(item->'mode') not in ('string', 'null'))
        or case
          when allow_legacy_mode then coalesce(item->>'mode', '') not in ('', 'online', 'offline', 'both')
          else coalesce(item->>'mode', '') not in ('online', 'offline', 'both')
        end
        or (item ? 'duration_minutes' and jsonb_typeof(item->'duration_minutes') not in ('number', 'null'))
        or (item->>'duration_minutes' is not null and not case
          when item->>'duration_minutes' ~ '^[0-9]{1,4}$' then (item->>'duration_minutes')::integer between 1 and 1440
          else false
        end)
        or (item ? 'price' and jsonb_typeof(item->'price') not in ('number', 'null'))
        or (item->>'price' is not null and not case
          when item->>'price' ~ '^[0-9]+([.][0-9]{1,2})?$' then (item->>'price')::numeric between 0.01 and 100000000
          else false
        end)
        or (item->>'price' is not null and coalesce(item->>'currency', '') !~ '^[A-Z]{3}$')
        or (item->>'price' is null and item ? 'currency' and jsonb_typeof(item->'currency') not in ('string', 'null'))
    )
  end;
$$;

alter table public.applications
  add column if not exists contract_version smallint,
  add column if not exists profile_summary text,
  add column if not exists help_topics jsonb not null default '[]'::jsonb,
  add column if not exists work_offers jsonb not null default '[]'::jsonb;

alter table public.specialists
  add column if not exists contract_version smallint,
  add column if not exists profile_summary text,
  add column if not exists help_topics jsonb not null default '[]'::jsonb,
  add column if not exists work_offers jsonb not null default '[]'::jsonb;

-- Approved one-time legacy backfill. Help topics deliberately remain empty:
-- services and client problems are different concepts.
update public.applications set contract_version = 1 where contract_version is null;
update public.specialists set contract_version = 1 where contract_version is null;
alter table public.applications alter column contract_version set default 2;
alter table public.applications alter column contract_version set not null;
alter table public.specialists alter column contract_version set default 2;
alter table public.specialists alter column contract_version set not null;

update public.applications
set profile_summary = left(trim(description), 220)
where profile_summary is null or trim(profile_summary) = '';

update public.specialists
set profile_summary = left(trim(coalesce(nullif(short_description, ''), full_description, '')), 220)
where profile_summary is null or trim(profile_summary) = '';

update public.specialists as specialist
set work_offers = coalesce((
  select jsonb_agg(jsonb_build_object(
    'title', trim(service),
    'duration_minutes', null,
    'mode', specialist.service_mode,
    'price', null,
    'currency', null
  ) order by ordinality)
  from unnest(specialist.services) with ordinality as legacy(service, ordinality)
  where trim(service) <> ''
), '[]'::jsonb)
where work_offers = '[]'::jsonb and cardinality(services) > 0;

update public.applications as application
set work_offers = coalesce((
  select jsonb_agg(jsonb_build_object(
    'title', trim(service),
    'duration_minutes', null,
    'mode', (select specialist.service_mode from public.specialists as specialist where specialist.application_id = application.id limit 1),
    'price', null,
    'currency', null
  ) order by ordinality)
  from regexp_split_to_table(application.services, E'\\n') with ordinality as legacy(service, ordinality)
  where trim(service) <> ''
), '[]'::jsonb)
where work_offers = '[]'::jsonb and trim(services) <> '';

alter table public.applications alter column profile_summary set not null;
alter table public.specialists alter column profile_summary set not null;

alter table public.applications drop constraint if exists applications_contract_version_check;
alter table public.applications add constraint applications_contract_version_check check (contract_version in (1, 2));
alter table public.specialists drop constraint if exists specialists_contract_version_check;
alter table public.specialists add constraint specialists_contract_version_check check (contract_version in (1, 2));

alter table public.applications drop constraint if exists applications_profile_summary_check;
alter table public.applications add constraint applications_profile_summary_check check (contract_version = 1 or char_length(trim(profile_summary)) between 1 and 220) not valid;
alter table public.specialists drop constraint if exists specialists_profile_summary_check;
alter table public.specialists add constraint specialists_profile_summary_check check (contract_version = 1 or char_length(trim(profile_summary)) between 1 and 220) not valid;
alter table public.applications drop constraint if exists applications_help_topics_check;
alter table public.applications add constraint applications_help_topics_check check (public.is_valid_help_topics(help_topics) and (contract_version = 1 or jsonb_array_length(help_topics) >= 1)) not valid;
alter table public.specialists drop constraint if exists specialists_help_topics_check;
alter table public.specialists add constraint specialists_help_topics_check check (public.is_valid_help_topics(help_topics) and (contract_version = 1 or jsonb_array_length(help_topics) >= 1)) not valid;
alter table public.applications drop constraint if exists applications_work_offers_check;
alter table public.applications add constraint applications_work_offers_check check (public.is_valid_work_offers(work_offers, contract_version = 1) and (contract_version = 1 or jsonb_array_length(work_offers) >= 1)) not valid;
alter table public.specialists drop constraint if exists specialists_work_offers_check;
alter table public.specialists add constraint specialists_work_offers_check check (public.is_valid_work_offers(work_offers, contract_version = 1) and (contract_version = 1 or jsonb_array_length(work_offers) >= 1)) not valid;

-- Existing descriptions are preserved. The NOT VALID constraint protects all
-- new or edited rows without rewriting legacy content.
alter table public.applications drop constraint if exists applications_description_check;
alter table public.applications add constraint applications_description_check check (contract_version = 1 or char_length(description) between 50 and 3000) not valid;
alter table public.applications drop constraint if exists applications_services_check;
alter table public.applications add constraint applications_services_check check (char_length(services) between 2 and 3000) not valid;
alter table public.specialists drop constraint if exists specialists_full_description_check;
alter table public.specialists add constraint specialists_full_description_check check (contract_version = 1 or (full_description is not null and char_length(full_description) between 50 and 3000)) not valid;

create or replace function public.work_offer_titles(value jsonb)
returns text[] language sql immutable set search_path = pg_catalog as $$
  select coalesce(array_agg(item->>'title' order by ordinality), '{}'::text[])
  from jsonb_array_elements(coalesce(value, '[]'::jsonb)) with ordinality as offer(item, ordinality)
  where nullif(trim(item->>'title'), '') is not null;
$$;

create or replace function public.work_offer_mode(value jsonb, fallback text default 'both')
returns text language sql immutable set search_path = pg_catalog as $$
  with modes as (
    select item->>'mode' as mode
    from jsonb_array_elements(coalesce(value, '[]'::jsonb)) as offer(item)
    where item->>'mode' in ('online', 'offline', 'both')
  )
  select case
    when bool_or(mode = 'both') or count(distinct mode) > 1 then 'both'
    else coalesce(max(mode), nullif(fallback, ''), 'both')
  end
  from modes;
$$;

-- Private contact remains in applications. Existing specialists.public_contact
-- values are retained but no longer updated or exposed by the public contract.
create or replace function public.publish_approved_application(application_uuid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare app public.applications; existing_id uuid; legacy_services text[]; derived_mode text;
begin
  select * into app from public.applications where id = application_uuid;
  if not found or app.status <> 'approved' or app.owner_id is null then return; end if;
  legacy_services := public.work_offer_titles(app.work_offers);
  if cardinality(legacy_services) = 0 then legacy_services := array_remove(regexp_split_to_array(app.services, E'\\n'), ''); end if;
  derived_mode := public.work_offer_mode(app.work_offers, 'both');
  select id into existing_id from public.specialists where owner_id = app.owner_id limit 1;
  if existing_id is not null then
    update public.specialists set
      contract_version = app.contract_version,
      application_id = app.id,
      full_name = app.full_name,
      country = app.country,
      city = app.city,
      category_id = app.category_id,
      additional_category_ids = coalesce(app.additional_category_ids, '{}'),
      specialization = app.specialization,
      experience_years = app.experience_years,
      profile_summary = app.profile_summary,
      short_description = app.profile_summary,
      full_description = app.description,
      help_topics = app.help_topics,
      work_offers = app.work_offers,
      services = legacy_services,
      service_mode = derived_mode,
      portfolio_links = case when app.links is null then portfolio_links else array_remove(regexp_split_to_array(app.links, E'\\n'), '') end,
      avatar_path = coalesce(app.main_image_path, avatar_path),
      gallery_paths = case when cardinality(app.gallery_paths) = 0 then gallery_paths else app.gallery_paths end,
      video_links = case when cardinality(app.video_links) = 0 then video_links else app.video_links end,
      recommendations = coalesce(app.recommendations, recommendations),
      status = 'published',
      published_at = now(),
      updated_at = now()
    where id = existing_id;
  else
    insert into public.specialists (
      contract_version, application_id, owner_id, slug, full_name, country, city, category_id, additional_category_ids,
      specialization, experience_years, profile_summary, short_description, full_description,
      help_topics, work_offers, services, service_mode, portfolio_links, avatar_path,
      gallery_paths, video_links, recommendations, status, published_at
    ) values (
      app.contract_version, app.id, app.owner_id, 'profile-' || left(app.id::text, 8), app.full_name, app.country, app.city,
      app.category_id, coalesce(app.additional_category_ids, '{}'), app.specialization, app.experience_years,
      app.profile_summary, app.profile_summary, app.description, app.help_topics, app.work_offers,
      legacy_services, derived_mode,
      case when app.links is null then '{}' else array_remove(regexp_split_to_array(app.links, E'\\n'), '') end,
      app.main_image_path, coalesce(app.gallery_paths, '{}'), coalesce(app.video_links, '{}'),
      app.recommendations, 'published', now()
    );
  end if;
end;
$$;
revoke all on function public.publish_approved_application(uuid) from public, anon, authenticated;
grant execute on function public.publish_approved_application(uuid) to service_role;

-- The status trigger is the only browser-originated publication entry point.
-- Keep both trigger functions outside the PostgREST RPC surface.
revoke all on function public.publish_after_application_approval() from public, anon, authenticated;
grant execute on function public.publish_after_application_approval() to service_role;

-- Media paths are accepted only when the object exists and belongs to the
-- profile owner. Modern uploads and the owner-scoped legacy format are both
-- retained. A legacy path whose historical owner segment no longer matches
-- the row can only be reused when that same row owner already references it.
create or replace function public.assert_owned_profile_media_path(p_owner uuid, p_path text)
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  if p_path is null then return; end if;
  if p_owner is null then
    raise exception 'A profile image must have an owner';
  end if;

  if p_path ~ ('^submissions/' || p_owner::text || '/(avatar|gallery)/[a-f0-9-]{36}\.webp$')
     and exists (
       select 1 from storage.objects
       where bucket_id = 'profile-media' and name = p_path
     ) then
    return;
  end if;

  if p_path ~ ('^submissions/' || p_owner::text || '/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$')
     and exists (
       select 1 from storage.objects
       where bucket_id = 'profile-media' and name = p_path
     ) then
    return;
  end if;

  if (
       p_path ~ '^submissions/[a-f0-9-]{36}/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
       or p_path ~ '^submissions/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
     )
     and exists (
       select 1 from storage.objects
       where bucket_id = 'profile-media' and name = p_path
     )
     and (
       exists (
         select 1 from public.applications
         where owner_id = p_owner
           and (main_image_path = p_path or gallery_paths @> array[p_path]::text[])
       )
       or exists (
         select 1 from public.specialists
         where owner_id = p_owner
           and (avatar_path = p_path or gallery_paths @> array[p_path]::text[])
       )
       or exists (
         select 1 from public.specialist_revisions
         where owner_id = p_owner
           and (
             payload->>'avatar_path' = p_path
             or coalesce(payload->'gallery_paths', '[]'::jsonb) @> jsonb_build_array(p_path)
           )
       )
     ) then
    return;
  end if;

  raise exception 'A profile image must be an existing file owned by the profile owner';
end;
$$;
revoke all on function public.assert_owned_profile_media_path(uuid, text) from public, anon, authenticated;

create or replace function public.guard_application_media_ownership()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare p text;
begin
  if new.owner_id is null then return new; end if;
  perform public.assert_owned_profile_media_path(new.owner_id, new.main_image_path);
  foreach p in array coalesce(new.gallery_paths, '{}'::text[]) loop
    perform public.assert_owned_profile_media_path(new.owner_id, p);
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_application_media_ownership() from public, anon, authenticated;
drop trigger if exists applications_guard_media_ownership on public.applications;
create trigger applications_guard_media_ownership
before insert or update of owner_id, main_image_path, gallery_paths on public.applications
for each row execute function public.guard_application_media_ownership();

-- Version 2 revisions contain only user-provided fields. Legacy revisions stay
-- readable and may still be decided using the former payload contract.
create or replace function public.guard_specialist_revision_payload()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare element jsonb; p text; disallowed jsonb;
begin
  if jsonb_typeof(new.payload) <> 'object' then raise exception 'Revision payload must be an object'; end if;
  if new.payload->>'contract_version' = '2' then
    disallowed := new.payload - array[
      'contract_version','full_name','country','city','category_id','additional_category_ids',
      'specialization','experience_years','profile_summary','full_description','help_topics',
      'work_offers','avatar_path'
    ]::text[];
    if disallowed <> '{}'::jsonb then raise exception 'Revision contains fields outside the owner-editable contract'; end if;
    if jsonb_typeof(new.payload->'full_name') is distinct from 'string' or char_length(trim(new.payload->>'full_name')) not between 3 and 140 then raise exception 'Revision name is invalid'; end if;
    if jsonb_typeof(new.payload->'country') is distinct from 'string' or char_length(trim(new.payload->>'country')) not between 2 and 100 then raise exception 'Revision country is invalid'; end if;
    if jsonb_typeof(new.payload->'city') is distinct from 'string' or char_length(trim(new.payload->>'city')) not between 2 and 100 then raise exception 'Revision city is invalid'; end if;
    if jsonb_typeof(new.payload->'category_id') is distinct from 'string' or (new.payload->>'category_id') !~* '^[a-f0-9-]{36}$' then raise exception 'Revision category is invalid'; end if;
    if jsonb_typeof(new.payload->'additional_category_ids') is distinct from 'array' or jsonb_array_length(new.payload->'additional_category_ids') > 8 then raise exception 'Revision additional categories are invalid'; end if;
    for element in select value from jsonb_array_elements(new.payload->'additional_category_ids') loop
      if jsonb_typeof(element) <> 'string' or (element #>> '{}') !~* '^[a-f0-9-]{36}$' then raise exception 'Revision additional category is invalid'; end if;
    end loop;
    if jsonb_typeof(new.payload->'specialization') is distinct from 'string' or char_length(trim(new.payload->>'specialization')) not between 2 and 240 then raise exception 'Revision specialization is invalid'; end if;
    if jsonb_typeof(new.payload->'experience_years') is distinct from 'number' or (new.payload->>'experience_years') !~ '^(0|[1-9]|[1-7][0-9]|80)$' then raise exception 'Revision experience is invalid'; end if;
    if jsonb_typeof(new.payload->'profile_summary') is distinct from 'string' or char_length(trim(new.payload->>'profile_summary')) not between 1 and 220 then raise exception 'Revision summary is invalid'; end if;
    if jsonb_typeof(new.payload->'full_description') is distinct from 'string' or char_length(trim(new.payload->>'full_description')) not between 50 and 3000 then raise exception 'Revision description is invalid'; end if;
    if not public.is_valid_help_topics(new.payload->'help_topics') or jsonb_array_length(new.payload->'help_topics') < 1 then raise exception 'Revision help topics are invalid'; end if;
    if not public.is_valid_work_offers(new.payload->'work_offers') or jsonb_array_length(new.payload->'work_offers') < 1 then raise exception 'Revision work offers are invalid'; end if;
    if jsonb_typeof(new.payload->'avatar_path') is distinct from 'string' then raise exception 'Revision avatar path is invalid'; end if;
    perform public.assert_owned_profile_media_path(new.owner_id, nullif(new.payload->>'avatar_path', ''));
    return new;
  end if;

  -- Backward-compatible validation for already saved version 1 payloads.
  if jsonb_typeof(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) > 10 then raise exception 'Revision gallery is invalid'; end if;
  if jsonb_typeof(coalesce(new.payload->'services', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(new.payload->'services', '[]'::jsonb)) > 80 then raise exception 'Revision services are invalid'; end if;
  if new.payload ? 'avatar_path' and jsonb_typeof(new.payload->'avatar_path') not in ('string', 'null') then raise exception 'Revision avatar path is invalid'; end if;
  perform public.assert_owned_profile_media_path(new.owner_id, nullif(new.payload->>'avatar_path', ''));
  for element in select value from jsonb_array_elements(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) loop
    if jsonb_typeof(element) <> 'string' then raise exception 'Revision gallery path is invalid'; end if;
    p := trim(both '"' from element::text);
    perform public.assert_owned_profile_media_path(new.owner_id, p);
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_specialist_revision_payload() from public, anon, authenticated;
drop trigger if exists specialist_revisions_guard_payload on public.specialist_revisions;
create trigger specialist_revisions_guard_payload
before insert or update of owner_id, payload on public.specialist_revisions
for each row execute function public.guard_specialist_revision_payload();

create or replace function public.apply_specialist_revision(revision_uuid uuid, approve boolean, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.specialist_revisions; p jsonb; reviewer uuid := auth.uid(); offers jsonb; legacy_services text[];
begin
  if reviewer is null or not public.is_moderator() then raise exception 'Only moderators can decide profile revisions'; end if;
  if not approve and coalesce(length(trim(note)), 0) = 0 then raise exception 'A rejection comment is required'; end if;
  select * into r from public.specialist_revisions where id = revision_uuid for update;
  if not found then raise exception 'Revision not found'; end if;
  if r.status <> 'pending' then raise exception 'Revision has already been decided'; end if;
  p := r.payload;
  if approve and p->>'contract_version' = '2' then
    offers := p->'work_offers';
    legacy_services := public.work_offer_titles(offers);
    update public.specialists set
      contract_version = 2,
      full_name = coalesce(nullif(p->>'full_name', ''), full_name),
      country = coalesce(nullif(p->>'country', ''), country),
      city = coalesce(nullif(p->>'city', ''), city),
      category_id = case when nullif(p->>'category_id', '') is null then category_id else (p->>'category_id')::uuid end,
      additional_category_ids = coalesce(array(select jsonb_array_elements_text(coalesce(p->'additional_category_ids', '[]'::jsonb))::uuid), '{}'::uuid[]),
      specialization = nullif(p->>'specialization', ''),
      experience_years = (p->>'experience_years')::integer,
      profile_summary = p->>'profile_summary',
      short_description = p->>'profile_summary',
      full_description = p->>'full_description',
      help_topics = p->'help_topics',
      work_offers = offers,
      services = legacy_services,
      service_mode = public.work_offer_mode(offers, service_mode),
      avatar_path = p->>'avatar_path',
      status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
    where id = r.specialist_id and owner_id = r.owner_id;
  elsif approve then
    update public.specialists set
      full_name = coalesce(nullif(p->>'full_name',''), full_name),
      country = coalesce(nullif(p->>'country',''), country),
      city = coalesce(nullif(p->>'city',''), city),
      service_mode = coalesce(nullif(p->>'service_mode',''), service_mode),
      category_id = case when nullif(p->>'category_id','') is null then category_id else (p->>'category_id')::uuid end,
      additional_category_ids = coalesce(array(select jsonb_array_elements_text(coalesce(p->'additional_category_ids','[]'::jsonb))::uuid), additional_category_ids),
      specialization = coalesce(nullif(p->>'specialization',''), specialization),
      experience_years = case when nullif(p->>'experience_years','') is null then experience_years else (p->>'experience_years')::integer end,
      services = coalesce(array(select jsonb_array_elements_text(coalesce(p->'services', to_jsonb(services)))), services),
      profile_summary = coalesce(nullif(p->>'profile_summary',''), nullif(p->>'short_description',''), profile_summary),
      short_description = coalesce(nullif(p->>'short_description',''), short_description),
      full_description = coalesce(nullif(p->>'full_description',''), full_description),
      help_topics = coalesce(p->'help_topics', help_topics),
      work_offers = coalesce(p->'work_offers', work_offers),
      public_contact = coalesce(nullif(p->>'public_contact',''), public_contact),
      portfolio_links = coalesce(array(select jsonb_array_elements_text(coalesce(p->'portfolio_links', to_jsonb(portfolio_links)))), portfolio_links),
      video_links = coalesce(array(select jsonb_array_elements_text(coalesce(p->'video_links', to_jsonb(video_links)))), video_links),
      avatar_path = coalesce(nullif(p->>'avatar_path',''), avatar_path),
      gallery_paths = coalesce(array(select jsonb_array_elements_text(coalesce(p->'gallery_paths', to_jsonb(gallery_paths)))), gallery_paths),
      recommendations = coalesce(nullif(p->>'recommendations',''), recommendations),
      status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
    where id = r.specialist_id and owner_id = r.owner_id;
  end if;
  if approve and not found then raise exception 'The public profile does not belong to this revision owner'; end if;
  update public.specialist_revisions set
    status = case when approve then 'approved' else 'rejected' end,
    moderator_id = reviewer,
    moderator_comment = nullif(trim(note), ''),
    decided_at = now()
  where id = r.id;
end;
$$;
revoke all on function public.apply_specialist_revision(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.apply_specialist_revision(uuid, boolean, text) to authenticated;

-- Only owner and moderators may read the source table directly. All public
-- routes use this explicit representation, which has no contact or owner data.
drop policy if exists "Public reads published specialists" on public.specialists;
revoke all on public.specialists from anon;

create or replace view public.published_specialists
with (security_barrier = true, security_invoker = false) as
  select specialist.id,
         specialist.slug,
         specialist.full_name,
         specialist.country,
         specialist.city,
         specialist.category_id,
         category.name as category_name,
         category.slug as category_slug,
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
revoke all on public.published_specialists from public, anon, authenticated;
grant select on public.published_specialists to anon, authenticated;

-- The public review representation is read-only. Moderation continues through
-- the RLS-protected base table public.reviews.
revoke all on public.published_reviews from public, anon, authenticated;
grant select on public.published_reviews to anon, authenticated;

-- Verification facts are independent from publication. Nothing is backfilled
-- from legacy badges or verified_at timestamps because that would invent proof.
alter table public.verifications
  add column if not exists education_checked boolean not null default false,
  add column if not exists experience_checked boolean not null default false,
  add column if not exists qualifications_checked boolean not null default false,
  add column if not exists sources_checked smallint not null default 0,
  add column if not exists checked_at timestamptz;
alter table public.verifications drop constraint if exists verifications_sources_checked_check;
alter table public.verifications add constraint verifications_sources_checked_check check (sources_checked between 0 and 1000);
create unique index if not exists verifications_one_per_specialist on public.verifications(specialist_id);

drop policy if exists "Moderators read verifications" on public.verifications;
drop policy if exists "Moderators manage verifications" on public.verifications;
create policy "Moderators read verifications" on public.verifications for select to authenticated using (public.is_moderator());
create policy "Moderators manage verifications" on public.verifications for all to authenticated using (public.is_moderator()) with check (public.is_moderator());

create or replace view public.published_specialist_verification_facts
with (security_barrier = true, security_invoker = false) as
  select verification.specialist_id,
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
revoke all on public.published_specialist_verification_facts from public, anon, authenticated;
grant select on public.published_specialist_verification_facts to anon, authenticated;

-- Publication alone is not verification. Keep existing assignments for audit
-- history, but stop creating new ones and omit the legacy `verified` badge
-- from the public badge representation. The Trust Mark now comes from facts.
drop trigger if exists specialists_sync_verified_badge on public.specialists;
create or replace view public.published_specialist_trust_badges
with (security_barrier = true, security_invoker = false) as
  select assignment.id, assignment.specialist_id, assignment.badge_id,
         assignment.source, assignment.assigned_at
  from public.specialist_trust_badges as assignment
  join public.specialists as specialist on specialist.id = assignment.specialist_id
  join public.trust_badges as badge on badge.id = assignment.badge_id
  where specialist.status = 'published'
    and badge.is_active = true
    and badge.code <> 'verified';
revoke all on public.published_specialist_trust_badges from public, anon, authenticated;
grant select on public.published_specialist_trust_badges to anon, authenticated;

notify pgrst, 'reload schema';
