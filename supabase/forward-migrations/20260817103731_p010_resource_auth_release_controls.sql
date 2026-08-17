begin;

-- SEC-017: browsers may no longer write arbitrary bytes to the submission
-- namespace. The server media gateway validates and transcodes one bounded
-- image, writes a unique WebP with the service role, then records ownership.
create table if not exists private.submission_media_assets (
  object_path text primary key,
  storage_object_id uuid not null unique,
  owner_id uuid not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count bigint not null check (byte_count between 1 and 5242880),
  storage_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint submission_media_assets_path_shape check (
    object_path ~ ('^submissions/' || owner_id::text || '/(avatar|gallery)/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$')
    and object_path !~ '[%\\]' and object_path !~ '(^|/)\.\.(/|$)' and object_path !~ '//' and object_path !~ '[[:cntrl:]]'
  )
);
alter table private.submission_media_assets enable row level security;
alter table private.submission_media_assets force row level security;
revoke all on private.submission_media_assets from public,anon,authenticated;
grant select,insert,update on private.submission_media_assets to service_role;

insert into private.media_reference_registry(reference_key,table_schema,table_name,reference_expression,reference_kind)
values ('submission_media_assets.object_path','private','submission_media_assets','object_path','provenance')
on conflict (reference_key) do update set
  table_schema=excluded.table_schema,
  table_name=excluded.table_name,
  reference_expression=excluded.reference_expression,
  reference_kind=excluded.reference_kind;

create or replace function private.assert_media_reference_registry_v1()
returns void language plpgsql stable security definer set search_path=pg_catalog as $$
declare missing_count integer; unknown_count integer;
begin
  select count(*) into missing_count from (values
    ('applications.main_image_path'),('applications.gallery_paths'),('specialists.avatar_path'),
    ('specialists.gallery_paths'),('specialist_revisions.payload.avatar_path'),
    ('specialist_revisions.payload.gallery_paths'),('published_media_assets.canonical_path'),
    ('published_media_assets.source_path'),('submission_media_assets.object_path')
  ) expected(reference_key)
  where not exists (select 1 from private.media_reference_registry r where r.reference_key=expected.reference_key);
  if missing_count<>0 or (select count(*) from private.media_reference_registry)<>9 then
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

create or replace function private.submission_media_owner_v1(p_path text)
returns uuid language sql stable security definer set search_path=pg_catalog as $$
  select coalesce(
    (select asset.owner_id from private.submission_media_assets asset where asset.object_path=p_path and asset.deleted_at is null),
    (select nullif(object.owner_id,'')::uuid from storage.objects object where object.bucket_id='profile-media' and object.name=p_path)
  );
$$;
revoke all on function private.submission_media_owner_v1(text) from public,anon,authenticated;

