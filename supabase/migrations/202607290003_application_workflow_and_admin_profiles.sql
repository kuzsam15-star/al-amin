-- A single application remains the source of truth until its first approval.
-- Owner edits after a requested change return that same row to moderation.
alter table public.applications
  add column if not exists experience_years integer,
  add column if not exists applicant_message text,
  add column if not exists resubmitted_at timestamptz;

alter table public.applications drop constraint if exists applications_experience_years_check;
alter table public.applications add constraint applications_experience_years_check
  check (experience_years is null or experience_years between 0 and 80);
alter table public.applications drop constraint if exists applications_applicant_message_check;
alter table public.applications add constraint applications_applicant_message_check
  check (applicant_message is null or char_length(applicant_message) <= 5000);
alter table public.applications drop constraint if exists applications_gallery_paths_limit;
alter table public.applications add constraint applications_gallery_paths_limit check (cardinality(gallery_paths) <= 10);
alter table public.specialists drop constraint if exists specialists_gallery_paths_limit;
alter table public.specialists add constraint specialists_gallery_paths_limit check (cardinality(gallery_paths) <= 10);
alter table public.specialist_revisions drop constraint if exists specialist_revisions_gallery_paths_limit;
alter table public.specialist_revisions add constraint specialist_revisions_gallery_paths_limit
  check (jsonb_array_length(coalesce(payload->'gallery_paths', '[]'::jsonb)) <= 10);

create table if not exists public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('submitted','resubmitted','changes_requested','approved','rejected','status_changed')),
  message text,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists application_events_application_created_idx on public.application_events(application_id, created_at asc);

alter table public.application_events enable row level security;
drop policy if exists "Owners read own application events" on public.application_events;
create policy "Owners read own application events" on public.application_events for select to authenticated using (
  exists (select 1 from public.applications a where a.id = application_id and a.owner_id = auth.uid()) and not is_internal
);
drop policy if exists "Moderators read application events" on public.application_events;
create policy "Moderators read application events" on public.application_events for select to authenticated using (public.is_moderator());

create or replace function public.guard_owner_application_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() = old.owner_id and not public.is_moderator() then
    if old.status not in ('changes_requested', 'info_required') then
      raise exception 'This application is not available for resubmission';
    end if;
    -- Owners may edit content only. Moderator-only fields survive unchanged.
    new.status := 'new';
    new.internal_notes := old.internal_notes;
    new.applicant_message := old.applicant_message;
    new.resubmitted_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists applications_guard_owner_update on public.applications;
create trigger applications_guard_owner_update before update on public.applications for each row execute function public.guard_owner_application_update();

create or replace function public.record_application_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare kind text; event_message text;
begin
  if TG_OP = 'INSERT' then
    insert into public.application_events(application_id, actor_id, event_type) values (new.id, auth.uid(), 'submitted');
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  kind := case
    when new.status = 'new' and old.status in ('changes_requested', 'info_required') then 'resubmitted'
    when new.status = 'changes_requested' then 'changes_requested'
    when new.status = 'approved' then 'approved'
    when new.status = 'rejected' then 'rejected'
    else 'status_changed'
  end;
  event_message := case when kind = 'changes_requested' then new.applicant_message else null end;
  insert into public.application_events(application_id, actor_id, event_type, message, is_internal)
  values (new.id, auth.uid(), kind, event_message, false);
  return new;
end;
$$;
drop trigger if exists applications_record_event on public.applications;
create trigger applications_record_event after insert or update of status on public.applications for each row execute function public.record_application_event();

drop policy if exists "Owners update own applications" on public.applications;
create policy "Owners update own applications" on public.applications for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Published profiles cannot be deleted by moderators. Admins retain a guarded
-- delete capability; the product UI archives profiles by default to preserve history.
drop policy if exists "Moderator manages specialists" on public.specialists;
drop policy if exists "Moderators update specialists" on public.specialists;
create policy "Moderators update specialists" on public.specialists for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());
drop policy if exists "Admins delete specialists" on public.specialists;
create policy "Admins delete specialists" on public.specialists for delete to authenticated using (public.is_admin());

-- Include numeric experience in the first-publication transaction. The unique owner
-- index means approval can never make a second public profile.
create or replace function public.publish_approved_application(application_uuid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare app public.applications; existing_id uuid;
begin
  select * into app from public.applications where id = application_uuid;
  if not found or app.status <> 'approved' or app.owner_id is null then return; end if;
  select id into existing_id from public.specialists where owner_id = app.owner_id limit 1;
  if existing_id is not null then
    update public.specialists set
      application_id=app.id, full_name=app.full_name, country=app.country, city=app.city,
      category_id=app.category_id, additional_category_ids=coalesce(app.additional_category_ids,'{}'),
      specialization=app.specialization, experience_years=app.experience_years,
      services=array_remove(regexp_split_to_array(app.services,E'\\n'),''),
      short_description=left(app.description,220), full_description=app.description, public_contact=app.contact,
      portfolio_links=case when app.links is null then '{}' else array_remove(regexp_split_to_array(app.links,E'\\n'),'') end,
      avatar_path=app.main_image_path, gallery_paths=coalesce(app.gallery_paths,'{}'),
      video_links=coalesce(app.video_links,'{}'), status='published', published_at=now(), updated_at=now()
    where id=existing_id;
  else
    insert into public.specialists (
      application_id,owner_id,slug,full_name,country,city,category_id,additional_category_ids,
      specialization,experience_years,services,short_description,full_description,public_contact,
      portfolio_links,avatar_path,gallery_paths,video_links,status,published_at
    ) values (
      app.id,app.owner_id,'profile-'||left(app.id::text,8),app.full_name,app.country,app.city,
      app.category_id,coalesce(app.additional_category_ids,'{}'),app.specialization,app.experience_years,
      array_remove(regexp_split_to_array(app.services,E'\\n'),''),left(app.description,220),app.description,
      app.contact,case when app.links is null then '{}' else array_remove(regexp_split_to_array(app.links,E'\\n'),'') end,
      app.main_image_path,coalesce(app.gallery_paths,'{}'),coalesce(app.video_links,'{}'),'published',now()
    );
  end if;
end;
$$;
