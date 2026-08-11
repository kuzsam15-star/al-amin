begin transaction read only;

do $verify$
declare
  actual integer;
  populated boolean;
  relation_name text;
begin
  select count(*) into actual
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and c.relname in (
      'account_profiles', 'application_events', 'applications', 'audit_log',
      'categories', 'complaints', 'email_notifications', 'moderators',
      'reviews', 'site_content', 'specialist_revisions',
      'specialist_trust_badges', 'specialists', 'trust_badges', 'verifications'
    );
  if actual <> 15 then raise exception 'manifest mismatch: public tables %', actual; end if;

  select count(*) into actual
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f';
  if actual <> 32 then raise exception 'manifest mismatch: public functions %', actual; end if;

  select count(*) into actual
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef;
  if actual <> 18 then raise exception 'manifest mismatch: definer functions %', actual; end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ) then raise exception 'manifest mismatch: definer function without explicit search_path'; end if;

  select count(*) into actual
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v';
  if actual <> 4 then raise exception 'manifest mismatch: public views %', actual; end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and (
        coalesce(array_to_string(c.reloptions, ','), '') not like '%security_barrier=true%'
        or coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=false%'
      )
  ) then raise exception 'manifest mismatch: public view security options'; end if;

  select count(*) into actual
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal;
  if actual <> 19 then raise exception 'manifest mismatch: public triggers %', actual; end if;

  select count(*) into actual from pg_catalog.pg_policies where schemaname = 'public';
  if actual <> 38 then raise exception 'manifest mismatch: public policies %', actual; end if;

  select count(*) into actual
  from pg_catalog.pg_policies
  where schemaname = 'storage' and tablename = 'objects';
  if actual <> 7 then raise exception 'manifest mismatch: storage policies %', actual; end if;

  select count(*) into actual
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and c.relname in (
      'account_profiles', 'application_events', 'applications', 'audit_log',
      'categories', 'complaints', 'email_notifications', 'moderators',
      'reviews', 'site_content', 'specialist_revisions',
      'specialist_trust_badges', 'specialists', 'trust_badges', 'verifications'
    ) and (not c.relrowsecurity or c.relforcerowsecurity);
  if actual <> 0 then raise exception 'manifest mismatch: RLS flags on % tables', actual; end if;

  select count(*) into actual
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class c on c.oid = con.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and con.contype = 'p';
  if actual <> 15 then raise exception 'manifest mismatch: public primary keys %', actual; end if;

  select count(*) into actual
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class c on c.oid = con.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and con.contype = 'f' and con.convalidated;
  if actual <> 26 then raise exception 'manifest mismatch: public foreign keys %', actual; end if;

  select count(*) into actual
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and i.indisvalid and i.indisready;
  if actual <> 31 then raise exception 'manifest mismatch: public indexes %', actual; end if;

  select count(*) into actual
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and i.indisvalid and i.indisready and i.indisunique;
  if actual <> 25 then raise exception 'manifest mismatch: public unique indexes %', actual; end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'account_profiles'
      and policyname = 'Users update own account profile' and cmd = 'UPDATE'
  ) then raise exception 'security fidelity mismatch: SEC-025 policy absent'; end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'reviews'
      and policyname = 'Anyone submits review' and cmd = 'INSERT'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'complaints'
      and policyname = 'Anyone submits complaint' and cmd = 'INSERT'
  ) then raise exception 'security fidelity mismatch: SEC-004 policies absent'; end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Owners update own submission media' and cmd = 'UPDATE'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Owners delete own submission media' and cmd = 'DELETE'
  ) then raise exception 'security fidelity mismatch: SEC-001 policies absent'; end if;

  if has_table_privilege('anon', 'public.applications', 'INSERT')
     or has_table_privilege('authenticated', 'public.applications', 'INSERT')
     or has_table_privilege('anon', 'public.specialist_revisions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.specialist_revisions', 'UPDATE')
  then raise exception 'target migration fidelity mismatch: server-only writes not enforced'; end if;

  select count(*) into actual
  from storage.buckets
  where (id = 'avatars' and public and file_size_limit = 2097152
         and allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[])
     or (id = 'profile-media' and not public and file_size_limit = 5242880
         and allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[]);
  if actual <> 2 then raise exception 'manifest mismatch: storage bucket metadata'; end if;

  foreach relation_name in array array[
    'account_profiles', 'application_events', 'applications', 'audit_log',
    'categories', 'complaints', 'email_notifications', 'moderators',
    'reviews', 'site_content', 'specialist_revisions',
    'specialist_trust_badges', 'specialists', 'trust_badges', 'verifications'
  ] loop
    execute format('select exists(select 1 from public.%I)', relation_name) into populated;
    if populated then raise exception 'no-data violation: public.% contains rows', relation_name; end if;
  end loop;

  if exists (select 1 from auth.users) then
    raise exception 'no-data violation: auth.users contains rows';
  end if;
  if exists (select 1 from storage.objects) then
    raise exception 'no-data violation: storage.objects contains rows';
  end if;
end;
$verify$;

select
  'VERIFIED_BOOTSTRAP_MANIFEST_PASS' as result,
  current_setting('server_version') as postgres_version;

rollback;
