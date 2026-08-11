begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table if not exists private.published_media_assets (
  canonical_path text primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  specialist_id uuid references public.specialists(id) on delete restrict,
  source_entity_type text not null check (source_entity_type in ('applications', 'revisions')),
  source_entity_id uuid not null,
  slot text not null check (slot = 'avatar' or slot ~ '^gallery-[0-9]{1,2}$'),
  source_path text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_sha256 text not null check (canonical_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_bytes bigint not null check (canonical_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create unique index if not exists published_media_assets_entity_slot_hash_idx
  on private.published_media_assets(source_entity_type, source_entity_id, slot, canonical_sha256);
revoke all on private.published_media_assets from public, anon, authenticated;

create or replace function private.is_canonical_profile_media_path(p_owner uuid, p_path text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select p_path ~ (
    '^published/' || p_owner::text || '/(applications|revisions)/' ||
    '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' ||
    '(avatar|gallery-[0-9]{1,2})/[0-9a-f]{64}\.webp$'
  );
$$;
revoke all on function private.is_canonical_profile_media_path(uuid, text) from public, anon, authenticated;
grant execute on function private.is_canonical_profile_media_path(uuid, text) to authenticated, service_role;

create or replace function private.is_canonical_profile_media_path(p_path text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select p_path ~ (
    '^published/[0-9a-f-]{36}/(applications|revisions)/' ||
    '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' ||
    '(avatar|gallery-[0-9]{1,2})/[0-9a-f]{64}\.webp$'
  );
$$;
revoke all on function private.is_canonical_profile_media_path(text) from public, anon, authenticated;
grant execute on function private.is_canonical_profile_media_path(text) to authenticated, service_role;

create or replace function private.all_canonical_profile_media_paths(p_owner uuid, p_paths text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select not exists (
    select 1
    from unnest(coalesce(p_paths, '{}'::text[])) as candidate(path)
    where not private.is_canonical_profile_media_path(p_owner, candidate.path)
  );
$$;
revoke all on function private.all_canonical_profile_media_paths(uuid, text[]) from public, anon, authenticated;
grant execute on function private.all_canonical_profile_media_paths(uuid, text[]) to authenticated, service_role;

create or replace function private.owner_may_delete_profile_submission(p_owner uuid, p_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p_owner is not null
    and p_path ~ ('^submissions/' || p_owner::text || '/.+')
    and not exists (
      select 1 from public.applications a
      where a.owner_id = p_owner
        and (a.main_image_path = p_path or a.gallery_paths @> array[p_path]::text[])
    )
    and not exists (
      select 1 from public.specialists s
      where s.owner_id = p_owner
        and (s.avatar_path = p_path or s.gallery_paths @> array[p_path]::text[])
    )
    and not exists (
      select 1 from public.specialist_revisions r
      where r.owner_id = p_owner
        and (
          r.payload->>'avatar_path' = p_path
          or coalesce(r.payload->'gallery_paths', '[]'::jsonb) @> jsonb_build_array(p_path)
        )
    );
$$;
revoke all on function private.owner_may_delete_profile_submission(uuid, text) from public, anon;
grant execute on function private.owner_may_delete_profile_submission(uuid, text) to authenticated;

drop policy if exists "Owners update own submission media" on storage.objects;
drop policy if exists "Owners upload own submission media" on storage.objects;
drop policy if exists "Owners delete own submission media" on storage.objects;
create policy "Owners upload unique submission media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-media'
  and name ~ (
    '^submissions/' || auth.uid()::text ||
    '/(avatar|gallery)/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webp|png|jpe?g)$'
  )
);
create policy "Owners delete unreferenced submission media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = 'submissions'
  and (storage.foldername(name))[2] = auth.uid()::text
  and private.owner_may_delete_profile_submission(auth.uid(), name)
);

create or replace function public.assert_owned_profile_media_path(p_owner uuid, p_path text)
returns void language plpgsql security definer set search_path = pg_catalog, public, private, storage as $$
begin
  if p_path is null then return; end if;
  if p_owner is null then raise exception 'A profile image must have an owner'; end if;

  if private.is_canonical_profile_media_path(p_owner, p_path)
     and exists (
       select 1 from private.published_media_assets asset
       where asset.owner_id = p_owner and asset.canonical_path = p_path and asset.retired_at is null
     ) then
    return;
  end if;

  if p_path ~ ('^submissions/' || p_owner::text || '/(avatar|gallery)/[a-f0-9-]{36}\.webp$')
     and exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = p_path) then
    return;
  end if;

  if p_path ~ ('^submissions/' || p_owner::text || '/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$')
     and exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = p_path) then
    return;
  end if;

  if (
       p_path ~ '^submissions/[a-f0-9-]{36}/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
       or p_path ~ '^submissions/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
     )
     and exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = p_path)
     and (
       exists (select 1 from public.applications where owner_id = p_owner and (main_image_path = p_path or gallery_paths @> array[p_path]::text[]))
       or exists (select 1 from public.specialists where owner_id = p_owner and (avatar_path = p_path or gallery_paths @> array[p_path]::text[]))
       or exists (
         select 1 from public.specialist_revisions
         where owner_id = p_owner
           and (payload->>'avatar_path' = p_path or coalesce(payload->'gallery_paths', '[]'::jsonb) @> jsonb_build_array(p_path))
       )
     ) then
    return;
  end if;

  raise exception 'A profile image must be an existing file owned by the profile owner';
end;
$$;
revoke all on function public.assert_owned_profile_media_path(uuid, text) from public, anon, authenticated;

create or replace function private.assert_canonical_media_descriptor(
  p_owner uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_slot text,
  p_expected_source text,
  p_descriptor jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  canonical_path text := p_descriptor->>'canonical_path';
  canonical_sha text := lower(p_descriptor->>'canonical_sha256');
  source_sha text := lower(p_descriptor->>'source_sha256');
  byte_text text := p_descriptor->>'canonical_bytes';
  byte_count bigint;
  expected_path text;
begin
  if jsonb_typeof(p_descriptor) is distinct from 'object' then raise exception 'Canonical media descriptor is required'; end if;
  if p_entity_type not in ('applications', 'revisions') then raise exception 'Canonical media entity is invalid'; end if;
  if p_slot <> 'avatar' and p_slot !~ '^gallery-[0-9]{1,2}$' then raise exception 'Canonical media slot is invalid'; end if;
  if p_descriptor->>'source_path' is distinct from p_expected_source then raise exception 'Canonical media source changed after review'; end if;
  if canonical_sha !~ '^[0-9a-f]{64}$' or source_sha !~ '^[0-9a-f]{64}$' then raise exception 'Canonical media hash is invalid'; end if;
  if byte_text !~ '^[0-9]+$' then raise exception 'Canonical media size is invalid'; end if;
  byte_count := byte_text::bigint;
  if byte_count not between 1 and 5242880 then raise exception 'Canonical media size is invalid'; end if;
  expected_path := format('published/%s/%s/%s/%s/%s.webp', p_owner, p_entity_type, p_entity_id, p_slot, canonical_sha);
  if canonical_path is distinct from expected_path then raise exception 'Canonical media path is not server-derived'; end if;
  if not exists (select 1 from storage.objects where bucket_id='profile-media' and name=p_expected_source) then raise exception 'Reviewed source media is unavailable'; end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id='profile-media' and name=canonical_path
      and coalesce(metadata->>'mimetype','')='image/webp'
      and coalesce(metadata->>'size','0')::bigint=byte_count
  ) then raise exception 'Canonical media object is unavailable or inconsistent'; end if;
end;
$$;
revoke all on function private.assert_canonical_media_descriptor(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function private.register_canonical_media_descriptor(
  p_owner uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_slot text,
  p_expected_source text,
  p_descriptor jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  path_value text := p_descriptor->>'canonical_path';
begin
  perform private.assert_canonical_media_descriptor(p_owner, p_entity_type, p_entity_id, p_slot, p_expected_source, p_descriptor);
  insert into private.published_media_assets (
    canonical_path, owner_id, source_entity_type, source_entity_id, slot,
    source_path, source_sha256, canonical_sha256, canonical_bytes
  ) values (
    path_value, p_owner, p_entity_type, p_entity_id, p_slot,
    p_expected_source, lower(p_descriptor->>'source_sha256'),
    lower(p_descriptor->>'canonical_sha256'), (p_descriptor->>'canonical_bytes')::bigint
  ) on conflict (canonical_path) do nothing;

  if not exists (
    select 1 from private.published_media_assets asset
    where asset.canonical_path=path_value and asset.owner_id=p_owner
      and asset.source_entity_type=p_entity_type and asset.source_entity_id=p_entity_id
      and asset.slot=p_slot and asset.source_path=p_expected_source
      and asset.source_sha256=lower(p_descriptor->>'source_sha256')
      and asset.canonical_sha256=lower(p_descriptor->>'canonical_sha256')
      and asset.canonical_bytes=(p_descriptor->>'canonical_bytes')::bigint
  ) then raise exception 'Canonical media retry conflicts with existing provenance'; end if;
  return path_value;
end;
$$;
revoke all on function private.register_canonical_media_descriptor(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function private.guard_approved_application_media()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare path_value text;
begin
  if new.status = 'approved'
     and (tg_op='INSERT' or old.status is distinct from new.status or old.main_image_path is distinct from new.main_image_path or old.gallery_paths is distinct from new.gallery_paths) then
    if auth.role() is distinct from 'service_role' then
      raise exception 'Approved application media can only be published by the controlled backend';
    end if;
    if new.owner_id is null or (new.main_image_path is not null and not private.is_canonical_profile_media_path(new.owner_id, new.main_image_path)) then
      raise exception 'Approved application media must use the canonical published namespace';
    end if;
    if new.main_image_path is not null and not exists (
      select 1 from private.published_media_assets asset
      where asset.owner_id=new.owner_id and asset.canonical_path=new.main_image_path
        and asset.source_entity_type='applications' and asset.source_entity_id=new.id
        and asset.retired_at is null
    ) then raise exception 'Approved application media must have registered provenance'; end if;
    foreach path_value in array coalesce(new.gallery_paths, '{}'::text[]) loop
      if not private.is_canonical_profile_media_path(new.owner_id, path_value) then raise exception 'Approved application gallery must use the canonical published namespace'; end if;
      if not exists (
        select 1 from private.published_media_assets asset
        where asset.owner_id=new.owner_id and asset.canonical_path=path_value
          and asset.source_entity_type='applications' and asset.source_entity_id=new.id
          and asset.retired_at is null
      ) then raise exception 'Approved application gallery must have registered provenance'; end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_approved_application_media() from public, anon, authenticated;
drop trigger if exists applications_guard_approved_canonical_media on public.applications;
create trigger applications_guard_approved_canonical_media
before insert or update of status, owner_id, main_image_path, gallery_paths on public.applications
for each row execute function private.guard_approved_application_media();

create or replace function private.guard_published_specialist_media()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare path_value text;
begin
  if new.status = 'published'
     and (tg_op='INSERT' or old.status is distinct from new.status or old.avatar_path is distinct from new.avatar_path or old.gallery_paths is distinct from new.gallery_paths) then
    if auth.role() is distinct from 'service_role' then
      raise exception 'Published specialist media can only be changed by the controlled backend';
    end if;
    if new.owner_id is null or (new.avatar_path is not null and not private.is_canonical_profile_media_path(new.owner_id, new.avatar_path)) then
      raise exception 'Published specialist media must use the canonical published namespace';
    end if;
    if new.avatar_path is not null and not exists (
      select 1 from private.published_media_assets asset
      where asset.owner_id=new.owner_id and asset.canonical_path=new.avatar_path
        and asset.retired_at is null
    ) then raise exception 'Published specialist media must have registered provenance'; end if;
    foreach path_value in array coalesce(new.gallery_paths, '{}'::text[]) loop
      if not private.is_canonical_profile_media_path(new.owner_id, path_value) then raise exception 'Published specialist gallery must use the canonical published namespace'; end if;
      if not exists (
        select 1 from private.published_media_assets asset
        where asset.owner_id=new.owner_id and asset.canonical_path=path_value
          and asset.retired_at is null
      ) then raise exception 'Published specialist gallery must have registered provenance'; end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_published_specialist_media() from public, anon, authenticated;
drop trigger if exists specialists_guard_published_canonical_media on public.specialists;
create trigger specialists_guard_published_canonical_media
before insert or update of status, avatar_path, gallery_paths on public.specialists
for each row execute function private.guard_published_specialist_media();

create or replace function public.approve_application_with_canonical_media(
  application_uuid uuid,
  reviewer_uuid uuid,
  note text,
  avatar_descriptor jsonb,
  gallery_descriptors jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  app public.applications;
  canonical_gallery_paths text[] := '{}'::text[];
  item jsonb;
  position integer := 0;
  specialist_uuid uuid;
  avatar_path text;
begin
  if not exists (select 1 from public.moderators where user_id=reviewer_uuid) then raise exception 'Only a moderator can approve an application'; end if;
  select * into app from public.applications where id=application_uuid for update;
  if not found or app.owner_id is null or app.status in ('approved','withdrawn') then raise exception 'Application is not approvable'; end if;
  avatar_path := private.register_canonical_media_descriptor(app.owner_id, 'applications', app.id, 'avatar', app.main_image_path, avatar_descriptor);
  if jsonb_typeof(coalesce(gallery_descriptors, '[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(gallery_descriptors, '[]'::jsonb)) <> cardinality(coalesce(app.gallery_paths, '{}'::text[])) then
    raise exception 'Canonical gallery does not match the reviewed application';
  end if;
  for item in select value from jsonb_array_elements(coalesce(gallery_descriptors, '[]'::jsonb)) loop
    canonical_gallery_paths := canonical_gallery_paths || private.register_canonical_media_descriptor(
      app.owner_id, 'applications', app.id, 'gallery-' || position::text,
      app.gallery_paths[position + 1], item
    );
    position := position + 1;
  end loop;

  update public.applications set
    main_image_path=avatar_path,
    gallery_paths=canonical_gallery_paths,
    status='approved',
    internal_notes=nullif(trim(note),''),
    applicant_message=null
  where id=app.id;

  select id into specialist_uuid from public.specialists where owner_id=app.owner_id limit 1;
  update private.published_media_assets set specialist_id=specialist_uuid
  where source_entity_type='applications' and source_entity_id=app.id and specialist_id is null;
end;
$$;
revoke all on function public.approve_application_with_canonical_media(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.approve_application_with_canonical_media(uuid, uuid, text, jsonb, jsonb) to service_role;

create or replace function public.apply_specialist_revision(revision_uuid uuid, approve boolean, note text default null)
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  r public.specialist_revisions;
  p jsonb;
  reviewer uuid := auth.uid();
  offers jsonb;
  legacy_services text[];
  current_profile public.specialists;
begin
  if reviewer is null or not public.is_moderator() then raise exception 'Only moderators can decide profile revisions'; end if;
  if not approve and coalesce(length(trim(note)), 0) = 0 then raise exception 'A rejection comment is required'; end if;
  select * into r from public.specialist_revisions where id=revision_uuid for update;
  if not found then raise exception 'Revision not found'; end if;
  if r.status <> 'pending' then raise exception 'Revision has already been decided'; end if;
  select * into current_profile from public.specialists where id=r.specialist_id and owner_id=r.owner_id for update;
  if not found then raise exception 'The public profile does not belong to this revision owner'; end if;
  p := r.payload;

  if approve and (
    nullif(p->>'avatar_path','') is distinct from current_profile.avatar_path
    or (p ? 'gallery_paths' and array(select jsonb_array_elements_text(coalesce(p->'gallery_paths','[]'::jsonb))) is distinct from current_profile.gallery_paths)
  ) then
    raise exception 'Canonical server publication required for changed media';
  end if;

  if approve and p->>'contract_version'='2' then
    offers := p->'work_offers';
    legacy_services := public.work_offer_titles(offers);
    update public.specialists set
      contract_version=2, full_name=coalesce(nullif(p->>'full_name',''),full_name),
      country=coalesce(nullif(p->>'country',''),country), city=coalesce(nullif(p->>'city',''),city),
      category_id=case when nullif(p->>'category_id','') is null then category_id else (p->>'category_id')::uuid end,
      additional_category_ids=coalesce(array(select jsonb_array_elements_text(coalesce(p->'additional_category_ids','[]'::jsonb))::uuid),'{}'::uuid[]),
      specialization=nullif(p->>'specialization',''), experience_years=(p->>'experience_years')::integer,
      profile_summary=p->>'profile_summary', short_description=p->>'profile_summary', full_description=p->>'full_description',
      help_topics=p->'help_topics', work_offers=offers, services=legacy_services,
      service_mode=public.work_offer_mode(offers,service_mode), avatar_path=p->>'avatar_path',
      status='published', published_at=coalesce(published_at,now()), updated_at=now()
    where id=r.specialist_id and owner_id=r.owner_id;
  elsif approve then
    update public.specialists set
      full_name=coalesce(nullif(p->>'full_name',''),full_name), country=coalesce(nullif(p->>'country',''),country),
      city=coalesce(nullif(p->>'city',''),city), service_mode=coalesce(nullif(p->>'service_mode',''),service_mode),
      category_id=case when nullif(p->>'category_id','') is null then category_id else (p->>'category_id')::uuid end,
      additional_category_ids=coalesce(array(select jsonb_array_elements_text(coalesce(p->'additional_category_ids',to_jsonb(additional_category_ids)))::uuid),additional_category_ids),
      specialization=coalesce(nullif(p->>'specialization',''),specialization),
      experience_years=case when nullif(p->>'experience_years','') is null then experience_years else (p->>'experience_years')::integer end,
      services=coalesce(array(select jsonb_array_elements_text(coalesce(p->'services',to_jsonb(services)))),services),
      profile_summary=coalesce(nullif(p->>'profile_summary',''),nullif(p->>'short_description',''),profile_summary),
      short_description=coalesce(nullif(p->>'short_description',''),short_description),
      full_description=coalesce(nullif(p->>'full_description',''),full_description),
      help_topics=coalesce(p->'help_topics',help_topics), work_offers=coalesce(p->'work_offers',work_offers),
      public_contact=coalesce(nullif(p->>'public_contact',''),public_contact),
      portfolio_links=coalesce(array(select jsonb_array_elements_text(coalesce(p->'portfolio_links',to_jsonb(portfolio_links)))),portfolio_links),
      video_links=coalesce(array(select jsonb_array_elements_text(coalesce(p->'video_links',to_jsonb(video_links)))),video_links),
      avatar_path=coalesce(nullif(p->>'avatar_path',''),avatar_path),
      gallery_paths=coalesce(array(select jsonb_array_elements_text(coalesce(p->'gallery_paths',to_jsonb(gallery_paths)))),gallery_paths),
      recommendations=coalesce(nullif(p->>'recommendations',''),recommendations),
      status='published', published_at=coalesce(published_at,now()), updated_at=now()
    where id=r.specialist_id and owner_id=r.owner_id;
  end if;

  update public.specialist_revisions set
    status=case when approve then 'approved' else 'rejected' end,
    moderator_id=reviewer, moderator_comment=nullif(trim(note),''), decided_at=now()
  where id=r.id;
end;
$$;
revoke all on function public.apply_specialist_revision(uuid, boolean, text) from public, anon;
grant execute on function public.apply_specialist_revision(uuid, boolean, text) to authenticated;

create or replace function public.apply_specialist_revision_with_canonical_media(
  revision_uuid uuid,
  reviewer_uuid uuid,
  note text,
  avatar_descriptor jsonb,
  gallery_descriptors jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.specialist_revisions;
  p jsonb;
  canonical_avatar_path text;
  canonical_gallery_paths text[] := '{}'::text[];
  item jsonb;
  position integer := 0;
  offers jsonb;
  legacy_services text[];
begin
  if not exists (select 1 from public.moderators where user_id=reviewer_uuid) then raise exception 'Only a moderator can approve a profile revision'; end if;
  select * into r from public.specialist_revisions where id=revision_uuid for update;
  if not found or r.status <> 'pending' then raise exception 'Revision is not approvable'; end if;
  p := r.payload;
  canonical_avatar_path := private.register_canonical_media_descriptor(r.owner_id, 'revisions', r.id, 'avatar', nullif(p->>'avatar_path',''), avatar_descriptor);
  if jsonb_typeof(coalesce(gallery_descriptors,'[]'::jsonb)) is distinct from 'array' then raise exception 'Canonical revision gallery is invalid'; end if;
  if p ? 'gallery_paths' and jsonb_array_length(coalesce(p->'gallery_paths','[]'::jsonb)) <> jsonb_array_length(coalesce(gallery_descriptors,'[]'::jsonb)) then
    raise exception 'Canonical gallery does not match the reviewed revision';
  end if;
  for item in select value from jsonb_array_elements(coalesce(gallery_descriptors,'[]'::jsonb)) loop
    canonical_gallery_paths := canonical_gallery_paths || private.register_canonical_media_descriptor(
      r.owner_id, 'revisions', r.id, 'gallery-' || position::text,
      (p->'gallery_paths'->>position), item
    );
    position := position + 1;
  end loop;

  if p->>'contract_version'='2' then
    offers := p->'work_offers';
    legacy_services := public.work_offer_titles(offers);
    update public.specialists set
      contract_version=2, full_name=coalesce(nullif(p->>'full_name',''),full_name),
      country=coalesce(nullif(p->>'country',''),country), city=coalesce(nullif(p->>'city',''),city),
      category_id=case when nullif(p->>'category_id','') is null then category_id else (p->>'category_id')::uuid end,
      additional_category_ids=coalesce(array(select jsonb_array_elements_text(coalesce(p->'additional_category_ids','[]'::jsonb))::uuid),'{}'::uuid[]),
      specialization=nullif(p->>'specialization',''), experience_years=(p->>'experience_years')::integer,
      profile_summary=p->>'profile_summary', short_description=p->>'profile_summary', full_description=p->>'full_description',
      help_topics=p->'help_topics', work_offers=offers, services=legacy_services,
      service_mode=public.work_offer_mode(offers,service_mode), avatar_path=canonical_avatar_path,
      status='published', published_at=coalesce(published_at,now()), updated_at=now()
    where id=r.specialist_id and owner_id=r.owner_id;
  else
    update public.specialists set
      full_name=coalesce(nullif(p->>'full_name',''),full_name), country=coalesce(nullif(p->>'country',''),country),
      city=coalesce(nullif(p->>'city',''),city), service_mode=coalesce(nullif(p->>'service_mode',''),service_mode),
      category_id=case when nullif(p->>'category_id','') is null then category_id else (p->>'category_id')::uuid end,
      additional_category_ids=coalesce(array(select jsonb_array_elements_text(coalesce(p->'additional_category_ids',to_jsonb(additional_category_ids)))::uuid),additional_category_ids),
      specialization=coalesce(nullif(p->>'specialization',''),specialization),
      experience_years=case when nullif(p->>'experience_years','') is null then experience_years else (p->>'experience_years')::integer end,
      services=coalesce(array(select jsonb_array_elements_text(coalesce(p->'services',to_jsonb(services)))),services),
      profile_summary=coalesce(nullif(p->>'profile_summary',''),nullif(p->>'short_description',''),profile_summary),
      short_description=coalesce(nullif(p->>'short_description',''),short_description),
      full_description=coalesce(nullif(p->>'full_description',''),full_description),
      help_topics=coalesce(p->'help_topics',help_topics), work_offers=coalesce(p->'work_offers',work_offers),
      public_contact=coalesce(nullif(p->>'public_contact',''),public_contact),
      portfolio_links=coalesce(array(select jsonb_array_elements_text(coalesce(p->'portfolio_links',to_jsonb(portfolio_links)))),portfolio_links),
      video_links=coalesce(array(select jsonb_array_elements_text(coalesce(p->'video_links',to_jsonb(video_links)))),video_links),
      avatar_path=canonical_avatar_path,
      gallery_paths=case when p ? 'gallery_paths' then canonical_gallery_paths else public.specialists.gallery_paths end,
      recommendations=coalesce(nullif(p->>'recommendations',''),recommendations),
      status='published', published_at=coalesce(published_at,now()), updated_at=now()
    where id=r.specialist_id and owner_id=r.owner_id;
  end if;
  if not found then raise exception 'The public profile does not belong to this revision owner'; end if;

  update public.specialist_revisions set
    status='approved', moderator_id=reviewer_uuid, moderator_comment=nullif(trim(note),''), decided_at=now()
  where id=r.id;
  update private.published_media_assets set specialist_id=r.specialist_id
  where source_entity_type='revisions' and source_entity_id=r.id and specialist_id is null;
end;
$$;
revoke all on function public.apply_specialist_revision_with_canonical_media(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_specialist_revision_with_canonical_media(uuid, uuid, text, jsonb, jsonb) to service_role;

commit;
