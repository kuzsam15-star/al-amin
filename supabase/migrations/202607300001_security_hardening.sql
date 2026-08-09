-- Security hardening: drafts are private, direct privileged RPC calls are removed,
-- and ownership is enforced again at the database boundary.

-- profile-media previously exposed every unmoderated submission at a predictable
-- public URL. Only the application route may now decide whether a file belongs
-- to a published profile or to the authenticated owner/moderator.
update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/webp']::text[]
where id = 'profile-media';

drop policy if exists "Public reads profile media" on storage.objects;
drop policy if exists "Moderator manages profile media" on storage.objects;
drop policy if exists "Owners read own submission media" on storage.objects;

create policy "Owners read own submission media" on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- account_profiles mirrors auth.users. End users must not be able to change the
-- mirrored email address and redirect transactional notifications themselves.
drop policy if exists "Users update own account profile" on public.account_profiles;

-- Administrative audit events always record the authenticated actor. This keeps
-- the existing moderator workflow while blocking forged actor identifiers.
drop policy if exists "Moderator writes audit" on public.audit_log;
create policy "Moderators write own audit entries" on public.audit_log for insert to authenticated
  with check (public.is_moderator() and actor_id = auth.uid());

-- This function is called from a trigger, not by browser clients. Publishing is
-- initiated only by the controlled application-status trigger.
revoke all on function public.publish_approved_application(uuid) from public;
revoke all on function public.publish_after_application_approval() from public;

create or replace function public.assert_owned_profile_media_path(p_owner uuid, p_path text)
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  if p_path is null then return; end if;
  if p_path ~ ('^submissions/' || p_owner::text || '/(avatar|gallery)/[a-f0-9-]{36}\.webp$') then
    if not exists (
       select 1 from storage.objects
       where bucket_id = 'profile-media' and name = p_path
    ) then
      raise exception 'A profile image must be an existing file owned by the profile owner';
    end if;
    return;
  end if;

  -- Backward compatibility: before owner-scoped WebP uploads, the product used
  -- `submissions/<owner>/main-<uuid>.png` and
  -- `submissions/<owner>/gallery-<n>-<uuid>.jpg/png`. These retain an owner
  -- segment, so they receive the same ownership check as modern WebP files.
  if p_path ~ ('^submissions/' || p_owner::text || '/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$')
     and exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = p_path) then
    return;
  end if;

  -- An even older root-level format has no owner segment. It is allowed only
  -- when it is already referenced by this same owner; it cannot be introduced
  -- as a new arbitrary attachment.
  if p_path ~ '^submissions/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
     and exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = p_path)
     and (
       exists (select 1 from public.applications where owner_id = p_owner and (main_image_path = p_path or gallery_paths @> array[p_path]::text[]))
       or exists (select 1 from public.specialists where owner_id = p_owner and (avatar_path = p_path or gallery_paths @> array[p_path]::text[]))
       or exists (select 1 from public.specialist_revisions where owner_id = p_owner and (payload->>'avatar_path' = p_path or coalesce(payload->'gallery_paths', '[]'::jsonb) @> jsonb_build_array(p_path)))
     ) then
    return;
  end if;

  raise exception 'A profile image must be an existing file owned by the profile owner';
end;
$$;
revoke all on function public.assert_owned_profile_media_path(uuid, text) from public;

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
drop trigger if exists applications_guard_media_ownership on public.applications;
create trigger applications_guard_media_ownership
before insert or update of owner_id, main_image_path, gallery_paths on public.applications
for each row execute function public.guard_application_media_ownership();

