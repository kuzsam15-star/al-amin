-- Transactional email outbox.  This table is deliberately provider-neutral:
-- business transactions only enqueue a safe event and the server-side worker
-- performs delivery afterwards.
create table if not exists public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'application_submitted','application_under_review','application_changes_requested',
    'application_resubmitted','application_approved','application_rejected',
    'profile_hidden','revision_submitted','revision_approved','revision_rejected',
    'revision_changes_requested'
  )),
  user_id uuid references auth.users(id) on delete set null,
  recipient_email text not null,
  application_id uuid references public.applications(id) on delete set null,
  revision_id uuid references public.specialist_revisions(id) on delete set null,
  specialist_id uuid references public.specialists(id) on delete set null,
  subject text not null,
  template_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  last_error text,
  provider_message_id text,
  idempotency_key text not null unique,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists email_notifications_dispatch_idx on public.email_notifications(status,next_attempt_at,created_at);
create index if not exists email_notifications_user_idx on public.email_notifications(user_id,created_at desc);

create or replace function public.touch_email_notification()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists email_notifications_touch on public.email_notifications;
create trigger email_notifications_touch before update on public.email_notifications for each row execute function public.touch_email_notification();

alter table public.email_notifications enable row level security;
drop policy if exists "Owners read own email notifications" on public.email_notifications;
create policy "Owners read own email notifications" on public.email_notifications for select to authenticated using (user_id=auth.uid());
drop policy if exists "Moderators read email notifications" on public.email_notifications;
create policy "Moderators read email notifications" on public.email_notifications for select to authenticated using (public.is_moderator());
-- No authenticated insert/update/delete policy: only server-side service credentials
-- and the security-definer functions below may create or process notifications.

