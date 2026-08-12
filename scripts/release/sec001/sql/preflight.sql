select case
  when to_regclass('public.applications') is null then 'SEC001_WRONG_CATALOG'
  when to_regclass('public.specialists') is null then 'SEC001_WRONG_CATALOG'
  when to_regclass('storage.buckets') is null then 'SEC001_WRONG_CATALOG'
  when exists (
    select 1 from pg_class c
    where c.oid in ('public.applications'::regclass,'public.specialists'::regclass,'storage.objects'::regclass)
      and not pg_has_role(current_user,c.relowner,'MEMBER')
  ) then 'SEC001_MIGRATION_IDENTITY_NOT_OWNER'
  when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='assert_owned_profile_media_path'
      and not pg_has_role(current_user,p.proowner,'MEMBER')
  ) then 'SEC001_MIGRATION_IDENTITY_NOT_OWNER'
  when to_regclass('private.published_media_assets') is not null then 'SEC001_PHASE_A_ALREADY_PRESENT'
  else 'SEC001_PREFLIGHT_CATALOG_OK'
end;

select 'SEC001_BUCKETS=' || coalesce(string_agg(id,',' order by id),'') from storage.buckets;

select 'SEC001_CATALOG=' || md5(string_agg(
  table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable,
  '|' order by table_schema,table_name,ordinal_position
))
from information_schema.columns
where table_schema in ('public','private','storage');