create or replace function public.register_submission_media_v1(
  p_owner_id uuid,p_object_path text,p_sha256 text,p_byte_count bigint
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare object_row record; existing private.submission_media_assets;
begin
  if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role'<>'service_role' then
    raise exception using errcode='42501',message='service media registration required';
  end if;
  if not private.is_exact_cleanup_submission_path(p_owner_id,p_object_path)
     or p_sha256 !~ '^[0-9a-f]{64}$' or p_byte_count not between 1 and 5242880 then
    raise exception using errcode='22023',message='submission media descriptor is invalid';
  end if;
  perform pg_advisory_xact_lock(private.media_reference_lock_key_v1(p_object_path));
  select o.id,o.updated_at,
    case when (o.metadata->>'size')~'^[0-9]+$' then (o.metadata->>'size')::bigint end size,
    coalesce(o.metadata->>'mimetype','') mimetype
  into object_row from storage.objects o
  where o.bucket_id='profile-media' and o.name=p_object_path for update;
  if not found or object_row.mimetype<>'image/webp' or object_row.size is distinct from p_byte_count then
    raise exception using errcode='55000',message='submission media object is unavailable or inconsistent';
  end if;
  select * into existing from private.submission_media_assets where object_path=p_object_path for update;
  if found then
    if existing.storage_object_id<>object_row.id or existing.owner_id<>p_owner_id
       or existing.sha256<>p_sha256 or existing.byte_count<>p_byte_count or existing.deleted_at is not null then
      raise exception using errcode='23505',message='submission media registration conflicts';
    end if;
    return true;
  end if;
  insert into private.submission_media_assets(object_path,storage_object_id,owner_id,sha256,byte_count,storage_updated_at)
  values(p_object_path,object_row.id,p_owner_id,p_sha256,p_byte_count,object_row.updated_at);
  return true;
end;
$$;
revoke all on function public.register_submission_media_v1(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.register_submission_media_v1(uuid,text,text,bigint) to service_role;

create or replace function public.assert_owned_profile_media_path(p_owner uuid,p_path text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_path is null then return; end if;
  if p_owner is null then raise exception 'A profile image must have an owner'; end if;

  if private.is_canonical_profile_media_path(p_owner,p_path)
     and exists(select 1 from private.published_media_assets asset where asset.owner_id=p_owner and asset.canonical_path=p_path and asset.retired_at is null) then
    return;
  end if;

  if p_path ~ ('^submissions/' || p_owner::text || '/(avatar|gallery)/[a-f0-9-]{36}\.webp$')
     and private.submission_media_owner_v1(p_path)=p_owner
     and exists(select 1 from storage.objects where bucket_id='profile-media' and name=p_path) then
    return;
  end if;

  -- Existing pre-gateway objects remain usable only when an existing owned row
  -- already references that exact legacy path; no new arbitrary legacy path is trusted.
  if (
       p_path ~ '^submissions/[a-f0-9-]{36}/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
       or p_path ~ '^submissions/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
     )
     and exists(select 1 from storage.objects where bucket_id='profile-media' and name=p_path)
     and (
       exists(select 1 from public.applications where owner_id=p_owner and (main_image_path=p_path or gallery_paths @> array[p_path]::text[]))
       or exists(select 1 from public.specialists where owner_id=p_owner and (avatar_path=p_path or gallery_paths @> array[p_path]::text[]))
       or exists(select 1 from public.specialist_revisions where owner_id=p_owner and (payload->>'avatar_path'=p_path or coalesce(payload->'gallery_paths','[]'::jsonb) @> jsonb_build_array(p_path)))
     ) then
    return;
  end if;
  raise exception 'A profile image must be an existing file owned by the profile owner';
end;
$$;
revoke all on function public.assert_owned_profile_media_path(uuid,text) from public,anon,authenticated;

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
  select o.id,o.updated_at,case when (o.metadata->>'size')~'^[0-9]+$' then (o.metadata->>'size')::bigint end size
  into object_row from storage.objects o where o.bucket_id='profile-media' and o.name=p_object_path for update;
  if not found then raise exception using errcode='P0002',message='exact cleanup object is unavailable'; end if;
  if private.submission_media_owner_v1(p_object_path) is distinct from p_owner_id then
    raise exception using errcode='42501',message='cleanup object ownership mismatch';
  end if;
  select * into refs from private.media_reference_counts_v1(p_object_path);
  if refs.retention_count>0 then initial_status:='manual_review'; safe_code:='retention_protected';
  elsif refs.active_count+refs.workflow_count>0 then initial_status:='cancelled'; safe_code:='referenced'; end if;
  grace:=case when p_reason='failed_application_submit' then interval '24 hours' else interval '7 days' end;
  insert into private.media_cleanup_jobs(
    bucket_id,object_path,storage_object_id,expected_owner_id,expected_size,expected_updated_at,
    media_class,reason,source_operation_id,not_before,status,last_safe_error_code,cancelled_at
  ) values(
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
  select o.id,o.updated_at,case when (o.metadata->>'size')~'^[0-9]+$' then (o.metadata->>'size')::bigint end size
    into object_row from storage.objects o where o.bucket_id=j.bucket_id and o.name=j.object_path for update;
  if not found then
    update private.media_cleanup_jobs set status='deleting' where id=j.id;
    return query select false,true,'exact_object_missing',j.bucket_id,j.object_path; return;
  end if;
  if object_row.id<>j.storage_object_id or private.submission_media_owner_v1(j.object_path) is distinct from j.expected_owner_id
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
  update private.submission_media_assets set deleted_at=coalesce(deleted_at,now()) where object_path=j.object_path and storage_object_id=j.storage_object_id;
  return true;
end;
$$;
revoke all on function public.ack_media_cleanup_job_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ack_media_cleanup_job_v1(uuid,uuid) to service_role;

drop policy if exists "Owners upload unique submission media" on storage.objects;
update storage.buckets set
  file_size_limit=5242880,
  allowed_mime_types=array['image/webp']::text[]
where id='profile-media';

-- SEC-026: the public CMS contract is column based; the operational actor UUID
-- remains available only to trusted server-side administration.
revoke select on table public.site_content from anon,authenticated;
grant select (id,brand_name,tagline,hero_title,hero_text,contact_email,about_text,rules_intro,privacy_text,seo_title,seo_description,updated_at)
  on table public.site_content to anon,authenticated;

notify pgrst,'reload schema';
commit;
