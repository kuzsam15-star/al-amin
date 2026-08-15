-- P0-07 / SEC-007, SEC-008 and the transactional portion of SEC-018.
-- Forward-only migration over the verified baseline plus SEC-001..SEC-004.

begin;

do $$
begin
  if exists (
    select 1 from public.applications
    where owner_id is not null
      and status in ('new','screening','info_required','changes_requested','call_required','call_scheduled')
    group by owner_id having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'P0-07 preflight failed: duplicate active applications require adjudication';
  end if;
end;
$$;

alter table public.applications
  add column if not exists workflow_version bigint not null default 0;

create unique index if not exists applications_one_active_per_owner_idx
  on public.applications(owner_id)
  where owner_id is not null
    and status in ('new','screening','info_required','changes_requested','call_required','call_scheduled');

create or replace function private.bump_application_workflow_version()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status is distinct from old.status then
    new.workflow_version := old.workflow_version + 1;
  end if;
  return new;
end;
$$;
revoke all on function private.bump_application_workflow_version() from public, anon, authenticated;
drop trigger if exists applications_bump_workflow_version on public.applications;
create trigger applications_bump_workflow_version
  before update of status on public.applications
  for each row execute function private.bump_application_workflow_version();

create table if not exists private.application_submit_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  operation_id uuid not null unique,
  application_id uuid not null references public.applications(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, idempotency_key)
);

