begin;

create table if not exists private.media_reference_registry (
  reference_key text primary key,
  table_schema text not null,
  table_name text not null,
  reference_expression text not null,
  reference_kind text not null check (reference_kind in ('column','json-path','provenance')),
  unique (table_schema, table_name, reference_expression)
);

insert into private.media_reference_registry(reference_key,table_schema,table_name,reference_expression,reference_kind)
values
  ('applications.main_image_path','public','applications','main_image_path','column'),
  ('applications.gallery_paths','public','applications','gallery_paths','column'),
  ('specialists.avatar_path','public','specialists','avatar_path','column'),
  ('specialists.gallery_paths','public','specialists','gallery_paths','column'),
  ('specialist_revisions.payload.avatar_path','public','specialist_revisions','payload.avatar_path','json-path'),
  ('specialist_revisions.payload.gallery_paths','public','specialist_revisions','payload.gallery_paths','json-path'),
  ('published_media_assets.canonical_path','private','published_media_assets','canonical_path','provenance'),
  ('published_media_assets.source_path','private','published_media_assets','source_path','provenance')
on conflict (reference_key) do update set
  table_schema=excluded.table_schema,
  table_name=excluded.table_name,
  reference_expression=excluded.reference_expression,
  reference_kind=excluded.reference_kind;

revoke all on private.media_reference_registry from public, anon, authenticated;
grant select on private.media_reference_registry to service_role;

create table if not exists private.media_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null check (bucket_id='profile-media'),
  object_path text not null,
  storage_object_id uuid not null,
  expected_owner_id uuid not null,
  expected_size bigint,
  expected_updated_at timestamptz not null,
  media_class text not null check (media_class='unused_submission'),
  reason text not null check (reason in (
    'failed_application_submit','superseded_revision_media','deleted_application_media',
    'deleted_revision_media','rejected_revision_media','owner_unused_submission'
  )),
  source_operation_id uuid,
  not_before timestamptz not null,
  status text not null default 'pending' check (status in ('pending','claimed','deleting','completed','cancelled','manual_review')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  claimed_at timestamptz,
  lease_until timestamptz,
  worker_id uuid,
  last_safe_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint media_cleanup_jobs_exact_object unique(bucket_id,object_path,storage_object_id),
  constraint media_cleanup_jobs_path_shape check (
    object_path !~ '[%\\]' and object_path !~ '(^|/)\.\.(/|$)' and object_path !~ '//' and object_path !~ '[[:cntrl:]]'
  ),
  constraint media_cleanup_jobs_lease_shape check (
    (status in ('claimed','deleting') and claimed_at is not null and lease_until is not null and worker_id is not null)
    or (status not in ('claimed','deleting') and lease_until is null and worker_id is null)
  ),
  constraint media_cleanup_jobs_terminal_shape check (
    (status='completed' and completed_at is not null and cancelled_at is null)
    or (status='cancelled' and cancelled_at is not null and completed_at is null)
    or (status not in ('completed','cancelled') and completed_at is null and cancelled_at is null)
  )
);

create index if not exists media_cleanup_jobs_claim_idx
  on private.media_cleanup_jobs(not_before,created_at)
  where status in ('pending','claimed','deleting');
create index if not exists media_cleanup_jobs_path_idx
  on private.media_cleanup_jobs(bucket_id,object_path,status);
alter table private.media_cleanup_jobs enable row level security;
alter table private.media_cleanup_jobs force row level security;
revoke all on private.media_cleanup_jobs from public, anon, authenticated;
grant select,insert,update on private.media_cleanup_jobs to service_role;

create or replace function private.is_exact_cleanup_submission_path(p_owner uuid,p_path text)
returns boolean language sql immutable security definer set search_path=pg_catalog as $$
  select p_owner is not null and p_path is not null
    and length(p_path) between 1 and 512
    and p_path !~ '[%\\]' and p_path !~ '(^|/)\.\.(/|$)' and p_path !~ '//' and p_path !~ '[[:cntrl:]]'
    and p_path ~ ('^submissions/' || p_owner::text || '/(avatar|gallery)/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$');
$$;
revoke all on function private.is_exact_cleanup_submission_path(uuid,text) from public,anon,authenticated;