create or replace function public.guard_specialist_revision_payload()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare element jsonb; p text;
begin
  if jsonb_typeof(new.payload) <> 'object' then
    raise exception 'Revision payload must be an object';
  end if;
  if jsonb_typeof(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) > 10 then
    raise exception 'Revision gallery is invalid';
  end if;
  if jsonb_typeof(coalesce(new.payload->'services', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(new.payload->'services', '[]'::jsonb)) > 80 then
    raise exception 'Revision services are invalid';
  end if;
  if new.payload ? 'full_name' and (jsonb_typeof(new.payload->'full_name') <> 'string' or char_length(new.payload->>'full_name') not between 2 and 140) then
    raise exception 'Revision name is invalid';
  end if;
  if new.payload ? 'city' and (jsonb_typeof(new.payload->'city') <> 'string' or char_length(new.payload->>'city') not between 1 and 100) then
    raise exception 'Revision city is invalid';
  end if;
  if new.payload ? 'service_mode' and coalesce(new.payload->>'service_mode', '') not in ('online', 'offline', 'both') then
    raise exception 'Revision service mode is invalid';
  end if;
  if nullif(new.payload->>'category_id', '') is not null and new.payload->>'category_id' !~ '^[a-f0-9-]{36}$' then
    raise exception 'Revision category is invalid';
  end if;
  if new.payload ? 'experience_years' and nullif(new.payload->>'experience_years', '') is not null
     and (new.payload->>'experience_years' !~ '^(0|[1-9][0-9]?)$' or (new.payload->>'experience_years')::integer > 80) then
    raise exception 'Revision experience is invalid';
  end if;
  if new.payload ? 'short_description' and (jsonb_typeof(new.payload->'short_description') <> 'string' or char_length(new.payload->>'short_description') not between 1 and 220) then
    raise exception 'Revision short description is invalid';
  end if;
  if new.payload ? 'full_description' and jsonb_typeof(new.payload->'full_description') not in ('string', 'null') then
    raise exception 'Revision description is invalid';
  end if;
  if jsonb_typeof(coalesce(new.payload->'portfolio_links', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(new.payload->'video_links', '[]'::jsonb)) <> 'array' then
    raise exception 'Revision links are invalid';
  end if;
  for element in select value from jsonb_array_elements(coalesce(new.payload->'portfolio_links', '[]'::jsonb)) loop
    if jsonb_typeof(element) <> 'string' or trim(both '"' from element::text) !~ '^https://' then raise exception 'Only HTTPS portfolio links are allowed'; end if;
  end loop;
  for element in select value from jsonb_array_elements(coalesce(new.payload->'video_links', '[]'::jsonb)) loop
    if jsonb_typeof(element) <> 'string' or trim(both '"' from element::text) !~ '^https://' then raise exception 'Only HTTPS video links are allowed'; end if;
  end loop;
  if new.payload ? 'avatar_path' and jsonb_typeof(new.payload->'avatar_path') not in ('string', 'null') then
    raise exception 'Revision avatar path is invalid';
  end if;
  perform public.assert_owned_profile_media_path(new.owner_id, nullif(new.payload->>'avatar_path', ''));
  for element in select value from jsonb_array_elements(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) loop
    if jsonb_typeof(element) <> 'string' then raise exception 'Revision gallery path is invalid'; end if;
    p := trim(both '"' from element::text);
    perform public.assert_owned_profile_media_path(new.owner_id, p);
  end loop;
  return new;
end;
$$;
drop trigger if exists specialist_revisions_guard_payload on public.specialist_revisions;
create trigger specialist_revisions_guard_payload
before insert or update of owner_id, payload on public.specialist_revisions
for each row execute function public.guard_specialist_revision_payload();

-- Keep the public REST surface free of reviewer contact details and moderator
-- notes. Public pages query these narrow views rather than their source tables.
drop policy if exists "Public reads approved reviews" on public.reviews;
create or replace view public.published_reviews
with (security_barrier = true, security_invoker = false) as
  select id, specialist_id, body, would_hire_again, created_at
  from public.reviews
  where is_published = true;
revoke all on public.published_reviews from public;
grant select on public.published_reviews to anon, authenticated;

drop policy if exists "Public reads published specialist badges" on public.specialist_trust_badges;
create or replace view public.published_specialist_trust_badges
with (security_barrier = true, security_invoker = false) as
  select assignment.id, assignment.specialist_id, assignment.badge_id,
         assignment.source, assignment.assigned_at
  from public.specialist_trust_badges as assignment
  join public.specialists as specialist on specialist.id = assignment.specialist_id
  join public.trust_badges as badge on badge.id = assignment.badge_id
  where specialist.status = 'published' and badge.is_active = true;
revoke all on public.published_specialist_trust_badges from public;
grant select on public.published_specialist_trust_badges to anon, authenticated;