create or replace function public.enqueue_email_notification(
  p_event_type text, p_user_id uuid, p_recipient_email text,
  p_application_id uuid default null, p_revision_id uuid default null,
  p_specialist_id uuid default null, p_subject text default 'Аманат',
  p_template_data jsonb default '{}'::jsonb, p_idempotency_key text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare result_id uuid; safe_key text;
begin
  if p_recipient_email is null or p_recipient_email !~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then return null; end if;
  safe_key:=coalesce(nullif(trim(p_idempotency_key),''), p_event_type||':'||coalesce(p_application_id::text,p_revision_id::text,p_specialist_id::text,p_user_id::text));
  insert into public.email_notifications(event_type,user_id,recipient_email,application_id,revision_id,specialist_id,subject,template_data,idempotency_key)
  values (p_event_type,p_user_id,lower(trim(p_recipient_email)),p_application_id,p_revision_id,p_specialist_id,left(coalesce(p_subject,'Аманат'),300),coalesce(p_template_data,'{}'::jsonb),safe_key)
  on conflict (idempotency_key) do nothing returning id into result_id;
  return result_id;
end; $$;
revoke all on function public.enqueue_email_notification(text,uuid,text,uuid,uuid,uuid,text,jsonb,text) from public;

create or replace function public.enqueue_application_email()
returns trigger language plpgsql security definer set search_path=public as $$
declare recipient text; kind text; slug text; message text;
begin
  select email into recipient from public.account_profiles where id=new.owner_id;
  if recipient is null then return new; end if;
  if TG_OP='INSERT' then
    perform public.enqueue_email_notification('application_submitted',new.owner_id,recipient,new.id,null,null,'Заявка отправлена — Аманат',jsonb_build_object('name',new.full_name),'application_submitted:'||new.id::text||':'||new.updated_at::text);
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  kind:=case new.status when 'screening' then 'application_under_review' when 'changes_requested' then 'application_changes_requested' when 'new' then case when old.status in ('changes_requested','info_required') then 'application_resubmitted' else null end when 'approved' then 'application_approved' when 'rejected' then 'application_rejected' else null end;
  if kind is null then return new; end if;
  select s.slug into slug from public.specialists s where s.application_id=new.id limit 1;
  message:=case when kind='application_changes_requested' then new.applicant_message else null end;
  perform public.enqueue_email_notification(kind,new.owner_id,recipient,new.id,null,null,
    case kind when 'application_changes_requested' then 'Нужно уточнить данные заявки — Аманат' when 'application_resubmitted' then 'Исправленная заявка снова отправлена на проверку — Аманат' when 'application_approved' then 'Ваша заявка одобрена — Аманат' when 'application_rejected' then 'Решение по заявке — Аманат' else 'Заявка принята на рассмотрение — Аманат' end,
    jsonb_strip_nulls(jsonb_build_object('name',new.full_name,'message',message,'profile_slug',slug)),kind||':'||new.id::text||':'||coalesce(new.status_updated_at,new.updated_at)::text);
  return new;
end; $$;
drop trigger if exists applications_enqueue_email on public.applications;
create trigger applications_enqueue_email after insert or update of status on public.applications for each row execute function public.enqueue_application_email();

-- Revisions can be returned for clarification without touching the published profile.
alter table public.specialist_revisions drop constraint if exists specialist_revisions_status_check;
alter table public.specialist_revisions add constraint specialist_revisions_status_check check (status in ('pending','changes_requested','approved','rejected'));
drop policy if exists "Owners update pending revisions" on public.specialist_revisions;
create policy "Owners update pending revisions" on public.specialist_revisions for update to authenticated
using (owner_id=auth.uid() and status in ('pending','changes_requested'))
with check (owner_id=auth.uid() and status='pending' and moderator_id is null and decided_at is null and exists (select 1 from public.specialists s where s.id=specialist_id and s.owner_id=auth.uid()));
create or replace function public.guard_owner_revision_update()
returns trigger language plpgsql as $$ begin
  if auth.uid()=old.owner_id and not public.is_moderator() and old.status='changes_requested' then
    new.status:='pending'; new.moderator_id:=null; new.moderator_comment:=null; new.decided_at:=null;
  end if; return new;
end; $$;
drop trigger if exists specialist_revisions_owner_resubmit on public.specialist_revisions;
create trigger specialist_revisions_owner_resubmit before update on public.specialist_revisions for each row execute function public.guard_owner_revision_update();

create or replace function public.request_specialist_revision_changes(revision_uuid uuid, note text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.specialist_revisions; reviewer uuid:=auth.uid();
begin
  if reviewer is null or not public.is_moderator() then raise exception 'Only moderators can request revision changes'; end if;
  if coalesce(length(trim(note)),0)=0 then raise exception 'A comment is required'; end if;
  select * into r from public.specialist_revisions where id=revision_uuid for update;
  if not found or r.status<>'pending' then raise exception 'Revision is not pending'; end if;
  update public.specialist_revisions set status='changes_requested',moderator_id=reviewer,moderator_comment=trim(note),decided_at=now() where id=r.id;
end; $$;
revoke all on function public.request_specialist_revision_changes(uuid,text) from public;
grant execute on function public.request_specialist_revision_changes(uuid,text) to authenticated;

create or replace function public.enqueue_revision_email()
returns trigger language plpgsql security definer set search_path=public as $$
declare recipient text; display_name text; kind text; message text;
begin
  select email into recipient from public.account_profiles where id=new.owner_id;
  select full_name into display_name from public.specialists where id=new.specialist_id;
  if recipient is null then return new; end if;
  if TG_OP='INSERT' then kind:='revision_submitted'; else if new.status is not distinct from old.status then return new; end if; kind:=case new.status when 'changes_requested' then 'revision_changes_requested' when 'approved' then 'revision_approved' when 'rejected' then 'revision_rejected' when 'pending' then case when old.status='changes_requested' then 'revision_submitted' else null end else null end; end if;
  if kind is null then return new; end if; message:=case when kind in ('revision_changes_requested','revision_rejected') then new.moderator_comment else null end;
  perform public.enqueue_email_notification(kind,new.owner_id,recipient,null,new.id,new.specialist_id,
    case kind when 'revision_changes_requested' then 'Нужно уточнить изменения профиля — Аманат' when 'revision_approved' then 'Изменения профиля одобрены — Аманат' when 'revision_rejected' then 'Решение по изменениям профиля — Аманат' else 'Изменения профиля отправлены на модерацию — Аманат' end,
    jsonb_strip_nulls(jsonb_build_object('name',display_name,'message',message)),kind||':'||new.id::text||':'||new.updated_at::text);
  return new;
end; $$;
drop trigger if exists specialist_revisions_enqueue_email on public.specialist_revisions;
create trigger specialist_revisions_enqueue_email after insert or update of status on public.specialist_revisions for each row execute function public.enqueue_revision_email();

create or replace function public.enqueue_profile_hidden_email()
returns trigger language plpgsql security definer set search_path=public as $$
declare recipient text;
begin
  if old.status='published' and new.status='archived' then
    select email into recipient from public.account_profiles where id=new.owner_id;
    if recipient is not null then perform public.enqueue_email_notification('profile_hidden',new.owner_id,recipient,null,null,new.id,'Профиль временно скрыт — Аманат',jsonb_build_object('name',new.full_name),'profile_hidden:'||new.id::text||':'||new.updated_at::text); end if;
  end if; return new;
end; $$;
drop trigger if exists specialists_enqueue_hidden_email on public.specialists;
create trigger specialists_enqueue_hidden_email after update of status on public.specialists for each row execute function public.enqueue_profile_hidden_email();

-- Atomically lease rows for a server-side worker.  Browser clients have no access.
create or replace function public.claim_email_notifications(batch_size integer default 20)
returns setof public.email_notifications language plpgsql security definer set search_path=public as $$
begin
  return query with claimed as (
    select id from public.email_notifications where (status='pending' or (status='failed' and attempts<3)) and next_attempt_at<=now() order by next_attempt_at,created_at for update skip locked limit greatest(1,least(batch_size,50))
  ) update public.email_notifications n set status='processing',attempts=n.attempts+1,last_error=null where n.id in (select id from claimed) returning n.*;
end; $$;
revoke all on function public.claim_email_notifications(integer) from public;
