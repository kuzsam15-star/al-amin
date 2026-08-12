select case when
  (select count(*) from pg_constraint where conname in ('applications_approved_media_canonical','specialists_published_media_canonical') and convalidated)=2
  and not exists (
    select 1 from public.applications a where a.status='approved' and (
      (a.main_image_path is not null and not private.is_canonical_profile_media_path(a.owner_id,a.main_image_path))
      or not private.all_canonical_profile_media_paths(a.owner_id,a.gallery_paths)
    )
  )
  and not exists (
    select 1 from public.specialists s where s.status='published' and (
      (s.avatar_path is not null and not private.is_canonical_profile_media_path(s.owner_id,s.avatar_path))
      or not private.all_canonical_profile_media_paths(s.owner_id,s.gallery_paths)
    )
  )
then 'SEC001_PHASE_B_OK' else 'SEC001_PHASE_B_BAD' end;
