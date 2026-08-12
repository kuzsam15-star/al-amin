select case when
  to_regclass('private.published_media_assets') is not null
  and to_regprocedure('public.approve_application_with_canonical_media(uuid,uuid,timestamp with time zone,text,jsonb,jsonb)') is not null
  and to_regprocedure('public.backfill_canonical_published_media(text,uuid,text,text[],jsonb,jsonb)') is not null
  and exists (select 1 from pg_trigger where tgname='applications_guard_approved_canonical_media' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname='specialists_guard_published_canonical_media' and not tgisinternal)
  and not exists (select 1 from pg_constraint where conname in ('applications_approved_media_canonical','specialists_published_media_canonical'))
then 'SEC001_PHASE_A_OK' else 'SEC001_PHASE_A_BAD' end;
