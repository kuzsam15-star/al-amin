select case when
  to_regclass('private.published_media_assets') is not null
  and to_regprocedure('public.backfill_canonical_published_media(text,uuid,text,text[],jsonb,jsonb)') is not null
  and to_regprocedure('private.is_sec001_legacy_application_canonical_backfill(public.applications,public.applications)') is not null
  and obj_description(
    to_regprocedure('public.require_application_contract_v2_on_content_write()'),
    'pg_proc'
  ) = 'AL-AMIN SEC-001 legacy canonical backfill compatibility v1'
  and not has_function_privilege(
    'anon',
    'private.is_sec001_legacy_application_canonical_backfill(public.applications,public.applications)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.is_sec001_legacy_application_canonical_backfill(public.applications,public.applications)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.is_sec001_legacy_application_canonical_backfill(public.applications,public.applications)',
    'EXECUTE'
  )
  and not exists (
    select 1 from pg_constraint
    where conname in ('applications_approved_media_canonical','specialists_published_media_canonical')
      and convalidated
  )
then 'SEC001_LEGACY_CONTRACT_FORWARD_FIX_OK'
else 'SEC001_LEGACY_CONTRACT_FORWARD_FIX_BAD'
end;
