begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- The gateway ledger contains only server-derived pseudonymous abuse-control
-- metadata. It is intentionally outside the Data API surface and stores no raw
-- network address, CAPTCHA token, password, or service credential.
create table private.feedback_ingress (
  id uuid primary key default gen_random_uuid(),
  feedback_type text not null check (feedback_type in ('review', 'complaint')),
  target_id uuid not null references public.specialists(id) on delete cascade,
  actor_id uuid,
  scope_key text not null check (char_length(scope_key) between 65 and 110),
  network_fingerprint text not null check (network_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  feedback_id uuid not null,
  created_at timestamptz not null default now(),
  unique (feedback_type, scope_key, idempotency_key_hash)
);

alter table private.feedback_ingress enable row level security;
revoke all on table private.feedback_ingress from public, anon, authenticated, service_role;

create index feedback_ingress_network_created_idx
  on private.feedback_ingress (network_fingerprint, created_at desc);
create index feedback_ingress_actor_created_idx
  on private.feedback_ingress (actor_id, created_at desc)
  where actor_id is not null;
create index feedback_ingress_target_created_idx
  on private.feedback_ingress (target_id, created_at desc);
create index feedback_ingress_content_idx
  on private.feedback_ingress (feedback_type, scope_key, target_id, payload_hash, created_at desc);

-- Direct Data API writes are the SEC-004 bypass. Moderation SELECT/decision
-- paths are left intact; only creation moves behind the service-only function.
drop policy if exists "Anyone submits review" on public.reviews;
drop policy if exists "Anyone submits complaint" on public.complaints;
revoke insert on table public.reviews from public, anon, authenticated;
revoke insert on table public.complaints from public, anon, authenticated;

create or replace function public.submit_feedback_v1(
  p_feedback_type text,
  p_target_id uuid,
  p_actor_id uuid,
  p_network_fingerprint text,
  p_idempotency_key_hash text,
  p_payload_hash text,
  p_body text,
  p_contact text,
  p_would_hire_again boolean,
  p_reason text,
  p_description text,
  p_materials_links text
)
returns table(result_status text, feedback_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_scope_key text;
  v_existing private.feedback_ingress%rowtype;
  v_feedback_id uuid;
  v_short_network_count integer;
  v_long_network_count integer;
  v_short_actor_count integer;
  v_long_actor_count integer;
  v_target_scope_count integer;
  v_target_global_count integer;
begin
  if p_feedback_type not in ('review', 'complaint') then
    raise exception using errcode = '22023', message = 'unsupported feedback type';
  end if;
  if p_target_id is null then
    raise exception using errcode = '22023', message = 'feedback target is required';
  end if;
  if p_network_fingerprint is null or p_network_fingerprint !~ '^[0-9a-f]{64}$'
     or p_idempotency_key_hash is null or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'feedback security metadata is invalid';
  end if;

  if p_contact is not null and char_length(p_contact) > 240 then
    raise exception using errcode = '22023', message = 'feedback contact is invalid';
  end if;
  if p_feedback_type = 'review' then
    if p_body is null or char_length(p_body) not between 30 and 3000
       or p_would_hire_again is null
       or p_reason is not null or p_description is not null or p_materials_links is not null then
      raise exception using errcode = '22023', message = 'review payload is invalid';
    end if;
  else
    if p_reason is null or char_length(p_reason) not between 3 and 120
       or p_description is null or char_length(p_description) not between 20 and 3000
       or p_contact is null or char_length(p_contact) not between 3 and 240
       or p_body is not null or p_would_hire_again is not null
       or (p_materials_links is not null and char_length(p_materials_links) > 3000) then
      raise exception using errcode = '22023', message = 'complaint payload is invalid';
    end if;
  end if;

  if not exists (
    select 1 from public.specialists
    where id = p_target_id and status = 'published'
  ) then
    raise exception using errcode = 'P0001', message = 'feedback target is unavailable';
  end if;

  v_scope_key := coalesce(p_actor_id::text, 'anonymous') || ':' || p_network_fingerprint;
  perform pg_catalog.pg_advisory_xact_lock(
    710041,
    pg_catalog.hashtext(p_network_fingerprint)
  );
  if p_actor_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      710042,
      pg_catalog.hashtext(p_actor_id::text)
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    710043,
    pg_catalog.hashtext(p_target_id::text)
  );

  select * into v_existing
  from private.feedback_ingress
  where feedback_type = p_feedback_type
    and scope_key = v_scope_key
    and idempotency_key_hash = p_idempotency_key_hash;
  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception using errcode = 'P0001', message = 'feedback idempotency conflict';
    end if;
    return query select 'replayed'::text, v_existing.feedback_id;
    return;
  end if;

  select * into v_existing
  from private.feedback_ingress
  where feedback_type = p_feedback_type
    and scope_key = v_scope_key
    and target_id = p_target_id
    and payload_hash = p_payload_hash
    and created_at >= v_now - interval '24 hours'
  order by created_at desc
  limit 1;
  if found then
    return query select 'duplicate'::text, v_existing.feedback_id;
    return;
  end if;

  select count(*) filter (where created_at >= v_now - interval '15 minutes'),
         count(*) filter (where created_at >= v_now - interval '24 hours')
    into v_short_network_count, v_long_network_count
  from private.feedback_ingress
  where network_fingerprint = p_network_fingerprint;

  if p_actor_id is not null then
    select count(*) filter (where created_at >= v_now - interval '15 minutes'),
           count(*) filter (where created_at >= v_now - interval '24 hours')
      into v_short_actor_count, v_long_actor_count
    from private.feedback_ingress
    where actor_id = p_actor_id;
  else
    v_short_actor_count := 0;
    v_long_actor_count := 0;
  end if;

  select count(*) into v_target_scope_count
  from private.feedback_ingress
  where target_id = p_target_id and scope_key = v_scope_key
    and created_at >= v_now - interval '24 hours';

  select count(*) into v_target_global_count
  from private.feedback_ingress
  where target_id = p_target_id and created_at >= v_now - interval '24 hours';

  if v_short_network_count >= 3 or v_long_network_count >= 12
     or v_short_actor_count >= 5 or v_long_actor_count >= 20
     or v_target_scope_count >= 3 or v_target_global_count >= 50 then
    raise exception using errcode = 'P0001', message = 'feedback rate limit exceeded';
  end if;

  v_feedback_id := gen_random_uuid();
  if p_feedback_type = 'review' then
    insert into public.reviews (
      id, specialist_id, author_contact, body, would_hire_again,
      evidence_checked, is_published
    ) values (
      v_feedback_id, p_target_id, p_contact, p_body, p_would_hire_again,
      false, false
    );
  else
    insert into public.complaints (
      id, specialist_id, review_id, reason, description, reporter_contact,
      materials_links, status, internal_notes
    ) values (
      v_feedback_id, p_target_id, null, p_reason, p_description, p_contact,
      p_materials_links, 'new'::public.complaint_status, null
    );
  end if;

  insert into private.feedback_ingress (
    feedback_type, target_id, actor_id, scope_key, network_fingerprint,
    idempotency_key_hash, payload_hash, feedback_id, created_at
  ) values (
    p_feedback_type, p_target_id, p_actor_id, v_scope_key, p_network_fingerprint,
    p_idempotency_key_hash, p_payload_hash, v_feedback_id, v_now
  );

  return query select 'accepted'::text, v_feedback_id;
end;
$$;

revoke all on function public.submit_feedback_v1(text,uuid,uuid,text,text,text,text,text,boolean,text,text,text)
  from public, anon, authenticated;
grant execute on function public.submit_feedback_v1(text,uuid,uuid,text,text,text,text,text,boolean,text,text,text)
  to service_role;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('reviews', 'complaints')
      and cmd in ('INSERT', 'ALL')
      and ('public' = any(roles) or 'anon' = any(roles) or 'authenticated' = any(roles))
  ) then
    raise exception 'SEC-004 client feedback INSERT policy remains';
  end if;
  if has_table_privilege('anon', 'public.reviews', 'INSERT')
     or has_table_privilege('authenticated', 'public.reviews', 'INSERT')
     or has_table_privilege('anon', 'public.complaints', 'INSERT')
     or has_table_privilege('authenticated', 'public.complaints', 'INSERT') then
    raise exception 'SEC-004 client feedback INSERT grant remains';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