create or replace function private.assert_media_reference_registry_v1()
returns void language plpgsql stable security definer set search_path=pg_catalog as $$
declare missing_count integer; unknown_count integer;
begin
  select count(*) into missing_count from (values
    ('applications.main_image_path'),('applications.gallery_paths'),('specialists.avatar_path'),
    ('specialists.gallery_paths'),('specialist_revisions.payload.avatar_path'),
    ('specialist_revisions.payload.gallery_paths'),('published_media_assets.canonical_path'),
    ('published_media_assets.source_path')
  ) expected(reference_key)
  where not exists (select 1 from private.media_reference_registry r where r.reference_key=expected.reference_key);
  if missing_count<>0 or (select count(*) from private.media_reference_registry)<>8 then
    raise exception using errcode='55000',message='media reference registry mismatch';
  end if;

  select count(*) into unknown_count
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p')
    and n.nspname in ('public','private')
    and a.attname ~ '(avatar|gallery|image|media|object|source|canonical).*path|.*(avatar|gallery|image|media)_paths?'
    and not (n.nspname='private' and c.relname='media_cleanup_jobs' and a.attname='object_path')
    and not exists (
      select 1 from private.media_reference_registry r
      where r.table_schema=n.nspname and r.table_name=c.relname
        and split_part(r.reference_expression,'.',1)=a.attname
    );
  if unknown_count<>0 then raise exception using errcode='55000',message='unregistered media reference field'; end if;
end;
$$;
revoke all on function private.assert_media_reference_registry_v1() from public,anon,authenticated;

create or replace function private.media_reference_counts_v1(p_path text)
returns table(active_count bigint,workflow_count bigint,retention_count bigint)
language sql stable security definer set search_path=pg_catalog as $$
  select
    (select count(*) from public.applications a where a.main_image_path=p_path or p_path=any(coalesce(a.gallery_paths,'{}'::text[])))
      +(select count(*) from public.specialists s where s.avatar_path=p_path or p_path=any(coalesce(s.gallery_paths,'{}'::text[]))),
    (select count(*) from public.specialist_revisions r where r.status in ('pending','changes_requested') and (
      r.payload->>'avatar_path'=p_path or exists (
        select 1 from jsonb_array_elements_text(case when jsonb_typeof(r.payload->'gallery_paths')='array' then r.payload->'gallery_paths' else '[]'::jsonb end) x(value)
        where x.value=p_path))),
    (select count(*) from private.published_media_assets p where p.canonical_path=p_path or p.source_path=p_path);
$$;
revoke all on function private.media_reference_counts_v1(text) from public,anon,authenticated;

create or replace function private.media_reference_lock_key_v1(p_path text)
returns bigint language sql immutable security definer set search_path=pg_catalog as $$
  select hashtextextended('profile-media:' || coalesce(p_path,''),606::bigint);
$$;
revoke all on function private.media_reference_lock_key_v1(text) from public,anon,authenticated;

create or replace function private.guard_media_reference_write_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare row_value jsonb; path_value text;
begin
  row_value:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  for path_value in
    select distinct value from (
      select case when tg_table_name='applications' then row_value->>'main_image_path' else row_value->>'avatar_path' end value
      union all
      select jsonb_array_elements_text(case
        when tg_table_name='specialist_revisions' and jsonb_typeof(row_value->'payload'->'gallery_paths')='array' then row_value->'payload'->'gallery_paths'
        when tg_table_name<>'specialist_revisions' and jsonb_typeof(row_value->'gallery_paths')='array' then row_value->'gallery_paths'
        else '[]'::jsonb end)
      union all
      select case when tg_table_name='specialist_revisions' then row_value->'payload'->>'avatar_path' end
    ) paths where value is not null order by value
  loop
    perform pg_advisory_xact_lock(private.media_reference_lock_key_v1(path_value));
    if exists (select 1 from private.media_cleanup_jobs j where j.bucket_id='profile-media' and j.object_path=path_value and j.status='deleting') then
      raise exception using errcode='55000',message='media cleanup is in progress';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_media_reference_write_v1() from public,anon,authenticated;

drop trigger if exists applications_media_cleanup_lock on public.applications;
create trigger applications_media_cleanup_lock before insert or update of main_image_path,gallery_paths or delete on public.applications
for each row execute function private.guard_media_reference_write_v1();
drop trigger if exists specialists_media_cleanup_lock on public.specialists;
create trigger specialists_media_cleanup_lock before insert or update of avatar_path,gallery_paths or delete on public.specialists
for each row execute function private.guard_media_reference_write_v1();
drop trigger if exists revisions_media_cleanup_lock on public.specialist_revisions;
create trigger revisions_media_cleanup_lock before insert or update of payload or delete on public.specialist_revisions
for each row execute function private.guard_media_reference_write_v1();

