begin;

do $$
begin
  if exists (
    select 1 from public.applications a
    where a.status='approved' and a.owner_id is not null
      and (
        (a.main_image_path is not null and not private.is_canonical_profile_media_path(a.main_image_path))
        or exists (select 1 from unnest(coalesce(a.gallery_paths,'{}'::text[])) p where not private.is_canonical_profile_media_path(p))
      )
  ) then raise exception 'SEC-001 Phase B blocked: approved applications still reference legacy media'; end if;
  if exists (
    select 1 from public.specialists s
    where s.status='published'
      and (
        (s.avatar_path is not null and not private.is_canonical_profile_media_path(s.avatar_path))
        or exists (select 1 from unnest(coalesce(s.gallery_paths,'{}'::text[])) p where not private.is_canonical_profile_media_path(p))
      )
  ) then raise exception 'SEC-001 Phase B blocked: published specialists still reference legacy media'; end if;
end;
$$;

alter table public.applications drop constraint if exists applications_approved_media_canonical;
alter table public.applications add constraint applications_approved_media_canonical check (
  status <> 'approved' or owner_id is null or (
    (main_image_path is null or private.is_canonical_profile_media_path(main_image_path))
    and private.all_canonical_profile_media_paths(owner_id,gallery_paths)
  )
) not valid;
alter table public.applications validate constraint applications_approved_media_canonical;

alter table public.specialists drop constraint if exists specialists_published_media_canonical;
alter table public.specialists add constraint specialists_published_media_canonical check (
  status <> 'published' or (
    (avatar_path is null or private.is_canonical_profile_media_path(avatar_path))
    and private.all_canonical_profile_media_paths(owner_id,gallery_paths)
  )
) not valid;
alter table public.specialists validate constraint specialists_published_media_canonical;

commit;