create table if not exists private.workflow_operations (
  operation_id uuid primary key,
  action text not null check (action in (
    'application_decision','revision_decision','application_publication',
    'revision_publication','application_transition','application_delete'
  )),
  aggregate_type text not null check (aggregate_type in ('application','specialist_revision')),
  aggregate_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_role text not null check (actor_role in ('owner','moderator','admin','service_backend')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists private.domain_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  aggregate_type text not null check (aggregate_type in ('application','specialist_revision')),
  aggregate_id uuid not null,
  event_type text not null check (event_type in (
    'application_submitted','application_resubmitted','application_changes_requested',
    'application_rejected','application_approved','application_status_changed',
    'revision_changes_requested','revision_rejected','revision_approved'
  )),
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_role text not null check (actor_role in ('owner','moderator','admin','service_backend')),
  aggregate_version bigint,
  safe_metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (operation_id, event_type)
);

revoke all on table private.application_submit_requests from public, anon, authenticated;
revoke all on table private.workflow_operations from public, anon, authenticated;
revoke all on table private.domain_events from public, anon, authenticated;

alter table public.application_events
  add column if not exists operation_id uuid,
  add column if not exists actor_role text,
  add column if not exists aggregate_version bigint,
  add column if not exists safe_metadata jsonb not null default '{}'::jsonb;
create unique index if not exists application_events_operation_event_idx
  on public.application_events(operation_id, event_type)
  where operation_id is not null;

alter table public.audit_log
  add column if not exists operation_id uuid,
  add column if not exists actor_role text;
create unique index if not exists audit_log_operation_action_idx
  on public.audit_log(operation_id, action)
  where operation_id is not null;

alter table public.email_notifications
  add column if not exists operation_id uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists worker_id uuid,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists permanent_failure boolean not null default false,
  add column if not exists last_error_code text;

alter table public.email_notifications
  drop constraint if exists email_notifications_max_attempts_check;
alter table public.email_notifications
  add constraint email_notifications_max_attempts_check check (max_attempts between 1 and 10);
alter table public.email_notifications
  drop constraint if exists email_notifications_lease_consistency_check;
alter table public.email_notifications
  add constraint email_notifications_lease_consistency_check check (
    (status = 'processing' and claimed_at is not null and lease_expires_at is not null and worker_id is not null)
    or (status <> 'processing' and lease_expires_at is null and worker_id is null)
  ) not valid;
create index if not exists email_notifications_lease_idx
  on public.email_notifications(status, lease_expires_at, next_attempt_at);
create unique index if not exists email_notifications_operation_event_idx
  on public.email_notifications(operation_id, event_type)
  where operation_id is not null;

create or replace function private.p007_operation_id()
returns uuid
language plpgsql
volatile
set search_path = pg_catalog
as $$
declare value text := nullif(current_setting('app.p007_operation_id', true), '');
begin
  return coalesce(value::uuid, gen_random_uuid());
end;
$$;
revoke all on function private.p007_operation_id() from public, anon, authenticated;

create or replace function private.p007_assert_test_failure(p_stage text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if session_user in ('postgres', 'supabase_admin')
    and current_setting('app.p007_test_mode', true) = 'on'
    and current_setting('app.p007_test_fail_stage', true) = p_stage
  then
    raise exception using errcode = 'P0001', message = 'P0-07 deterministic local test failure';
  end if;
end;
$$;
revoke all on function private.p007_assert_test_failure(text) from public, anon, authenticated;

create or replace function private.append_domain_event(
  p_operation_id uuid,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_event_type text,
  p_actor uuid,
  p_actor_role text,
  p_aggregate_version bigint default null,
  p_safe_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into private.domain_events(
    operation_id, aggregate_type, aggregate_id, event_type,
    actor_id, actor_role, aggregate_version, safe_metadata
  ) values (
    p_operation_id, p_aggregate_type, p_aggregate_id, p_event_type,
    p_actor, p_actor_role, p_aggregate_version, coalesce(p_safe_metadata, '{}'::jsonb)
  );
end;
$$;
revoke all on function private.append_domain_event(uuid,text,uuid,text,uuid,text,bigint,jsonb)
  from public, anon, authenticated;

create or replace function private.append_privileged_audit(
  p_actor uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  op uuid := private.p007_operation_id();
  role_name text := coalesce(nullif(current_setting('app.p007_actor_role', true), ''), 'service_backend');
begin
  if p_actor is null or p_entity_type is null or p_action is null then
    raise exception using errcode = '22023', message = 'Audit identity and action are required';
  end if;
  insert into public.audit_log(actor_id, entity_type, entity_id, action, details, operation_id, actor_role)
  values (p_actor, p_entity_type, p_entity_id, p_action,
    coalesce(p_details, '{}'::jsonb), op, role_name);
  perform private.p007_assert_test_failure('after_audit');
end;
$$;
revoke all on function private.append_privileged_audit(uuid,text,uuid,text,jsonb)
  from public, anon, authenticated;

create or replace function public.record_application_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  kind text;
  event_message text;
  op uuid := private.p007_operation_id();
  actor uuid := coalesce(
    nullif(current_setting('app.p007_actor_id', true), '')::uuid,
    auth.uid(), new.owner_id
  );
  role_name text := coalesce(nullif(current_setting('app.p007_actor_role', true), ''), 'service_backend');
begin
  if tg_op = 'INSERT' then
    perform private.p007_assert_test_failure('after_state');
    insert into public.application_events(
      application_id, actor_id, event_type, operation_id, actor_role, aggregate_version
    ) values (new.id, actor, 'submitted', op, role_name, new.workflow_version);
    perform private.p007_assert_test_failure('after_event');
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  perform private.p007_assert_test_failure('after_state');
  kind := case
    when new.status = 'new' and old.status in ('changes_requested','info_required') then 'resubmitted'
    when new.status = 'changes_requested' then 'changes_requested'
    when new.status = 'approved' then 'approved'
    when new.status = 'rejected' then 'rejected'
    else 'status_changed'
  end;
  event_message := case when kind = 'changes_requested' then new.applicant_message else null end;
  insert into public.application_events(
    application_id, actor_id, event_type, message, is_internal,
    operation_id, actor_role, aggregate_version
  ) values (new.id, actor, kind, event_message, false, op, role_name, new.workflow_version);
  perform private.p007_assert_test_failure('after_event');
  return new;
end;
$$;

create or replace function public.enqueue_email_notification(
  p_event_type text,
  p_user_id uuid,
  p_recipient_email text,
  p_application_id uuid default null,
  p_revision_id uuid default null,
  p_specialist_id uuid default null,
  p_subject text default 'Аманат',
  p_template_data jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  result_id uuid;
  op uuid := private.p007_operation_id();
  safe_key text;
begin
  if p_recipient_email is null
    or p_recipient_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then return null; end if;
  safe_key := case
    when nullif(current_setting('app.p007_operation_id', true), '') is not null
      then op::text || ':' || p_event_type
    else coalesce(nullif(trim(p_idempotency_key), ''), p_event_type || ':' || coalesce(
      p_application_id::text, p_revision_id::text, p_specialist_id::text, p_user_id::text
    ))
  end;
  insert into public.email_notifications(
    event_type,user_id,recipient_email,application_id,revision_id,specialist_id,
    subject,template_data,idempotency_key,operation_id
  ) values (
    p_event_type,p_user_id,lower(trim(p_recipient_email)),p_application_id,p_revision_id,p_specialist_id,
    left(coalesce(p_subject,'Аманат'),300),coalesce(p_template_data,'{}'::jsonb),safe_key,op
  ) on conflict (idempotency_key) do nothing returning id into result_id;
  perform private.p007_assert_test_failure('after_outbox');
  return result_id;
end;
$$;
revoke all on function public.enqueue_email_notification(text,uuid,text,uuid,uuid,uuid,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_email_notification(text,uuid,text,uuid,uuid,uuid,text,jsonb,text)
  to service_role;

create or replace function public.submit_application_v1(
  p_owner_id uuid,
  p_application_id uuid,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  allowed_keys constant text[] := array[
    'contract_version','full_name','contact','country','city','category_text',
    'category_id','additional_category_ids','specialization','experience_years',
    'profile_summary','description','help_topics','work_offers','services',
    'main_image_path','consent_truthful','consent_personal_data'
  ];
  prior private.application_submit_requests;
  current_row public.applications;
  result_id uuid;
  op uuid := gen_random_uuid();
  result jsonb;
begin
  if auth.role() <> 'service_role' and current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted application service is required';
  end if;
  if p_owner_id is null or p_idempotency_key is null
    or p_payload_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_payload) key where not (key = any(allowed_keys)))
  then raise exception using errcode = '22023', message = 'Invalid application submission contract'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 704));
  select * into prior from private.application_submit_requests
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
  if found then
    if prior.payload_hash <> p_payload_hash then
      raise exception using errcode = '23505', message = 'Idempotency key payload conflict';
    end if;
    return prior.result || jsonb_build_object('replayed', true);
  end if;

  perform set_config('app.p007_operation_id', op::text, true);
  perform set_config('app.p007_actor_id', p_owner_id::text, true);
  perform set_config('app.p007_actor_role', 'owner', true);
  perform private.p007_assert_test_failure('after_validation');

  if p_application_id is null then
    if exists (select 1 from public.applications where owner_id = p_owner_id and status in (
      'new','screening','info_required','changes_requested','call_required','call_scheduled'
    )) then raise exception using errcode = '23505', message = 'An active application already exists'; end if;
    insert into public.applications(
      owner_id,contract_version,full_name,contact,country,city,category_text,category_id,
      additional_category_ids,specialization,experience_years,profile_summary,description,
      help_topics,work_offers,services,main_image_path,consent_truthful,consent_personal_data,status
    ) values (
      p_owner_id,(p_payload->>'contract_version')::smallint,p_payload->>'full_name',p_payload->>'contact',
      p_payload->>'country',p_payload->>'city',p_payload->>'category_text',(p_payload->>'category_id')::uuid,
      array(select jsonb_array_elements_text(coalesce(p_payload->'additional_category_ids','[]'::jsonb)))::uuid[],
      p_payload->>'specialization',(p_payload->>'experience_years')::integer,p_payload->>'profile_summary',
      p_payload->>'description',p_payload->'help_topics',p_payload->'work_offers',p_payload->>'services',
      p_payload->>'main_image_path',(p_payload->>'consent_truthful')::boolean,
      (p_payload->>'consent_personal_data')::boolean,'new'
    ) returning * into current_row;
  else
    select * into current_row from public.applications
      where id = p_application_id and owner_id = p_owner_id for update;
    if not found or current_row.status not in ('changes_requested','info_required') then
      raise exception using errcode = '40001', message = 'Application is not available for resubmission';
    end if;
    update public.applications set
      contract_version=(p_payload->>'contract_version')::smallint,
      full_name=p_payload->>'full_name', contact=p_payload->>'contact', country=p_payload->>'country',
      city=p_payload->>'city', category_text=p_payload->>'category_text', category_id=(p_payload->>'category_id')::uuid,
      additional_category_ids=array(select jsonb_array_elements_text(coalesce(p_payload->'additional_category_ids','[]'::jsonb)))::uuid[],
      specialization=p_payload->>'specialization', experience_years=(p_payload->>'experience_years')::integer,
      profile_summary=p_payload->>'profile_summary', description=p_payload->>'description',
      help_topics=p_payload->'help_topics', work_offers=p_payload->'work_offers', services=p_payload->>'services',
      main_image_path=p_payload->>'main_image_path', consent_truthful=(p_payload->>'consent_truthful')::boolean,
      consent_personal_data=(p_payload->>'consent_personal_data')::boolean, status='new', resubmitted_at=clock_timestamp()
    where id = current_row.id returning * into current_row;
  end if;
  result_id := current_row.id;
  perform private.p007_assert_test_failure('after_state');
  perform private.append_domain_event(op,'application',result_id,
    case when p_application_id is null then 'application_submitted' else 'application_resubmitted' end,
    p_owner_id,'owner',current_row.workflow_version,'{}'::jsonb);
  perform private.p007_assert_test_failure('after_domain_event');
  perform private.append_privileged_audit(p_owner_id,'application',result_id,
    case when p_application_id is null then 'submitted' else 'resubmitted' end,
    jsonb_build_object('workflow_version',current_row.workflow_version));
  perform private.p007_assert_test_failure('after_audit');
  result := jsonb_build_object('application_id',result_id,'operation_id',op,'replayed',false);
  insert into private.application_submit_requests(owner_id,idempotency_key,payload_hash,operation_id,application_id,result)
  values (p_owner_id,p_idempotency_key,p_payload_hash,op,result_id,result);
  perform private.p007_assert_test_failure('after_outbox');
  return result;
end;
$$;
revoke all on function public.submit_application_v1(uuid,uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_application_v1(uuid,uuid,uuid,text,jsonb) to service_role;

create or replace function public.moderator_decide_application_v2(
  p_application_id uuid,
  p_expected_version bigint,
  p_expected_status text,
  p_decision text,
  p_operation_id uuid,
  p_internal_note text default null,
  p_applicant_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor uuid := private.require_current_moderator();
  role_name text := case when exists(select 1 from public.moderators where user_id=actor and role='admin') then 'admin' else 'moderator' end;
  current_row public.applications;
  prior private.workflow_operations;
  request_hash text := encode(extensions.digest(convert_to(jsonb_build_array(
    p_application_id,p_expected_version,p_expected_status,p_decision,p_internal_note,p_applicant_message
  )::text,'utf8'),'sha256'),'hex');
  result jsonb;
  domain_kind text;
begin
  if p_operation_id is null or p_decision not in ('request_changes','reject') then
    raise exception using errcode='22023', message='Invalid application decision contract';
  end if;
  select * into prior from private.workflow_operations where operation_id=p_operation_id;
  if found then
    if prior.actor_id<>actor or prior.request_hash<>request_hash or prior.action<>'application_decision' then
      raise exception using errcode='23505', message='Operation replay conflict'; end if;
    return prior.result || jsonb_build_object('replayed',true);
  end if;
  select * into current_row from public.applications where id=p_application_id for update;
  if not found then raise exception using errcode='P0002', message='Application not found'; end if;
  if current_row.workflow_version<>p_expected_version or current_row.status::text<>p_expected_status then
    raise exception using errcode='40001', message='Application changed after review'; end if;
  perform set_config('app.p007_operation_id',p_operation_id::text,true);
  perform set_config('app.p007_actor_id',actor::text,true);
  perform set_config('app.p007_actor_role',role_name,true);
  perform public.moderator_decide_application(p_application_id,current_row.updated_at,p_decision,p_internal_note,p_applicant_message);
  select * into current_row from public.applications where id=p_application_id;
  domain_kind := case when current_row.status='changes_requested' then 'application_changes_requested' else 'application_rejected' end;
  perform private.append_domain_event(p_operation_id,'application',p_application_id,domain_kind,actor,role_name,current_row.workflow_version,'{}'::jsonb);
  perform private.p007_assert_test_failure('after_domain_event');
  result:=jsonb_build_object('application_id',p_application_id,'operation_id',p_operation_id,'status',current_row.status,'workflow_version',current_row.workflow_version,'replayed',false);
  insert into private.workflow_operations values(p_operation_id,'application_decision','application',p_application_id,actor,role_name,request_hash,result,clock_timestamp());
  return result;
end;
$$;
revoke all on function public.moderator_decide_application_v2(uuid,bigint,text,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.moderator_decide_application_v2(uuid,bigint,text,text,uuid,text,text)
  to authenticated;

create or replace function public.moderator_decide_revision_v2(
  p_revision_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_status text,
  p_decision text,
  p_operation_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor uuid := private.require_current_moderator();
  role_name text := case when exists(select 1 from public.moderators where user_id=actor and role='admin') then 'admin' else 'moderator' end;
  current_row public.specialist_revisions;
  prior private.workflow_operations;
  request_hash text := encode(extensions.digest(convert_to(jsonb_build_array(
    p_revision_id,p_expected_updated_at,p_expected_status,p_decision,p_note
  )::text,'utf8'),'sha256'),'hex');
  result jsonb;
  domain_kind text;
begin
  if p_operation_id is null or p_decision not in ('request_changes','reject','approve') then
    raise exception using errcode='22023', message='Invalid revision decision contract'; end if;
  select * into prior from private.workflow_operations where operation_id=p_operation_id;
  if found then
    if prior.actor_id<>actor or prior.request_hash<>request_hash or prior.action<>'revision_decision' then
      raise exception using errcode='23505', message='Operation replay conflict'; end if;
    return prior.result || jsonb_build_object('replayed',true);
  end if;
  select * into current_row from public.specialist_revisions where id=p_revision_id for update;
  if not found then raise exception using errcode='P0002', message='Revision not found'; end if;
  if current_row.updated_at is distinct from p_expected_updated_at or current_row.status<>p_expected_status then
    raise exception using errcode='40001', message='Revision changed after review'; end if;
  perform set_config('app.p007_operation_id',p_operation_id::text,true);
  perform set_config('app.p007_actor_id',actor::text,true);
  perform set_config('app.p007_actor_role',role_name,true);
  if p_decision='request_changes' then
    perform public.request_specialist_revision_changes(p_revision_id,p_note);
    domain_kind:='revision_changes_requested';
  else
    perform public.apply_specialist_revision(p_revision_id,p_decision='approve',p_note);
    domain_kind:=case when p_decision='approve' then 'revision_approved' else 'revision_rejected' end;
  end if;
  select * into current_row from public.specialist_revisions where id=p_revision_id;
  perform private.append_domain_event(p_operation_id,'specialist_revision',p_revision_id,domain_kind,actor,role_name,null,'{}'::jsonb);
  perform private.p007_assert_test_failure('after_domain_event');
  result:=jsonb_build_object('revision_id',p_revision_id,'operation_id',p_operation_id,'status',current_row.status,'replayed',false);
  insert into private.workflow_operations values(p_operation_id,'revision_decision','specialist_revision',p_revision_id,actor,role_name,request_hash,result,clock_timestamp());
  return result;
end;
$$;
revoke all on function public.moderator_decide_revision_v2(uuid,timestamptz,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.moderator_decide_revision_v2(uuid,timestamptz,text,text,uuid,text)
  to authenticated;

create or replace function public.approve_application_with_canonical_media_v3(
  p_application_id uuid,
  p_reviewer_id uuid,
  p_expected_version bigint,
  p_expected_status text,
  p_operation_id uuid,
  p_note text,
  p_avatar_descriptor jsonb,
  p_gallery_descriptors jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_row public.applications;
  prior private.workflow_operations;
  request_hash text := encode(extensions.digest(convert_to(jsonb_build_array(
    p_application_id,p_expected_version,p_expected_status,p_note,
    p_avatar_descriptor,p_gallery_descriptors
  )::text,'utf8'),'sha256'),'hex');
  result jsonb;
begin
  if (auth.role()<>'service_role' and current_user<>'service_role') or p_operation_id is null
    or p_reviewer_id is null or not exists(select 1 from public.moderators where user_id=p_reviewer_id)
  then raise exception using errcode='42501', message='Trusted publication service is required'; end if;
  select * into prior from private.workflow_operations where operation_id=p_operation_id;
  if found then
    if prior.actor_id<>p_reviewer_id or prior.request_hash<>request_hash or prior.action<>'application_publication' then
      raise exception using errcode='23505', message='Operation replay conflict'; end if;
    return prior.result || jsonb_build_object('replayed',true);
  end if;
  select * into current_row from public.applications where id=p_application_id for update;
  if not found then raise exception using errcode='P0002', message='Application not found'; end if;
  if current_row.workflow_version<>p_expected_version or current_row.status::text<>p_expected_status then
    raise exception using errcode='40001', message='Application changed after review'; end if;
  perform set_config('app.p007_operation_id',p_operation_id::text,true);
  perform set_config('app.p007_actor_id',p_reviewer_id::text,true);
  perform set_config('app.p007_actor_role','moderator',true);
  perform public.approve_application_with_canonical_media_v2(
    p_application_id,p_reviewer_id,current_row.updated_at,p_note,
    p_avatar_descriptor,p_gallery_descriptors
  );
  select * into current_row from public.applications where id=p_application_id;
  perform private.append_domain_event(p_operation_id,'application',p_application_id,
    'application_approved',p_reviewer_id,'moderator',current_row.workflow_version,
    jsonb_build_object('canonical_media',true));
  result:=jsonb_build_object('application_id',p_application_id,'operation_id',p_operation_id,
    'status',current_row.status,'workflow_version',current_row.workflow_version,'replayed',false);
  insert into private.workflow_operations values(p_operation_id,'application_publication','application',
    p_application_id,p_reviewer_id,'moderator',request_hash,result,clock_timestamp());
  return result;
end;
$$;
revoke all on function public.approve_application_with_canonical_media_v3(uuid,uuid,bigint,text,uuid,text,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.approve_application_with_canonical_media_v3(uuid,uuid,bigint,text,uuid,text,jsonb,jsonb)
  to service_role;

create or replace function public.apply_specialist_revision_with_canonical_media_v3(
  p_revision_id uuid,
  p_reviewer_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_status text,
  p_operation_id uuid,
  p_note text,
  p_avatar_descriptor jsonb,
  p_gallery_descriptors jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_row public.specialist_revisions;
  prior private.workflow_operations;
  request_hash text := encode(extensions.digest(convert_to(jsonb_build_array(
    p_revision_id,p_expected_updated_at,p_expected_status,p_note,
    p_avatar_descriptor,p_gallery_descriptors
  )::text,'utf8'),'sha256'),'hex');
  result jsonb;
begin
  if (auth.role()<>'service_role' and current_user<>'service_role') or p_operation_id is null
    or p_reviewer_id is null or not exists(select 1 from public.moderators where user_id=p_reviewer_id)
  then raise exception using errcode='42501', message='Trusted publication service is required'; end if;
  select * into prior from private.workflow_operations where operation_id=p_operation_id;
  if found then
    if prior.actor_id<>p_reviewer_id or prior.request_hash<>request_hash or prior.action<>'revision_publication' then
      raise exception using errcode='23505', message='Operation replay conflict'; end if;
    return prior.result || jsonb_build_object('replayed',true);
  end if;
  select * into current_row from public.specialist_revisions where id=p_revision_id for update;
  if not found then raise exception using errcode='P0002', message='Revision not found'; end if;
  if current_row.updated_at is distinct from p_expected_updated_at or current_row.status<>p_expected_status then
    raise exception using errcode='40001', message='Revision changed after review'; end if;
  perform set_config('app.p007_operation_id',p_operation_id::text,true);
  perform set_config('app.p007_actor_id',p_reviewer_id::text,true);
  perform set_config('app.p007_actor_role','moderator',true);
  perform public.apply_specialist_revision_with_canonical_media_v2(
    p_revision_id,p_reviewer_id,current_row.updated_at,p_note,
    p_avatar_descriptor,p_gallery_descriptors
  );
  select * into current_row from public.specialist_revisions where id=p_revision_id;
  perform private.append_domain_event(p_operation_id,'specialist_revision',p_revision_id,
    'revision_approved',p_reviewer_id,'moderator',null,jsonb_build_object('canonical_media',true));
  result:=jsonb_build_object('revision_id',p_revision_id,'operation_id',p_operation_id,
    'status',current_row.status,'replayed',false);
  insert into private.workflow_operations values(p_operation_id,'revision_publication','specialist_revision',
    p_revision_id,p_reviewer_id,'moderator',request_hash,result,clock_timestamp());
  return result;
end;
$$;
revoke all on function public.apply_specialist_revision_with_canonical_media_v3(uuid,uuid,timestamptz,text,uuid,text,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.apply_specialist_revision_with_canonical_media_v3(uuid,uuid,timestamptz,text,uuid,text,jsonb,jsonb)
  to service_role;

revoke execute on function public.moderator_decide_application(uuid,timestamptz,text,text,text) from authenticated;
revoke execute on function public.request_specialist_revision_changes(uuid,text) from authenticated;
revoke execute on function public.apply_specialist_revision(uuid,boolean,text) from authenticated;

create or replace function public.claim_email_notifications_v2(
  p_batch_size integer,
  p_worker_id uuid,
  p_lease_seconds integer default 120
)
returns setof public.email_notifications
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if (auth.role()<>'service_role' and current_user<>'service_role') or p_worker_id is null or p_lease_seconds not between 30 and 900 then
    raise exception using errcode='42501', message='Trusted email worker contract is required'; end if;
  return query with claimed as (
    select id from public.email_notifications
    where permanent_failure=false and attempts<max_attempts
      and next_attempt_at<=clock_timestamp()
      and (status in ('pending','failed') or (status='processing' and lease_expires_at<clock_timestamp()))
    order by next_attempt_at,created_at
    for update skip locked
    limit greatest(1,least(p_batch_size,50))
  )
  update public.email_notifications n set
    status='processing',attempts=n.attempts+1,last_error=null,last_error_code=null,
    claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    worker_id=p_worker_id
  where n.id in (select id from claimed)
  returning n.*;
end;
$$;
revoke all on function public.claim_email_notifications_v2(integer,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_notifications_v2(integer,uuid,integer) to service_role;
revoke execute on function public.claim_email_notifications(integer) from service_role;

create or replace function public.ack_email_notification_v2(
  p_notification_id uuid,
  p_worker_id uuid,
  p_succeeded boolean,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare row_value public.email_notifications; terminal boolean;
begin
  if (auth.role()<>'service_role' and current_user<>'service_role') or p_worker_id is null then
    raise exception using errcode='42501', message='Trusted email worker contract is required'; end if;
  select * into row_value from public.email_notifications where id=p_notification_id for update;
  if not found or row_value.status<>'processing' or row_value.worker_id<>p_worker_id then
    raise exception using errcode='40001', message='Notification lease is not owned by this worker'; end if;
  if p_succeeded then
    update public.email_notifications set status='sent',sent_at=clock_timestamp(),
      provider_message_id=left(p_provider_message_id,500),next_attempt_at=clock_timestamp(),
      last_error=null,last_error_code=null,claimed_at=null,lease_expires_at=null,worker_id=null
    where id=p_notification_id;
    return jsonb_build_object('status','sent','retry',false);
  end if;
  terminal := not p_retryable or row_value.attempts>=row_value.max_attempts;
  update public.email_notifications set status='failed',permanent_failure=terminal,
    last_error=null,last_error_code=left(coalesce(p_error_code,'delivery_failed'),100),
    next_attempt_at=case when terminal then next_attempt_at else clock_timestamp()+
      make_interval(mins=>case row_value.attempts when 1 then 5 when 2 then 30 else 120 end) end,
    claimed_at=null,lease_expires_at=null,worker_id=null
  where id=p_notification_id;
  return jsonb_build_object('status','failed','retry',not terminal);
end;
$$;
revoke all on function public.ack_email_notification_v2(uuid,uuid,boolean,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.ack_email_notification_v2(uuid,uuid,boolean,text,text,boolean)
  to service_role;

revoke insert,update,delete on table public.application_events from public,anon,authenticated;
revoke insert,update,delete on table public.audit_log from public,anon,authenticated;
revoke insert,update,delete on table public.email_notifications from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