drop policy if exists "Owners delete unreferenced submission media" on storage.objects;
revoke execute on function private.owner_may_delete_profile_submission(uuid,text) from authenticated;

create or replace function public.enqueue_media_cleanup_v1(
  p_owner_id uuid,p_object_path text,p_reason text,p_source_operation_id uuid default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare object_row record; job_id uuid; grace interval; refs record; initial_status text:='pending'; safe_code text;
begin
  perform private.assert_media_reference_registry_v1();
  if not private.is_exact_cleanup_submission_path(p_owner_id,p_object_path) then
    raise exception using errcode='22023',message='cleanup candidate is outside the exact submission contract';
  end if;
  if p_reason not in ('failed_application_submit','superseded_revision_media','deleted_application_media','deleted_revision_media','rejected_revision_media','owner_unused_submission') then
    raise exception using errcode='22023',message='cleanup reason is not allowlisted';
  end if;
  perform pg_advisory_xact_lock(private.media_reference_lock_key_v1(p_object_path));
  select o.id,o.owner_id,o.updated_at,
    case when (o.metadata->>'size') ~ '^[0-9]+$' then (o.metadata->>'size')::bigint end size
  into object_row from storage.objects o where o.bucket_id='profile-media' and o.name=p_object_path for update;
  if not found then raise exception using errcode='P0002',message='exact cleanup object is unavailable'; end if;
  if object_row.owner_id is null or object_row.owner_id::text<>p_owner_id::text then
    raise exception using errcode='42501',message='cleanup object ownership mismatch';
  end if;
  select * into refs from private.media_reference_counts_v1(p_object_path);
  if refs.retention_count>0 then initial_status:='manual_review'; safe_code:='retention_protected';
  elsif refs.active_count+refs.workflow_count>0 then initial_status:='cancelled'; safe_code:='referenced'; end if;
  grace:=case when p_reason='failed_application_submit' then interval '24 hours' else interval '7 days' end;
  insert into private.media_cleanup_jobs(
    bucket_id,object_path,storage_object_id,expected_owner_id,expected_size,expected_updated_at,
    media_class,reason,source_operation_id,not_before,status,last_safe_error_code,cancelled_at
  ) values (
    'profile-media',p_object_path,object_row.id,p_owner_id,object_row.size,object_row.updated_at,
    'unused_submission',p_reason,p_source_operation_id,now()+grace,initial_status,safe_code,
    case when initial_status='cancelled' then now() end
  ) on conflict(bucket_id,object_path,storage_object_id) do update set
    source_operation_id=coalesce(private.media_cleanup_jobs.source_operation_id,excluded.source_operation_id)
  returning id into job_id;
  return job_id;
end;
$$;
revoke all on function public.enqueue_media_cleanup_v1(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_media_cleanup_v1(uuid,text,text,uuid) to service_role;

create or replace function public.claim_media_cleanup_jobs_v1(p_limit integer,p_worker_id uuid,p_lease_seconds integer default 120)
returns table(job_id uuid,bucket_id text,object_path text,expected_owner_id uuid,storage_object_id uuid)
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_worker_id is null or p_limit not between 1 and 25 or p_lease_seconds not between 30 and 900 then
    raise exception using errcode='22023',message='cleanup claim parameters are invalid';
  end if;
  return query
  with candidates as (
    select j.id from private.media_cleanup_jobs j
    where j.not_before<=now() and j.attempt_count<5 and (
      j.status='pending' or (j.status in ('claimed','deleting') and j.lease_until<now())
    ) order by j.not_before,j.created_at for update skip locked limit p_limit
  )
  update private.media_cleanup_jobs j set status='claimed',attempt_count=j.attempt_count+1,
    claimed_at=now(),lease_until=now()+make_interval(secs=>p_lease_seconds),worker_id=p_worker_id,last_safe_error_code=null
  from candidates c where j.id=c.id
  returning j.id,j.bucket_id,j.object_path,j.expected_owner_id,j.storage_object_id;
end;
$$;
revoke all on function public.claim_media_cleanup_jobs_v1(integer,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_media_cleanup_jobs_v1(integer,uuid,integer) to service_role;

create or replace function public.authorize_media_cleanup_delete_v1(p_job_id uuid,p_worker_id uuid)
returns table(delete_allowed boolean,object_missing boolean,safe_code text,bucket_id text,object_path text)
language plpgsql security definer set search_path=pg_catalog as $$
declare j private.media_cleanup_jobs; object_row record; refs record;
begin
  perform private.assert_media_reference_registry_v1();
  select * into j from private.media_cleanup_jobs where id=p_job_id for update;
  if not found or j.status<>'claimed' or j.worker_id<>p_worker_id or j.lease_until<=now() then
    raise exception using errcode='55000',message='cleanup lease is invalid';
  end if;
  perform pg_advisory_xact_lock(private.media_reference_lock_key_v1(j.object_path));
  select * into refs from private.media_reference_counts_v1(j.object_path);
  if refs.retention_count>0 then
    update private.media_cleanup_jobs set status='manual_review',lease_until=null,worker_id=null,last_safe_error_code='retention_protected' where id=j.id;
    return query select false,false,'retention_protected',j.bucket_id,j.object_path; return;
  elsif refs.active_count+refs.workflow_count>0 then
    update private.media_cleanup_jobs set status='cancelled',cancelled_at=now(),lease_until=null,worker_id=null,last_safe_error_code='referenced' where id=j.id;
    return query select false,false,'referenced',j.bucket_id,j.object_path; return;
  end if;
  select o.id,o.owner_id,o.updated_at,case when (o.metadata->>'size')~'^[0-9]+$' then (o.metadata->>'size')::bigint end size
    into object_row from storage.objects o where o.bucket_id=j.bucket_id and o.name=j.object_path for update;
  if not found then
    update private.media_cleanup_jobs set status='deleting' where id=j.id;
    return query select false,true,'exact_object_missing',j.bucket_id,j.object_path; return;
  end if;
  if object_row.id<>j.storage_object_id or object_row.owner_id is null or object_row.owner_id::text<>j.expected_owner_id::text
    or object_row.updated_at<>j.expected_updated_at or (j.expected_size is not null and object_row.size is distinct from j.expected_size) then
    update private.media_cleanup_jobs set status='manual_review',lease_until=null,worker_id=null,last_safe_error_code='object_identity_mismatch' where id=j.id;
    return query select false,false,'object_identity_mismatch',j.bucket_id,j.object_path; return;
  end if;
  update private.media_cleanup_jobs set status='deleting' where id=j.id;
  return query select true,false,'delete_exact_object',j.bucket_id,j.object_path;
end;
$$;
revoke all on function public.authorize_media_cleanup_delete_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_media_cleanup_delete_v1(uuid,uuid) to service_role;

create or replace function public.ack_media_cleanup_job_v1(p_job_id uuid,p_worker_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j private.media_cleanup_jobs; refs record;
begin
  perform private.assert_media_reference_registry_v1();
  select * into j from private.media_cleanup_jobs where id=p_job_id for update;
  if not found or j.status<>'deleting' or j.worker_id<>p_worker_id then raise exception using errcode='55000',message='cleanup acknowledgement lease is invalid'; end if;
  perform pg_advisory_xact_lock(private.media_reference_lock_key_v1(j.object_path));
  select * into refs from private.media_reference_counts_v1(j.object_path);
  if refs.active_count+refs.workflow_count+refs.retention_count>0 then raise exception using errcode='55000',message='cleanup acknowledgement found a reference'; end if;
  if exists(select 1 from storage.objects o where o.bucket_id=j.bucket_id and o.name=j.object_path) then raise exception using errcode='55000',message='cleanup object still exists'; end if;
  update private.media_cleanup_jobs set status='completed',completed_at=now(),lease_until=null,worker_id=null,last_safe_error_code=null where id=j.id;
  return true;
end;
$$;
revoke all on function public.ack_media_cleanup_job_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ack_media_cleanup_job_v1(uuid,uuid) to service_role;

create or replace function public.fail_media_cleanup_job_v1(p_job_id uuid,p_worker_id uuid,p_safe_error_code text)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare next_status text;
begin
  if p_safe_error_code is null or p_safe_error_code !~ '^[a-z0-9_]{1,64}$' then raise exception using errcode='22023',message='cleanup error code is invalid'; end if;
  select case when attempt_count>=5 then 'manual_review' else 'pending' end into next_status
    from private.media_cleanup_jobs where id=p_job_id and status in ('claimed','deleting') and worker_id=p_worker_id for update;
  if not found then raise exception using errcode='55000',message='cleanup failure lease is invalid'; end if;
  update private.media_cleanup_jobs set status=next_status,not_before=case when next_status='pending' then now()+interval '5 minutes' else not_before end,
    lease_until=null,worker_id=null,last_safe_error_code=p_safe_error_code where id=p_job_id;
  return next_status;
end;
$$;
revoke all on function public.fail_media_cleanup_job_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fail_media_cleanup_job_v1(uuid,uuid,text) to service_role;

commit;
