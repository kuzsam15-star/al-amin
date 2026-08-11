begin;

do $$
begin
  if exists (
    select 1 from public.applications a
    where a.status='approved' and a.owner_id is not null
      and (
        (a.main_image_path is not null and (
          not private.is_canonical_profile_media_path(a.owner_id,a.main_image_path)
          or not exists (
            select 1 from private.published_media_assets asset
            where asset.owner_id=a.owner_id and asset.canonical_path=a.main_image_path
              and asset.source_entity_type in ('applications','backfill-applications')
              and asset.source_entity_id=a.id and asset.retired_at is null
          )
        ))
        or exists (
          select 1 from unnest(coalesce(a.gallery_paths,'{}'::text[])) p
          where not private.is_canonical_profile_media_path(a.owner_id,p)
             or not exists (
               select 1 from private.published_media_assets asset
               where asset.owner_id=a.owner_id and asset.canonical_path=p
                 and asset.source_entity_type in ('applications','backfill-applications')
                 and asset.source_entity_id=a.id and asset.retired_at is null
             )
        )
      )
  ) then raise exception 'SEC-001 Phase B blocked: approved applications still reference legacy media'; end if;
  if exists (
    select 1 from public.specialists s
    where s.status='published'
      and (
        (s.avatar_path is not null and (
          not private.is_canonical_profile_media_path(s.owner_id,s.avatar_path)
          or not exists (
            select 1 from private.published_media_assets asset
            where asset.owner_id=s.owner_id and asset.canonical_path=s.avatar_path
              and asset.specialist_id=s.id and asset.retired_at is null
          )
        ))
        or exists (
          select 1 from unnest(coalesce(s.gallery_paths,'{}'::text[])) p
          where not private.is_canonical_profile_media_path(s.owner_id,p)
             or not exists (
               select 1 from private.published_media_assets asset
               where asset.owner_id=s.owner_id and asset.canonical_path=p
                 and asset.specialist_id=s.id and asset.retired_at is null
             )
        )
      )
  ) then raise exception 'SEC-001 Phase B blocked: published specialists still reference legacy media'; end if;
end;
$$;

alter table public.applications drop constraint if exists applications_approved_media_canonical;
alter table public.applications add constraint applications_approved_media_canonical check (
  status <> 'approved' or owner_id is null or (
    (main_image_path is null or private.is_canonical_profile_media_path(owner_id,main_image_path))
    and private.all_canonical_profile_media_paths(owner_id,gallery_paths)
  )
) not valid;
alter table public.applications validate constraint applications_approved_media_canonical;

alter table public.specialists drop constraint if exists specialists_published_media_canonical;
alter table public.specialists add constraint specialists_published_media_canonical check (
  status <> 'published' or (
    (avatar_path is null or private.is_canonical_profile_media_path(owner_id,avatar_path))
    and private.all_canonical_profile_media_paths(owner_id,gallery_paths)
  )
) not valid;
alter table public.specialists validate constraint specialists_published_media_canonical;

commit;
