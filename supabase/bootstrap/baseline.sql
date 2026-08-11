-- AL-AMIN verified no-data bootstrap candidate v1.
--
-- Fresh disposable local/CI/staging databases only.
-- This file is not a production migration and must never be applied to an
-- existing AL-AMIN database. The 18 historical migrations remain immutable
-- provenance and are not replayed by this bootstrap.

begin;
set local check_function_bodies = on;

do $bootstrap_guard$
begin
  if exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'account_profiles', 'application_events', 'applications', 'audit_log',
        'categories', 'complaints', 'email_notifications', 'moderators',
        'reviews', 'site_content', 'specialist_revisions',
        'specialist_trust_badges', 'specialists', 'trust_badges',
        'verifications'
      )
      and relation.relkind in ('r', 'p', 'v', 'm')
  ) then
    raise exception 'AL-AMIN bootstrap v1 requires an empty application catalog';
  end if;
end;
$bootstrap_guard$;

-- ============================================================================
-- PROVENANCE SOURCE: supabase/schema.sql (STRUCTURE ONLY; NOT EXECUTED AS A FILE)
-- ============================================================================

-- Reconstructed base objects; legacy demo rows are intentionally excluded.
create extension if not exists pgcrypto;

create type public.application_status as enum ('new','screening','info_required','changes_requested','call_required','call_scheduled','approved','rejected','withdrawn');
create type public.profile_status as enum ('draft','pending','published','suspended','blocked','archived');
create type public.moderator_role as enum ('moderator','admin');
create type public.complaint_status as enum ('new','reviewing','resolved','dismissed');

create table public.categories (
  id uuid primary key default gen_random_uuid(), name text not null unique, slug text not null unique,
  is_active boolean not null default true, created_at timestamptz not null default now()
);

create table public.moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.moderator_role not null default 'moderator', created_at timestamptz not null default now()
);

create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.moderators where user_id = auth.uid()) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.moderators where user_id = auth.uid() and role = 'admin') $$;

create table public.applications (
  id uuid primary key default gen_random_uuid(), full_name text not null check (char_length(full_name) between 2 and 140),
  contact text not null check (char_length(contact) between 3 and 240), country text not null, city text not null,
  category_text text not null, description text not null check (char_length(description) between 50 and 6000),
  services text not null check (char_length(services) between 3 and 3000), links text, recommendations text,
  experience_years int check (experience_years between 0 and 80), applicant_message text, resubmitted_at timestamptz,
  consent_truthful boolean not null default false, consent_personal_data boolean not null default false,
  status public.application_status not null default 'new', internal_notes text, call_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.specialists (
  id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users(id) on delete set null,
  application_id uuid unique references public.applications(id) on delete set null,
  category_id uuid references public.categories(id), slug text not null unique, full_name text not null,
  country text not null, city text not null, services text[] not null default '{}', service_mode text not null default 'both'
    check (service_mode in ('online','offline','both')),
  experience_years int check (experience_years between 0 and 80), short_description text not null,
  full_description text, public_contact text, portfolio_links text[] not null default '{}', avatar_path text,
  status public.profile_status not null default 'draft', verified_at timestamptz, verification_method text,
  published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.verifications (
  id uuid primary key default gen_random_uuid(), specialist_id uuid not null references public.specialists(id) on delete cascade,
  identity_checked boolean not null default false, contacts_checked boolean not null default false,
  interview_completed boolean not null default false, references_checked boolean not null default false,
  checked_by uuid references auth.users(id), private_notes text, created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(), specialist_id uuid not null references public.specialists(id) on delete cascade,
  author_contact text, body text not null check (char_length(body) between 30 and 3000), would_hire_again boolean not null,
  evidence_checked boolean not null default false, is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.complaints (
  id uuid primary key default gen_random_uuid(), specialist_id uuid references public.specialists(id) on delete cascade,
  review_id uuid references public.reviews(id) on delete cascade, reason text not null check (char_length(reason) between 3 and 120),
  description text not null check (char_length(description) between 20 and 3000), reporter_contact text not null,
  materials_links text, status public.complaint_status not null default 'new', internal_notes text,
  created_at timestamptz not null default now(), check (specialist_id is not null or review_id is not null)
);

create table public.audit_log (
  id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null, entity_id uuid, action text not null, details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger applications_updated_at before update on public.applications for each row execute function public.set_updated_at();
create trigger specialists_updated_at before update on public.specialists for each row execute function public.set_updated_at();

alter table public.categories enable row level security;
alter table public.applications enable row level security;
alter table public.specialists enable row level security;
alter table public.verifications enable row level security;
alter table public.reviews enable row level security;
alter table public.complaints enable row level security;
alter table public.moderators enable row level security;
alter table public.audit_log enable row level security;

create policy "Public reads active categories" on public.categories for select using (is_active = true);
create policy "Public reads published specialists" on public.specialists for select using (status = 'published');
create policy "Public reads approved reviews" on public.reviews for select using (is_published = true);
create policy "Anyone submits application" on public.applications for insert to anon, authenticated with check (consent_truthful and consent_personal_data and status = 'new');
create policy "Anyone submits review" on public.reviews for insert to anon, authenticated with check (not is_published and not evidence_checked);
create policy "Anyone submits complaint" on public.complaints for insert to anon, authenticated with check (status = 'new');
create policy "Moderator reads all applications" on public.applications for select to authenticated using (public.is_moderator());
create policy "Moderator updates applications" on public.applications for update to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy "Moderator reads specialists" on public.specialists for select to authenticated using (public.is_moderator());
create policy "Moderator manages specialists" on public.specialists for all to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy "Moderator reads reviews" on public.reviews for select to authenticated using (public.is_moderator());
create policy "Moderator updates reviews" on public.reviews for update to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy "Moderator reads complaints" on public.complaints for select to authenticated using (public.is_moderator());
create policy "Moderator updates complaints" on public.complaints for update to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy "Users read own moderator role" on public.moderators for select to authenticated using (user_id = auth.uid());
create policy "Moderator reads audit" on public.audit_log for select to authenticated using (public.is_moderator());
create policy "Moderator writes audit" on public.audit_log for insert to authenticated with check (public.is_moderator());
create policy "Admin manages categories" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admin manages moderators" on public.moderators for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp']) on conflict (id) do nothing;
create policy "Moderator uploads avatars" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and public.is_moderator());
create policy "Public reads avatars" on storage.objects for select using (bucket_id = 'avatars');
create policy "Moderator deletes avatars" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and public.is_moderator());


-- ============================================================================
-- PROVENANCE SOURCE: 202607280002_product-test-fixes.sql (DATA SEED/BACKFILL REMOVED)
-- ============================================================================

-- Product-test fixes: richer applications, media, owner access and searchable profiles.
alter table public.applications
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists category_id uuid references public.categories(id),
  add column if not exists additional_category_ids uuid[] not null default '{}',
  add column if not exists specialization text,
  add column if not exists video_links text[] not null default '{}',
  add column if not exists main_image_path text,
  add column if not exists gallery_paths text[] not null default '{}';

alter table public.specialists
  add column if not exists additional_category_ids uuid[] not null default '{}',
  add column if not exists specialization text,
  add column if not exists video_links text[] not null default '{}',
  add column if not exists gallery_paths text[] not null default '{}';

-- No category rows in the no-data baseline.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone uploads submission media" on storage.objects;
create policy "Anyone uploads submission media" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = 'submissions');
drop policy if exists "Anyone updates own submission media" on storage.objects;
create policy "Anyone updates own submission media" on storage.objects for update to anon, authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = 'submissions')
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = 'submissions');
drop policy if exists "Anyone deletes submission media" on storage.objects;
create policy "Anyone deletes submission media" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = 'submissions');
drop policy if exists "Public reads profile media" on storage.objects;
create policy "Public reads profile media" on storage.objects for select using (bucket_id = 'profile-media');
drop policy if exists "Moderator manages profile media" on storage.objects;
create policy "Moderator manages profile media" on storage.objects for all to authenticated
  using (bucket_id = 'profile-media' and public.is_moderator()) with check (bucket_id = 'profile-media' and public.is_moderator());

drop policy if exists "Owners read own specialists" on public.specialists;
create policy "Owners read own specialists" on public.specialists for select to authenticated using (owner_id = auth.uid());
drop policy if exists "Owners update own specialists" on public.specialists;
create policy "Owners update own specialists" on public.specialists for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Anyone submits application" on public.applications;
create policy "Anonymous users submit unowned applications" on public.applications for insert to anon
  with check (owner_id is null and consent_truthful and consent_personal_data and status = 'new');
create policy "Authenticated users submit their own applications" on public.applications for insert to authenticated
  with check (owner_id = auth.uid() and consent_truthful and consent_personal_data and status = 'new');

create or replace function public.return_owner_changes_to_moderation() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.owner_id and not public.is_moderator() then
    new.status := 'pending';
    new.published_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists specialists_owner_changes_to_moderation on public.specialists;
create trigger specialists_owner_changes_to_moderation before update on public.specialists
for each row execute function public.return_owner_changes_to_moderation();

drop policy if exists "Owners read own applications" on public.applications;
create policy "Owners read own applications" on public.applications for select to authenticated using (owner_id = auth.uid());

create or replace function public.publish_approved_application(application_uuid uuid) returns void language plpgsql security definer set search_path = public as $$
declare application_row public.applications;
begin
  select * into application_row from public.applications where id = application_uuid;
  if not found or application_row.status <> 'approved' then return; end if;
  insert into public.specialists (
    application_id, owner_id, slug, full_name, country, city, category_id,
    additional_category_ids, specialization, services, short_description, full_description,
    public_contact, portfolio_links, avatar_path, gallery_paths, video_links, status, published_at
  ) values (
    application_row.id, application_row.owner_id, 'profile-' || left(application_row.id::text, 8),
    application_row.full_name, application_row.country, application_row.city, application_row.category_id,
    coalesce(application_row.additional_category_ids, '{}'), application_row.specialization,
    array_remove(regexp_split_to_array(application_row.services, E'\\n'), ''), left(application_row.description, 220), application_row.description,
    application_row.contact, case when application_row.links is null then '{}' else array_remove(regexp_split_to_array(application_row.links, E'\\n'), '') end,
    application_row.main_image_path, coalesce(application_row.gallery_paths, '{}'), coalesce(application_row.video_links, '{}'), 'published', now()
  ) on conflict (application_id) do update set
    owner_id = excluded.owner_id, category_id = excluded.category_id, additional_category_ids = excluded.additional_category_ids,
    specialization = excluded.specialization, services = excluded.services, short_description = excluded.short_description,
    full_description = excluded.full_description, public_contact = excluded.public_contact, portfolio_links = excluded.portfolio_links,
    avatar_path = excluded.avatar_path, gallery_paths = excluded.gallery_paths, video_links = excluded.video_links,
    status = 'published', published_at = now();
end;
$$;

create or replace function public.publish_after_application_approval() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then perform public.publish_approved_application(new.id); end if;
  return new;
end;
$$;
drop trigger if exists applications_publish_after_approval on public.applications;
create trigger applications_publish_after_approval after update of status on public.applications
for each row execute function public.publish_after_application_approval();

-- No application-row publication backfill in the no-data baseline.


-- ============================================================================
-- PROVENANCE SOURCE: 202607280001_accounts_media_publication.sql (DATA BACKFILLS REMOVED)
-- ============================================================================

-- Accounts, ownership, and durable publication rules.
create table if not exists public.account_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.sync_account_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.account_profiles (id,email,display_name,avatar_url)
  values (new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do update set email=excluded.email,display_name=coalesce(excluded.display_name,public.account_profiles.display_name),avatar_url=coalesce(excluded.avatar_url,public.account_profiles.avatar_url),updated_at=now();
  return new;
end;
$$;
drop trigger if exists auth_user_profile_sync on auth.users;
create trigger auth_user_profile_sync after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_account_profile();
-- No auth.users backfill in the no-data baseline.
alter table public.account_profiles enable row level security;
drop policy if exists "Users read own account profile" on public.account_profiles;
create policy "Users read own account profile" on public.account_profiles for select to authenticated using (id=auth.uid());
drop policy if exists "Users update own account profile" on public.account_profiles;
create policy "Users update own account profile" on public.account_profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

alter table public.applications add column if not exists status_updated_at timestamptz not null default now();
create or replace function public.track_application_status() returns trigger language plpgsql as $$ begin if new.status is distinct from old.status then new.status_updated_at=now(); end if; return new; end; $$;
drop trigger if exists applications_status_updated_at on public.applications;
create trigger applications_status_updated_at before update on public.applications for each row execute function public.track_application_status();

drop policy if exists "Anonymous users submit unowned applications" on public.applications;
drop policy if exists "Authenticated users submit their own applications" on public.applications;
drop policy if exists "Anyone submits application" on public.applications;
create policy "Authenticated owners submit applications" on public.applications for insert to authenticated
  with check (owner_id=auth.uid() and owner_id is not null and consent_truthful and consent_personal_data and status='new');

drop policy if exists "Anyone uploads submission media" on storage.objects;
drop policy if exists "Anyone updates own submission media" on storage.objects;
drop policy if exists "Anyone deletes submission media" on storage.objects;
create policy "Owners upload own submission media" on storage.objects for insert to authenticated
  with check (bucket_id='profile-media' and (storage.foldername(name))[1]='submissions' and (storage.foldername(name))[2]=auth.uid()::text);
create policy "Owners update own submission media" on storage.objects for update to authenticated
  using (bucket_id='profile-media' and (storage.foldername(name))[1]='submissions' and (storage.foldername(name))[2]=auth.uid()::text)
  with check (bucket_id='profile-media' and (storage.foldername(name))[1]='submissions' and (storage.foldername(name))[2]=auth.uid()::text);
create policy "Owners delete own submission media" on storage.objects for delete to authenticated
  using (bucket_id='profile-media' and (storage.foldername(name))[1]='submissions' and (storage.foldername(name))[2]=auth.uid()::text);

create unique index if not exists specialists_one_profile_per_owner on public.specialists(owner_id) where owner_id is not null;

create or replace function public.publish_approved_application(application_uuid uuid) returns void language plpgsql security definer set search_path = public as $$
declare app public.applications; existing_id uuid;
begin
  select * into app from public.applications where id=application_uuid;
  if not found or app.status <> 'approved' or app.owner_id is null then return; end if;
  select id into existing_id from public.specialists where owner_id=app.owner_id limit 1;
  if existing_id is not null then
    update public.specialists set application_id=app.id,full_name=app.full_name,country=app.country,city=app.city,category_id=app.category_id,additional_category_ids=coalesce(app.additional_category_ids,'{}'),specialization=app.specialization,services=array_remove(regexp_split_to_array(app.services,E'\\n'),''),short_description=left(app.description,220),full_description=app.description,public_contact=app.contact,portfolio_links=case when app.links is null then '{}' else array_remove(regexp_split_to_array(app.links,E'\\n'),'') end,avatar_path=app.main_image_path,gallery_paths=coalesce(app.gallery_paths,'{}'),video_links=coalesce(app.video_links,'{}'),status='published',published_at=now(),updated_at=now() where id=existing_id;
  else
    insert into public.specialists (application_id,owner_id,slug,full_name,country,city,category_id,additional_category_ids,specialization,services,short_description,full_description,public_contact,portfolio_links,avatar_path,gallery_paths,video_links,status,published_at)
    values (app.id,app.owner_id,'profile-'||left(app.id::text,8),app.full_name,app.country,app.city,app.category_id,coalesce(app.additional_category_ids,'{}'),app.specialization,array_remove(regexp_split_to_array(app.services,E'\\n'),''),left(app.description,220),app.description,app.contact,case when app.links is null then '{}' else array_remove(regexp_split_to_array(app.links,E'\\n'),'') end,app.main_image_path,coalesce(app.gallery_paths,'{}'),coalesce(app.video_links,'{}'),'published',now());
  end if;
end;
$$;

-- No application-row publication backfill in the no-data baseline.


-- ============================================================================
-- PROVENANCE SOURCE: 202607290009_specialist_revisions.sql (DEPENDENCY-ORDERED BEFORE WORKFLOW)
-- ============================================================================

-- Pending versions of already published specialist profiles.
-- Published data remains exclusively in public.specialists until moderation approves a revision.
alter table public.specialists add column if not exists recommendations text;

create table if not exists public.specialist_revisions (
  id uuid primary key default gen_random_uuid(),
  specialist_id uuid not null references public.specialists(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  moderator_id uuid references auth.users(id) on delete set null,
  moderator_comment text check (moderator_comment is null or char_length(moderator_comment) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);

create unique index if not exists specialist_revisions_one_pending
  on public.specialist_revisions (specialist_id) where status = 'pending';
create index if not exists specialist_revisions_owner_status_idx
  on public.specialist_revisions (owner_id, status, updated_at desc);

create or replace function public.set_specialist_revision_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists specialist_revisions_updated_at on public.specialist_revisions;
create trigger specialist_revisions_updated_at
before update on public.specialist_revisions
for each row execute function public.set_specialist_revision_updated_at();

alter table public.specialist_revisions enable row level security;
-- Owners keep read access to their published profile, but may no longer mutate it directly.
-- All owner-originated edits must go through specialist_revisions.
drop policy if exists "Owners update own specialists" on public.specialists;
drop policy if exists "Owners read own revisions" on public.specialist_revisions;
drop policy if exists "Owners create own revisions" on public.specialist_revisions;
drop policy if exists "Owners update pending revisions" on public.specialist_revisions;
drop policy if exists "Moderators read revisions" on public.specialist_revisions;

create policy "Owners read own revisions" on public.specialist_revisions
for select to authenticated using (owner_id = auth.uid());
create policy "Owners create own revisions" on public.specialist_revisions
for insert to authenticated with check (
  owner_id = auth.uid()
  and exists (select 1 from public.specialists s where s.id = specialist_id and s.owner_id = auth.uid())
  and status = 'pending'
  and moderator_id is null and decided_at is null
);
create policy "Owners update pending revisions" on public.specialist_revisions
for update to authenticated
using (owner_id = auth.uid() and status = 'pending')
with check (
  owner_id = auth.uid() and status = 'pending'
  and moderator_id is null and decided_at is null
  and exists (select 1 from public.specialists s where s.id = specialist_id and s.owner_id = auth.uid())
);
create policy "Moderators read revisions" on public.specialist_revisions
for select to authenticated using (public.is_moderator());

-- Only a moderator may finish a revision.  The row lock makes a second decision fail,
-- and the transaction either updates every public field or rolls the whole decision back.
create or replace function public.apply_specialist_revision(
  revision_uuid uuid,
  approve boolean,
  note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.specialist_revisions;
  p jsonb;
  reviewer uuid := auth.uid();
begin
  if reviewer is null or not public.is_moderator() then
    raise exception 'Only moderators can decide profile revisions';
  end if;
  if not approve and coalesce(length(trim(note)), 0) = 0 then
    raise exception 'A rejection comment is required';
  end if;

  select * into r from public.specialist_revisions where id = revision_uuid for update;
  if not found then raise exception 'Revision not found'; end if;
  if r.status <> 'pending' then raise exception 'Revision has already been decided'; end if;
  p := r.payload;

  if approve then
    update public.specialists set
      full_name = coalesce(nullif(p->>'full_name',''), full_name),
      country = coalesce(nullif(p->>'country',''), country),
      city = coalesce(nullif(p->>'city',''), city),
      service_mode = coalesce(nullif(p->>'service_mode',''), service_mode),
      category_id = case when nullif(p->>'category_id','') is null then null else (p->>'category_id')::uuid end,
      additional_category_ids = coalesce(array(select jsonb_array_elements_text(coalesce(p->'additional_category_ids','[]'::jsonb))::uuid), '{}'::uuid[]),
      specialization = nullif(p->>'specialization',''),
      experience_years = case when nullif(p->>'experience_years','') is null then null else (p->>'experience_years')::integer end,
      services = coalesce(array(select jsonb_array_elements_text(coalesce(p->'services','[]'::jsonb))), '{}'::text[]),
      short_description = coalesce(nullif(p->>'short_description',''), short_description),
      full_description = nullif(p->>'full_description',''),
      public_contact = nullif(p->>'public_contact',''),
      portfolio_links = coalesce(array(select jsonb_array_elements_text(coalesce(p->'portfolio_links','[]'::jsonb))), '{}'::text[]),
      video_links = coalesce(array(select jsonb_array_elements_text(coalesce(p->'video_links','[]'::jsonb))), '{}'::text[]),
      avatar_path = nullif(p->>'avatar_path',''),
      gallery_paths = coalesce(array(select jsonb_array_elements_text(coalesce(p->'gallery_paths','[]'::jsonb))), '{}'::text[]),
      recommendations = nullif(p->>'recommendations',''),
      status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
    where id = r.specialist_id and owner_id = r.owner_id;
    if not found then raise exception 'The public profile does not belong to this revision owner'; end if;
  end if;

  update public.specialist_revisions set
    status = case when approve then 'approved' else 'rejected' end,
    moderator_id = reviewer,
    moderator_comment = nullif(trim(note), ''),
    decided_at = now()
  where id = r.id;
end;
$$;

revoke all on function public.apply_specialist_revision(uuid, boolean, text) from public;
grant execute on function public.apply_specialist_revision(uuid, boolean, text) to authenticated;


-- ============================================================================
-- PROVENANCE SOURCE: 202607290001_00_application_changes_requested.sql (ENUM VALUE ALREADY IN BASE TYPE; PROVENANCE NO-OP)
-- ============================================================================

-- application_status already includes changes_requested in the base type definition.


-- ============================================================================
-- PROVENANCE SOURCE: 202607290002_admin_moderation_deletion.sql
-- ============================================================================

-- Permanent removal is limited to administrators. Published specialists are never
-- deleted by these policies or the corresponding server actions.
drop policy if exists "Admin deletes applications" on public.applications;
create policy "Admin deletes applications" on public.applications
for delete to authenticated using (public.is_admin());

drop policy if exists "Admin deletes specialist revisions" on public.specialist_revisions;
create policy "Admin deletes specialist revisions" on public.specialist_revisions
for delete to authenticated using (public.is_admin());


-- ============================================================================
-- PROVENANCE SOURCE: 202607290003_application_workflow_and_admin_profiles.sql
-- ============================================================================

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


-- ============================================================================
-- PROVENANCE SOURCE: 202607290004_email_notifications.sql
-- ============================================================================

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


-- ============================================================================
-- PROVENANCE SOURCE: 202607290005_email_retry_guard.sql
-- ============================================================================

-- Failed deliveries receive at most three automatic attempts. Administrators can
-- later reset a row to pending through the guarded server action.
create or replace function public.claim_email_notifications(batch_size integer default 20)
returns setof public.email_notifications language plpgsql security definer set search_path=public as $$
begin
  return query with claimed as (
    select id from public.email_notifications
    where (status='pending' or (status='failed' and attempts<3)) and next_attempt_at<=now()
    order by next_attempt_at,created_at
    for update skip locked
    limit greatest(1,least(batch_size,50))
  ) update public.email_notifications n
  set status='processing',attempts=n.attempts+1,last_error=null
  where n.id in (select id from claimed)
  returning n.*;
end; $$;
revoke all on function public.claim_email_notifications(integer) from public;


-- ============================================================================
-- PROVENANCE SOURCE: 202607290006_expand_category_catalog.sql (REFERENCE DATA REMOVED)
-- ============================================================================

-- Centralized, grouped catalog for the specialist application and profile editor.
-- Leaf categories remain rows in public.categories; group_name provides the hierarchy used by the UI.
alter table public.categories add column if not exists group_name text;

-- No category rows in the no-data baseline.
-- Empty-table bootstrap needs no category-row backfill.
alter table public.categories alter column group_name set not null;


-- ============================================================================
-- PROVENANCE SOURCE: 202607290007_reclassify_category_groups.sql (REFERENCE-DATA-ONLY; OMITTED)
-- ============================================================================

-- No category rows exist in the no-data baseline, so no reclassification is applied.


-- ============================================================================
-- PROVENANCE SOURCE: 202607290008_site_content.sql (CONTENT DEFAULTS/ROW REMOVED)
-- ============================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.moderators where user_id=auth.uid() and role='admin');
$$;

create table if not exists public.site_content (
  id boolean primary key default true check (id),
  brand_name text not null check (char_length(brand_name) between 2 and 80),
  tagline text not null check (char_length(tagline) between 2 and 240),
  hero_title text not null check (char_length(hero_title) between 2 and 240),
  hero_text text not null check (char_length(hero_text) between 2 and 1000),
  contact_email text not null check (char_length(contact_email) between 3 and 320),
  about_text text not null check (char_length(about_text) between 2 and 5000),
  rules_intro text not null check (char_length(rules_intro) between 2 and 5000),
  privacy_text text not null check (char_length(privacy_text) between 2 and 5000),
  seo_title text not null check (char_length(seo_title) between 2 and 160),
  seo_description text not null check (char_length(seo_description) between 2 and 320),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- No site-content row or content default in the no-data baseline.
alter table public.site_content enable row level security;
drop policy if exists "Public reads site content" on public.site_content;
create policy "Public reads site content" on public.site_content for select using (true);
drop policy if exists "Admins update site content" on public.site_content;
create policy "Admins update site content" on public.site_content for update using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_site_content()
returns trigger language plpgsql as $$ begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists touch_site_content on public.site_content;
create trigger touch_site_content before update on public.site_content for each row execute function public.touch_site_content();


-- ============================================================================
-- PROVENANCE SOURCE: 202607290010_trust_badges.sql (REFERENCE DATA/BACKFILL REMOVED)
-- ============================================================================

-- Independent, fact-based trust badges.  Badges never participate in catalog
-- ordering: public catalog queries continue to sort only by publication data.
create table if not exists public.trust_badges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  title text not null check (char_length(title) between 2 and 100),
  description text not null check (char_length(description) between 12 and 1200),
  icon text not null check (char_length(icon) between 2 and 48),
  assignment_type text not null check (assignment_type in ('automatic', 'manual')),
  is_active boolean not null default true,
  sort_order smallint not null default 100 check (sort_order between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.specialist_trust_badges (
  id uuid primary key default gen_random_uuid(),
  specialist_id uuid not null references public.specialists(id) on delete cascade,
  badge_id uuid not null references public.trust_badges(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  source text not null check (source in ('automatic', 'manual')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  unique (specialist_id, badge_id)
);

create index if not exists specialist_trust_badges_specialist_idx on public.specialist_trust_badges (specialist_id, assigned_at desc);
create index if not exists specialist_trust_badges_badge_idx on public.specialist_trust_badges (badge_id, specialist_id);

create or replace function public.set_trust_badge_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trust_badges_updated_at on public.trust_badges;
create trigger trust_badges_updated_at before update on public.trust_badges
for each row execute function public.set_trust_badge_updated_at();

-- No trust-badge reference rows in the no-data baseline.
alter table public.trust_badges enable row level security;
alter table public.specialist_trust_badges enable row level security;

drop policy if exists "Public reads active trust badges" on public.trust_badges;
drop policy if exists "Moderators read trust badges" on public.trust_badges;
drop policy if exists "Admins manage trust badges" on public.trust_badges;
drop policy if exists "Public reads published specialist badges" on public.specialist_trust_badges;
drop policy if exists "Moderators read specialist badges" on public.specialist_trust_badges;
drop policy if exists "Admins manage specialist badges" on public.specialist_trust_badges;

create policy "Public reads active trust badges" on public.trust_badges
for select using (is_active = true);
create policy "Moderators read trust badges" on public.trust_badges
for select to authenticated using (public.is_moderator());
create policy "Admins manage trust badges" on public.trust_badges
for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Public reads published specialist badges" on public.specialist_trust_badges
for select using (
  exists (select 1 from public.specialists s where s.id = specialist_id and s.status = 'published')
  and exists (select 1 from public.trust_badges b where b.id = badge_id and b.is_active = true)
);
create policy "Moderators read specialist badges" on public.specialist_trust_badges
for select to authenticated using (public.is_moderator());
create policy "Admins manage specialist badges" on public.specialist_trust_badges
for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- The automatic badge is never toggled in the client. It is synchronized with
-- publication so both existing and future approved profiles stay consistent.
create or replace function public.sync_published_verified_badge()
returns trigger language plpgsql security definer set search_path = public as $$
declare verified_badge_id uuid;
begin
  select id into verified_badge_id from public.trust_badges where code = 'verified';
  if verified_badge_id is null then return new; end if;
  if new.status = 'published' then
    insert into public.specialist_trust_badges (specialist_id, badge_id, assigned_by, source, admin_note)
    values (new.id, verified_badge_id, null, 'automatic', null)
    on conflict (specialist_id, badge_id) do update set source = 'automatic', assigned_by = null, admin_note = null;
  else
    delete from public.specialist_trust_badges
    where specialist_id = new.id and badge_id = verified_badge_id and source = 'automatic';
  end if;
  return new;
end;
$$;
drop trigger if exists specialists_sync_verified_badge on public.specialists;
create trigger specialists_sync_verified_badge
after insert or update of status on public.specialists
for each row execute function public.sync_published_verified_badge();

-- No specialist-badge backfill in the no-data baseline.


-- ============================================================================
-- PROVENANCE SOURCE: 202607300001_security_hardening.sql
-- ============================================================================

-- Security hardening: drafts are private, direct privileged RPC calls are removed,
-- and ownership is enforced again at the database boundary.

-- profile-media previously exposed every unmoderated submission at a predictable
-- public URL. Only the application route may now decide whether a file belongs
-- to a published profile or to the authenticated owner/moderator.
update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/webp']::text[]
where id = 'profile-media';

drop policy if exists "Public reads profile media" on storage.objects;
drop policy if exists "Moderator manages profile media" on storage.objects;
drop policy if exists "Owners read own submission media" on storage.objects;

create policy "Owners read own submission media" on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- account_profiles mirrors auth.users. End users must not be able to change the
-- mirrored email address and redirect transactional notifications themselves.
drop policy if exists "Users update own account profile" on public.account_profiles;

-- Administrative audit events always record the authenticated actor. This keeps
-- the existing moderator workflow while blocking forged actor identifiers.
drop policy if exists "Moderator writes audit" on public.audit_log;
create policy "Moderators write own audit entries" on public.audit_log for insert to authenticated
  with check (public.is_moderator() and actor_id = auth.uid());

-- This function is called from a trigger, not by browser clients. Publishing is
-- initiated only by the controlled application-status trigger.
revoke all on function public.publish_approved_application(uuid) from public;
revoke all on function public.publish_after_application_approval() from public;

create or replace function public.assert_owned_profile_media_path(p_owner uuid, p_path text)
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  if p_path is null then return; end if;
  if p_path ~ ('^submissions/' || p_owner::text || '/(avatar|gallery)/[a-f0-9-]{36}\.webp$') then
    if not exists (
       select 1 from storage.objects
       where bucket_id = 'profile-media' and name = p_path
    ) then
      raise exception 'A profile image must be an existing file owned by the profile owner';
    end if;
    return;
  end if;

  -- Backward compatibility: before owner-scoped WebP uploads, the product used
  -- `submissions/<owner>/main-<uuid>.png` and
  -- `submissions/<owner>/gallery-<n>-<uuid>.jpg/png`. These retain an owner
  -- segment, so they receive the same ownership check as modern WebP files.
  if p_path ~ ('^submissions/' || p_owner::text || '/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$')
     and exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = p_path) then
    return;
  end if;

  -- An even older root-level format has no owner segment. It is allowed only
  -- when it is already referenced by this same owner; it cannot be introduced
  -- as a new arbitrary attachment.
  if p_path ~ '^submissions/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
     and exists (select 1 from storage.objects where bucket_id = 'profile-media' and name = p_path)
     and (
       exists (select 1 from public.applications where owner_id = p_owner and (main_image_path = p_path or gallery_paths @> array[p_path]::text[]))
       or exists (select 1 from public.specialists where owner_id = p_owner and (avatar_path = p_path or gallery_paths @> array[p_path]::text[]))
       or exists (select 1 from public.specialist_revisions where owner_id = p_owner and (payload->>'avatar_path' = p_path or coalesce(payload->'gallery_paths', '[]'::jsonb) @> jsonb_build_array(p_path)))
     ) then
    return;
  end if;

  raise exception 'A profile image must be an existing file owned by the profile owner';
end;
$$;
revoke all on function public.assert_owned_profile_media_path(uuid, text) from public;

create or replace function public.guard_application_media_ownership()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare p text;
begin
  if new.owner_id is null then return new; end if;
  perform public.assert_owned_profile_media_path(new.owner_id, new.main_image_path);
  foreach p in array coalesce(new.gallery_paths, '{}'::text[]) loop
    perform public.assert_owned_profile_media_path(new.owner_id, p);
  end loop;
  return new;
end;
$$;
drop trigger if exists applications_guard_media_ownership on public.applications;
create trigger applications_guard_media_ownership
before insert or update of owner_id, main_image_path, gallery_paths on public.applications
for each row execute function public.guard_application_media_ownership();

create or replace function public.guard_specialist_revision_payload()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare element jsonb; p text;
begin
  if jsonb_typeof(new.payload) <> 'object' then
    raise exception 'Revision payload must be an object';
  end if;
  if jsonb_typeof(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) > 10 then
    raise exception 'Revision gallery is invalid';
  end if;
  if jsonb_typeof(coalesce(new.payload->'services', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(new.payload->'services', '[]'::jsonb)) > 80 then
    raise exception 'Revision services are invalid';
  end if;
  if new.payload ? 'full_name' and (jsonb_typeof(new.payload->'full_name') <> 'string' or char_length(new.payload->>'full_name') not between 2 and 140) then
    raise exception 'Revision name is invalid';
  end if;
  if new.payload ? 'city' and (jsonb_typeof(new.payload->'city') <> 'string' or char_length(new.payload->>'city') not between 1 and 100) then
    raise exception 'Revision city is invalid';
  end if;
  if new.payload ? 'service_mode' and coalesce(new.payload->>'service_mode', '') not in ('online', 'offline', 'both') then
    raise exception 'Revision service mode is invalid';
  end if;
  if nullif(new.payload->>'category_id', '') is not null and new.payload->>'category_id' !~ '^[a-f0-9-]{36}$' then
    raise exception 'Revision category is invalid';
  end if;
  if new.payload ? 'experience_years' and nullif(new.payload->>'experience_years', '') is not null
     and (new.payload->>'experience_years' !~ '^(0|[1-9][0-9]?)$' or (new.payload->>'experience_years')::integer > 80) then
    raise exception 'Revision experience is invalid';
  end if;
  if new.payload ? 'short_description' and (jsonb_typeof(new.payload->'short_description') <> 'string' or char_length(new.payload->>'short_description') not between 1 and 220) then
    raise exception 'Revision short description is invalid';
  end if;
  if new.payload ? 'full_description' and jsonb_typeof(new.payload->'full_description') not in ('string', 'null') then
    raise exception 'Revision description is invalid';
  end if;
  if jsonb_typeof(coalesce(new.payload->'portfolio_links', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(new.payload->'video_links', '[]'::jsonb)) <> 'array' then
    raise exception 'Revision links are invalid';
  end if;
  for element in select value from jsonb_array_elements(coalesce(new.payload->'portfolio_links', '[]'::jsonb)) loop
    if jsonb_typeof(element) <> 'string' or trim(both '"' from element::text) !~ '^https://' then raise exception 'Only HTTPS portfolio links are allowed'; end if;
  end loop;
  for element in select value from jsonb_array_elements(coalesce(new.payload->'video_links', '[]'::jsonb)) loop
    if jsonb_typeof(element) <> 'string' or trim(both '"' from element::text) !~ '^https://' then raise exception 'Only HTTPS video links are allowed'; end if;
  end loop;
  if new.payload ? 'avatar_path' and jsonb_typeof(new.payload->'avatar_path') not in ('string', 'null') then
    raise exception 'Revision avatar path is invalid';
  end if;
  perform public.assert_owned_profile_media_path(new.owner_id, nullif(new.payload->>'avatar_path', ''));
  for element in select value from jsonb_array_elements(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) loop
    if jsonb_typeof(element) <> 'string' then raise exception 'Revision gallery path is invalid'; end if;
    p := trim(both '"' from element::text);
    perform public.assert_owned_profile_media_path(new.owner_id, p);
  end loop;
  return new;
end;
$$;
drop trigger if exists specialist_revisions_guard_payload on public.specialist_revisions;
create trigger specialist_revisions_guard_payload
before insert or update of owner_id, payload on public.specialist_revisions
for each row execute function public.guard_specialist_revision_payload();

-- Keep the public REST surface free of reviewer contact details and moderator
-- notes. Public pages query these narrow views rather than their source tables.
drop policy if exists "Public reads approved reviews" on public.reviews;
create or replace view public.published_reviews
with (security_barrier = true, security_invoker = false) as
  select id, specialist_id, body, would_hire_again, created_at
  from public.reviews
  where is_published = true;
revoke all on public.published_reviews from public;
grant select on public.published_reviews to anon, authenticated;

drop policy if exists "Public reads published specialist badges" on public.specialist_trust_badges;
create or replace view public.published_specialist_trust_badges
with (security_barrier = true, security_invoker = false) as
  select assignment.id, assignment.specialist_id, assignment.badge_id,
         assignment.source, assignment.assigned_at
  from public.specialist_trust_badges as assignment
  join public.specialists as specialist on specialist.id = assignment.specialist_id
  join public.trust_badges as badge on badge.id = assignment.badge_id
  where specialist.status = 'published' and badge.is_active = true;
revoke all on public.published_specialist_trust_badges from public;
grant select on public.published_specialist_trust_badges to anon, authenticated;


-- ============================================================================
-- PROVENANCE SOURCE: 202607310001_security_hardening.sql
-- ============================================================================

-- Minimal security patch for a database whose historical migrations were
-- applied outside Supabase CLI. It is intentionally independent of repair.

-- Draft files must never be available by a predictable public Storage URL.
update storage.buckets
set public = false
where id = 'profile-media';

drop policy if exists "Public reads profile media" on storage.objects;
drop policy if exists "Moderator manages profile media" on storage.objects;
drop policy if exists "Anyone uploads submission media" on storage.objects;
drop policy if exists "Anyone updates own submission media" on storage.objects;
drop policy if exists "Anyone deletes submission media" on storage.objects;
drop policy if exists "Owners upload own submission media" on storage.objects;
drop policy if exists "Owners update own submission media" on storage.objects;
drop policy if exists "Owners delete own submission media" on storage.objects;
drop policy if exists "Owners read own submission media" on storage.objects;

create policy "Owners read own submission media" on storage.objects for select to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = 'submissions' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "Owners upload own submission media" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = 'submissions' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "Owners update own submission media" on storage.objects for update to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = 'submissions' and (storage.foldername(name))[2] = auth.uid()::text)
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = 'submissions' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "Owners delete own submission media" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = 'submissions' and (storage.foldername(name))[2] = auth.uid()::text);

-- Remove any anonymous/public SELECT policy from service tables, including
-- policies created outside the repository. Moderator/admin policies for the
-- authenticated role remain intact.
do $$
declare candidate record;
begin
  for candidate in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('reviews', 'specialist_trust_badges')
      and cmd in ('SELECT', 'ALL')
      and ('anon' = any(roles) or 'public' = any(roles))
  loop
    execute format('drop policy if exists %I on public.%I', candidate.policyname, candidate.tablename);
  end loop;
end;
$$;

-- The views contain the entire public contract. They deliberately exclude
-- author_contact, assigned_by and admin_note.
create or replace view public.published_reviews
with (security_barrier = true, security_invoker = false) as
  select id, specialist_id, body, would_hire_again, created_at
  from public.reviews
  where is_published = true;
revoke all on public.published_reviews from public;
grant select on public.published_reviews to anon, authenticated;

create or replace view public.published_specialist_trust_badges
with (security_barrier = true, security_invoker = false) as
  select assignment.id, assignment.specialist_id, assignment.badge_id,
         assignment.source, assignment.assigned_at
  from public.specialist_trust_badges as assignment
  join public.specialists as specialist on specialist.id = assignment.specialist_id
  join public.trust_badges as badge on badge.id = assignment.badge_id
  where specialist.status = 'published' and badge.is_active = true;
revoke all on public.published_specialist_trust_badges from public;
grant select on public.published_specialist_trust_badges to anon, authenticated;


-- ============================================================================
-- PROVENANCE SOURCE: LIVE-CONFIRMED PRE-HARDENING ACL/DEFAULT-PRIVILEGE SURFACE (SEC-016)
-- ============================================================================

-- KNOWN_SECURITY_FINDING: SEC-016.
-- Reproduce the adjudicated pre-hardening opt-out API surface so later
-- forward hardening can prove an exact negative delta.
grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all privileges on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all privileges on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;

alter default privileges for role supabase_admin in schema public
  grant all privileges on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all privileges on sequences to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant execute on functions to anon, authenticated, service_role;


-- ============================================================================
-- PROVENANCE SOURCE: 202608070001_specialist_data_contract.sql (EMPTY-TABLE BACKFILLS ARE NO-OPS)
-- ============================================================================

-- A single, backward-compatible specialist contract shared by applications,
-- first publication, owner revisions and the public profile.

create or replace function public.is_valid_help_topics(value jsonb)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case
    when value is null or jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 12 then false
    else not exists (
      select 1 from jsonb_array_elements(value) as item
      where jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item->'title') is distinct from 'string'
        or char_length(trim(item->>'title')) not between 2 and 140
        or (
          item ? 'description'
          and jsonb_typeof(item->'description') not in ('string', 'null')
        )
        or char_length(coalesce(item->>'description', '')) > 300
    )
  end;
$$;

create or replace function public.is_valid_work_offers(value jsonb, allow_legacy_mode boolean default true)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case
    when value is null or jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 12 then false
    else not exists (
      select 1 from jsonb_array_elements(value) as item
      where jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item->'title') is distinct from 'string'
        or char_length(trim(item->>'title')) not between 2 and 160
        or (item ? 'mode' and jsonb_typeof(item->'mode') not in ('string', 'null'))
        or case
          when allow_legacy_mode then coalesce(item->>'mode', '') not in ('', 'online', 'offline', 'both')
          else coalesce(item->>'mode', '') not in ('online', 'offline', 'both')
        end
        or (item ? 'duration_minutes' and jsonb_typeof(item->'duration_minutes') not in ('number', 'null'))
        or (item->>'duration_minutes' is not null and not case
          when item->>'duration_minutes' ~ '^[0-9]{1,4}$' then (item->>'duration_minutes')::integer between 1 and 1440
          else false
        end)
        or (item ? 'price' and jsonb_typeof(item->'price') not in ('number', 'null'))
        or (item->>'price' is not null and not case
          when item->>'price' ~ '^[0-9]+([.][0-9]{1,2})?$' then (item->>'price')::numeric between 0.01 and 100000000
          else false
        end)
        or (item->>'price' is not null and coalesce(item->>'currency', '') !~ '^[A-Z]{3}$')
        or (item->>'price' is null and item ? 'currency' and jsonb_typeof(item->'currency') not in ('string', 'null'))
    )
  end;
$$;

alter table public.applications
  add column if not exists contract_version smallint,
  add column if not exists profile_summary text,
  add column if not exists help_topics jsonb not null default '[]'::jsonb,
  add column if not exists work_offers jsonb not null default '[]'::jsonb;

alter table public.specialists
  add column if not exists contract_version smallint,
  add column if not exists profile_summary text,
  add column if not exists help_topics jsonb not null default '[]'::jsonb,
  add column if not exists work_offers jsonb not null default '[]'::jsonb;

-- Approved one-time legacy backfill. Help topics deliberately remain empty:
-- services and client problems are different concepts.
update public.applications set contract_version = 1 where contract_version is null;
update public.specialists set contract_version = 1 where contract_version is null;
alter table public.applications alter column contract_version set default 2;
alter table public.applications alter column contract_version set not null;
alter table public.specialists alter column contract_version set default 2;
alter table public.specialists alter column contract_version set not null;

update public.applications
set profile_summary = left(trim(description), 220)
where profile_summary is null or trim(profile_summary) = '';

update public.specialists
set profile_summary = left(trim(coalesce(nullif(short_description, ''), full_description, '')), 220)
where profile_summary is null or trim(profile_summary) = '';

update public.specialists as specialist
set work_offers = coalesce((
  select jsonb_agg(jsonb_build_object(
    'title', trim(service),
    'duration_minutes', null,
    'mode', specialist.service_mode,
    'price', null,
    'currency', null
  ) order by ordinality)
  from unnest(specialist.services) with ordinality as legacy(service, ordinality)
  where trim(service) <> ''
), '[]'::jsonb)
where work_offers = '[]'::jsonb and cardinality(services) > 0;

update public.applications as application
set work_offers = coalesce((
  select jsonb_agg(jsonb_build_object(
    'title', trim(service),
    'duration_minutes', null,
    'mode', (select specialist.service_mode from public.specialists as specialist where specialist.application_id = application.id limit 1),
    'price', null,
    'currency', null
  ) order by ordinality)
  from regexp_split_to_table(application.services, E'\\n') with ordinality as legacy(service, ordinality)
  where trim(service) <> ''
), '[]'::jsonb)
where work_offers = '[]'::jsonb and trim(services) <> '';

alter table public.applications alter column profile_summary set not null;
alter table public.specialists alter column profile_summary set not null;

alter table public.applications drop constraint if exists applications_contract_version_check;
alter table public.applications add constraint applications_contract_version_check check (contract_version in (1, 2));
alter table public.specialists drop constraint if exists specialists_contract_version_check;
alter table public.specialists add constraint specialists_contract_version_check check (contract_version in (1, 2));

alter table public.applications drop constraint if exists applications_profile_summary_check;
alter table public.applications add constraint applications_profile_summary_check check (contract_version = 1 or char_length(trim(profile_summary)) between 1 and 220) not valid;
alter table public.specialists drop constraint if exists specialists_profile_summary_check;
alter table public.specialists add constraint specialists_profile_summary_check check (contract_version = 1 or char_length(trim(profile_summary)) between 1 and 220) not valid;
alter table public.applications drop constraint if exists applications_help_topics_check;
alter table public.applications add constraint applications_help_topics_check check (public.is_valid_help_topics(help_topics) and (contract_version = 1 or jsonb_array_length(help_topics) >= 1)) not valid;
alter table public.specialists drop constraint if exists specialists_help_topics_check;
alter table public.specialists add constraint specialists_help_topics_check check (public.is_valid_help_topics(help_topics) and (contract_version = 1 or jsonb_array_length(help_topics) >= 1)) not valid;
alter table public.applications drop constraint if exists applications_work_offers_check;
alter table public.applications add constraint applications_work_offers_check check (public.is_valid_work_offers(work_offers, contract_version = 1) and (contract_version = 1 or jsonb_array_length(work_offers) >= 1)) not valid;
alter table public.specialists drop constraint if exists specialists_work_offers_check;
alter table public.specialists add constraint specialists_work_offers_check check (public.is_valid_work_offers(work_offers, contract_version = 1) and (contract_version = 1 or jsonb_array_length(work_offers) >= 1)) not valid;

-- Existing descriptions are preserved. The NOT VALID constraint protects all
-- new or edited rows without rewriting legacy content.
alter table public.applications drop constraint if exists applications_description_check;
alter table public.applications add constraint applications_description_check check (contract_version = 1 or char_length(description) between 50 and 3000) not valid;
alter table public.applications drop constraint if exists applications_services_check;
alter table public.applications add constraint applications_services_check check (char_length(services) between 2 and 3000) not valid;
alter table public.specialists drop constraint if exists specialists_full_description_check;
alter table public.specialists add constraint specialists_full_description_check check (contract_version = 1 or (full_description is not null and char_length(full_description) between 50 and 3000)) not valid;

create or replace function public.work_offer_titles(value jsonb)
returns text[] language sql immutable set search_path = pg_catalog as $$
  select coalesce(array_agg(item->>'title' order by ordinality), '{}'::text[])
  from jsonb_array_elements(coalesce(value, '[]'::jsonb)) with ordinality as offer(item, ordinality)
  where nullif(trim(item->>'title'), '') is not null;
$$;

create or replace function public.work_offer_mode(value jsonb, fallback text default 'both')
returns text language sql immutable set search_path = pg_catalog as $$
  with modes as (
    select item->>'mode' as mode
    from jsonb_array_elements(coalesce(value, '[]'::jsonb)) as offer(item)
    where item->>'mode' in ('online', 'offline', 'both')
  )
  select case
    when bool_or(mode = 'both') or count(distinct mode) > 1 then 'both'
    else coalesce(max(mode), nullif(fallback, ''), 'both')
  end
  from modes;
$$;

-- Private contact remains in applications. Existing specialists.public_contact
-- values are retained but no longer updated or exposed by the public contract.
create or replace function public.publish_approved_application(application_uuid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare app public.applications; existing_id uuid; legacy_services text[]; derived_mode text;
begin
  select * into app from public.applications where id = application_uuid;
  if not found or app.status <> 'approved' or app.owner_id is null then return; end if;
  legacy_services := public.work_offer_titles(app.work_offers);
  if cardinality(legacy_services) = 0 then legacy_services := array_remove(regexp_split_to_array(app.services, E'\\n'), ''); end if;
  derived_mode := public.work_offer_mode(app.work_offers, 'both');
  select id into existing_id from public.specialists where owner_id = app.owner_id limit 1;
  if existing_id is not null then
    update public.specialists set
      contract_version = app.contract_version,
      application_id = app.id,
      full_name = app.full_name,
      country = app.country,
      city = app.city,
      category_id = app.category_id,
      additional_category_ids = coalesce(app.additional_category_ids, '{}'),
      specialization = app.specialization,
      experience_years = app.experience_years,
      profile_summary = app.profile_summary,
      short_description = app.profile_summary,
      full_description = app.description,
      help_topics = app.help_topics,
      work_offers = app.work_offers,
      services = legacy_services,
      service_mode = derived_mode,
      portfolio_links = case when app.links is null then portfolio_links else array_remove(regexp_split_to_array(app.links, E'\\n'), '') end,
      avatar_path = coalesce(app.main_image_path, avatar_path),
      gallery_paths = case when cardinality(app.gallery_paths) = 0 then gallery_paths else app.gallery_paths end,
      video_links = case when cardinality(app.video_links) = 0 then video_links else app.video_links end,
      recommendations = coalesce(app.recommendations, recommendations),
      status = 'published',
      published_at = now(),
      updated_at = now()
    where id = existing_id;
  else
    insert into public.specialists (
      contract_version, application_id, owner_id, slug, full_name, country, city, category_id, additional_category_ids,
      specialization, experience_years, profile_summary, short_description, full_description,
      help_topics, work_offers, services, service_mode, portfolio_links, avatar_path,
      gallery_paths, video_links, recommendations, status, published_at
    ) values (
      app.contract_version, app.id, app.owner_id, 'profile-' || left(app.id::text, 8), app.full_name, app.country, app.city,
      app.category_id, coalesce(app.additional_category_ids, '{}'), app.specialization, app.experience_years,
      app.profile_summary, app.profile_summary, app.description, app.help_topics, app.work_offers,
      legacy_services, derived_mode,
      case when app.links is null then '{}' else array_remove(regexp_split_to_array(app.links, E'\\n'), '') end,
      app.main_image_path, coalesce(app.gallery_paths, '{}'), coalesce(app.video_links, '{}'),
      app.recommendations, 'published', now()
    );
  end if;
end;
$$;
revoke all on function public.publish_approved_application(uuid) from public, anon, authenticated;
grant execute on function public.publish_approved_application(uuid) to service_role;

-- The status trigger is the only browser-originated publication entry point.
-- Keep both trigger functions outside the PostgREST RPC surface.
revoke all on function public.publish_after_application_approval() from public, anon, authenticated;
grant execute on function public.publish_after_application_approval() to service_role;

-- Media paths are accepted only when the object exists and belongs to the
-- profile owner. Modern uploads and the owner-scoped legacy format are both
-- retained. A legacy path whose historical owner segment no longer matches
-- the row can only be reused when that same row owner already references it.
create or replace function public.assert_owned_profile_media_path(p_owner uuid, p_path text)
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  if p_path is null then return; end if;
  if p_owner is null then
    raise exception 'A profile image must have an owner';
  end if;

  if p_path ~ ('^submissions/' || p_owner::text || '/(avatar|gallery)/[a-f0-9-]{36}\.webp$')
     and exists (
       select 1 from storage.objects
       where bucket_id = 'profile-media' and name = p_path
     ) then
    return;
  end if;

  if p_path ~ ('^submissions/' || p_owner::text || '/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$')
     and exists (
       select 1 from storage.objects
       where bucket_id = 'profile-media' and name = p_path
     ) then
    return;
  end if;

  if (
       p_path ~ '^submissions/[a-f0-9-]{36}/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
       or p_path ~ '^submissions/(main|gallery-[0-9]+)-[a-f0-9-]{36}\.(png|jpe?g|webp)$'
     )
     and exists (
       select 1 from storage.objects
       where bucket_id = 'profile-media' and name = p_path
     )
     and (
       exists (
         select 1 from public.applications
         where owner_id = p_owner
           and (main_image_path = p_path or gallery_paths @> array[p_path]::text[])
       )
       or exists (
         select 1 from public.specialists
         where owner_id = p_owner
           and (avatar_path = p_path or gallery_paths @> array[p_path]::text[])
       )
       or exists (
         select 1 from public.specialist_revisions
         where owner_id = p_owner
           and (
             payload->>'avatar_path' = p_path
             or coalesce(payload->'gallery_paths', '[]'::jsonb) @> jsonb_build_array(p_path)
           )
       )
     ) then
    return;
  end if;

  raise exception 'A profile image must be an existing file owned by the profile owner';
end;
$$;
revoke all on function public.assert_owned_profile_media_path(uuid, text) from public, anon, authenticated;

create or replace function public.guard_application_media_ownership()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare p text;
begin
  if new.owner_id is null then return new; end if;
  perform public.assert_owned_profile_media_path(new.owner_id, new.main_image_path);
  foreach p in array coalesce(new.gallery_paths, '{}'::text[]) loop
    perform public.assert_owned_profile_media_path(new.owner_id, p);
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_application_media_ownership() from public, anon, authenticated;
drop trigger if exists applications_guard_media_ownership on public.applications;
create trigger applications_guard_media_ownership
before insert or update of owner_id, main_image_path, gallery_paths on public.applications
for each row execute function public.guard_application_media_ownership();

-- Version 2 revisions contain only user-provided fields. Legacy revisions stay
-- readable and may still be decided using the former payload contract.
create or replace function public.guard_specialist_revision_payload()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare element jsonb; p text; disallowed jsonb;
begin
  if jsonb_typeof(new.payload) <> 'object' then raise exception 'Revision payload must be an object'; end if;
  if new.payload->>'contract_version' = '2' then
    disallowed := new.payload - array[
      'contract_version','full_name','country','city','category_id','additional_category_ids',
      'specialization','experience_years','profile_summary','full_description','help_topics',
      'work_offers','avatar_path'
    ]::text[];
    if disallowed <> '{}'::jsonb then raise exception 'Revision contains fields outside the owner-editable contract'; end if;
    if jsonb_typeof(new.payload->'full_name') is distinct from 'string' or char_length(trim(new.payload->>'full_name')) not between 3 and 140 then raise exception 'Revision name is invalid'; end if;
    if jsonb_typeof(new.payload->'country') is distinct from 'string' or char_length(trim(new.payload->>'country')) not between 2 and 100 then raise exception 'Revision country is invalid'; end if;
    if jsonb_typeof(new.payload->'city') is distinct from 'string' or char_length(trim(new.payload->>'city')) not between 2 and 100 then raise exception 'Revision city is invalid'; end if;
    if jsonb_typeof(new.payload->'category_id') is distinct from 'string' or (new.payload->>'category_id') !~* '^[a-f0-9-]{36}$' then raise exception 'Revision category is invalid'; end if;
    if jsonb_typeof(new.payload->'additional_category_ids') is distinct from 'array' or jsonb_array_length(new.payload->'additional_category_ids') > 8 then raise exception 'Revision additional categories are invalid'; end if;
    for element in select value from jsonb_array_elements(new.payload->'additional_category_ids') loop
      if jsonb_typeof(element) <> 'string' or (element #>> '{}') !~* '^[a-f0-9-]{36}$' then raise exception 'Revision additional category is invalid'; end if;
    end loop;
    if jsonb_typeof(new.payload->'specialization') is distinct from 'string' or char_length(trim(new.payload->>'specialization')) not between 2 and 240 then raise exception 'Revision specialization is invalid'; end if;
    if jsonb_typeof(new.payload->'experience_years') is distinct from 'number' or (new.payload->>'experience_years') !~ '^(0|[1-9]|[1-7][0-9]|80)$' then raise exception 'Revision experience is invalid'; end if;
    if jsonb_typeof(new.payload->'profile_summary') is distinct from 'string' or char_length(trim(new.payload->>'profile_summary')) not between 1 and 220 then raise exception 'Revision summary is invalid'; end if;
    if jsonb_typeof(new.payload->'full_description') is distinct from 'string' or char_length(trim(new.payload->>'full_description')) not between 50 and 3000 then raise exception 'Revision description is invalid'; end if;
    if not public.is_valid_help_topics(new.payload->'help_topics') or jsonb_array_length(new.payload->'help_topics') < 1 then raise exception 'Revision help topics are invalid'; end if;
    if not public.is_valid_work_offers(new.payload->'work_offers') or jsonb_array_length(new.payload->'work_offers') < 1 then raise exception 'Revision work offers are invalid'; end if;
    if jsonb_typeof(new.payload->'avatar_path') is distinct from 'string' then raise exception 'Revision avatar path is invalid'; end if;
    perform public.assert_owned_profile_media_path(new.owner_id, nullif(new.payload->>'avatar_path', ''));
    return new;
  end if;

  -- Backward-compatible validation for already saved version 1 payloads.
  if jsonb_typeof(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) > 10 then raise exception 'Revision gallery is invalid'; end if;
  if jsonb_typeof(coalesce(new.payload->'services', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(new.payload->'services', '[]'::jsonb)) > 80 then raise exception 'Revision services are invalid'; end if;
  if new.payload ? 'avatar_path' and jsonb_typeof(new.payload->'avatar_path') not in ('string', 'null') then raise exception 'Revision avatar path is invalid'; end if;
  perform public.assert_owned_profile_media_path(new.owner_id, nullif(new.payload->>'avatar_path', ''));
  for element in select value from jsonb_array_elements(coalesce(new.payload->'gallery_paths', '[]'::jsonb)) loop
    if jsonb_typeof(element) <> 'string' then raise exception 'Revision gallery path is invalid'; end if;
    p := trim(both '"' from element::text);
    perform public.assert_owned_profile_media_path(new.owner_id, p);
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_specialist_revision_payload() from public, anon, authenticated;
drop trigger if exists specialist_revisions_guard_payload on public.specialist_revisions;
create trigger specialist_revisions_guard_payload
before insert or update of owner_id, payload on public.specialist_revisions
for each row execute function public.guard_specialist_revision_payload();

create or replace function public.apply_specialist_revision(revision_uuid uuid, approve boolean, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.specialist_revisions; p jsonb; reviewer uuid := auth.uid(); offers jsonb; legacy_services text[];
begin
  if reviewer is null or not public.is_moderator() then raise exception 'Only moderators can decide profile revisions'; end if;
  if not approve and coalesce(length(trim(note)), 0) = 0 then raise exception 'A rejection comment is required'; end if;
  select * into r from public.specialist_revisions where id = revision_uuid for update;
  if not found then raise exception 'Revision not found'; end if;
  if r.status <> 'pending' then raise exception 'Revision has already been decided'; end if;
  p := r.payload;
  if approve and p->>'contract_version' = '2' then
    offers := p->'work_offers';
    legacy_services := public.work_offer_titles(offers);
    update public.specialists set
      contract_version = 2,
      full_name = coalesce(nullif(p->>'full_name', ''), full_name),
      country = coalesce(nullif(p->>'country', ''), country),
      city = coalesce(nullif(p->>'city', ''), city),
      category_id = case when nullif(p->>'category_id', '') is null then category_id else (p->>'category_id')::uuid end,
      additional_category_ids = coalesce(array(select jsonb_array_elements_text(coalesce(p->'additional_category_ids', '[]'::jsonb))::uuid), '{}'::uuid[]),
      specialization = nullif(p->>'specialization', ''),
      experience_years = (p->>'experience_years')::integer,
      profile_summary = p->>'profile_summary',
      short_description = p->>'profile_summary',
      full_description = p->>'full_description',
      help_topics = p->'help_topics',
      work_offers = offers,
      services = legacy_services,
      service_mode = public.work_offer_mode(offers, service_mode),
      avatar_path = p->>'avatar_path',
      status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
    where id = r.specialist_id and owner_id = r.owner_id;
  elsif approve then
    update public.specialists set
      full_name = coalesce(nullif(p->>'full_name',''), full_name),
      country = coalesce(nullif(p->>'country',''), country),
      city = coalesce(nullif(p->>'city',''), city),
      service_mode = coalesce(nullif(p->>'service_mode',''), service_mode),
      category_id = case when nullif(p->>'category_id','') is null then category_id else (p->>'category_id')::uuid end,
      additional_category_ids = coalesce(array(select jsonb_array_elements_text(coalesce(p->'additional_category_ids','[]'::jsonb))::uuid), additional_category_ids),
      specialization = coalesce(nullif(p->>'specialization',''), specialization),
      experience_years = case when nullif(p->>'experience_years','') is null then experience_years else (p->>'experience_years')::integer end,
      services = coalesce(array(select jsonb_array_elements_text(coalesce(p->'services', to_jsonb(services)))), services),
      profile_summary = coalesce(nullif(p->>'profile_summary',''), nullif(p->>'short_description',''), profile_summary),
      short_description = coalesce(nullif(p->>'short_description',''), short_description),
      full_description = coalesce(nullif(p->>'full_description',''), full_description),
      help_topics = coalesce(p->'help_topics', help_topics),
      work_offers = coalesce(p->'work_offers', work_offers),
      public_contact = coalesce(nullif(p->>'public_contact',''), public_contact),
      portfolio_links = coalesce(array(select jsonb_array_elements_text(coalesce(p->'portfolio_links', to_jsonb(portfolio_links)))), portfolio_links),
      video_links = coalesce(array(select jsonb_array_elements_text(coalesce(p->'video_links', to_jsonb(video_links)))), video_links),
      avatar_path = coalesce(nullif(p->>'avatar_path',''), avatar_path),
      gallery_paths = coalesce(array(select jsonb_array_elements_text(coalesce(p->'gallery_paths', to_jsonb(gallery_paths)))), gallery_paths),
      recommendations = coalesce(nullif(p->>'recommendations',''), recommendations),
      status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
    where id = r.specialist_id and owner_id = r.owner_id;
  end if;
  if approve and not found then raise exception 'The public profile does not belong to this revision owner'; end if;
  update public.specialist_revisions set
    status = case when approve then 'approved' else 'rejected' end,
    moderator_id = reviewer,
    moderator_comment = nullif(trim(note), ''),
    decided_at = now()
  where id = r.id;
end;
$$;
revoke all on function public.apply_specialist_revision(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.apply_specialist_revision(uuid, boolean, text) to authenticated;

-- Only owner and moderators may read the source table directly. All public
-- routes use this explicit representation, which has no contact or owner data.
drop policy if exists "Public reads published specialists" on public.specialists;
revoke all on public.specialists from anon;

create or replace view public.published_specialists
with (security_barrier = true, security_invoker = false) as
  select specialist.id,
         specialist.slug,
         specialist.full_name,
         specialist.country,
         specialist.city,
         specialist.category_id,
         category.name as category_name,
         category.slug as category_slug,
         specialist.additional_category_ids,
         specialist.specialization,
         specialist.service_mode,
         specialist.experience_years,
         specialist.profile_summary,
         specialist.full_description,
         specialist.help_topics,
         specialist.work_offers,
         specialist.avatar_path,
         specialist.published_at
  from public.specialists as specialist
  left join public.categories as category on category.id = specialist.category_id
  where specialist.status = 'published';
revoke all on public.published_specialists from public, anon, authenticated;
grant select on public.published_specialists to anon, authenticated;

-- The public review representation is read-only. Moderation continues through
-- the RLS-protected base table public.reviews.
revoke all on public.published_reviews from public, anon, authenticated;
grant select on public.published_reviews to anon, authenticated;

-- Verification facts are independent from publication. Nothing is backfilled
-- from legacy badges or verified_at timestamps because that would invent proof.
alter table public.verifications
  add column if not exists education_checked boolean not null default false,
  add column if not exists experience_checked boolean not null default false,
  add column if not exists qualifications_checked boolean not null default false,
  add column if not exists sources_checked smallint not null default 0,
  add column if not exists checked_at timestamptz;
alter table public.verifications drop constraint if exists verifications_sources_checked_check;
alter table public.verifications add constraint verifications_sources_checked_check check (sources_checked between 0 and 1000);
create unique index if not exists verifications_one_per_specialist on public.verifications(specialist_id);

drop policy if exists "Moderators read verifications" on public.verifications;
drop policy if exists "Moderators manage verifications" on public.verifications;
create policy "Moderators read verifications" on public.verifications for select to authenticated using (public.is_moderator());
create policy "Moderators manage verifications" on public.verifications for all to authenticated using (public.is_moderator()) with check (public.is_moderator());

create or replace view public.published_specialist_verification_facts
with (security_barrier = true, security_invoker = false) as
  select verification.specialist_id,
         verification.identity_checked,
         verification.education_checked,
         verification.experience_checked,
         verification.qualifications_checked,
         verification.references_checked,
         verification.sources_checked,
         verification.checked_at
  from public.verifications as verification
  join public.specialists as specialist on specialist.id = verification.specialist_id
  where specialist.status = 'published'
    and verification.checked_at is not null
    and (
      verification.identity_checked
      or verification.education_checked
      or verification.experience_checked
      or verification.qualifications_checked
      or verification.references_checked
    );
revoke all on public.published_specialist_verification_facts from public, anon, authenticated;
grant select on public.published_specialist_verification_facts to anon, authenticated;

-- Publication alone is not verification. Keep existing assignments for audit
-- history, but stop creating new ones and omit the legacy `verified` badge
-- from the public badge representation. The Trust Mark now comes from facts.
drop trigger if exists specialists_sync_verified_badge on public.specialists;
create or replace view public.published_specialist_trust_badges
with (security_barrier = true, security_invoker = false) as
  select assignment.id, assignment.specialist_id, assignment.badge_id,
         assignment.source, assignment.assigned_at
  from public.specialist_trust_badges as assignment
  join public.specialists as specialist on specialist.id = assignment.specialist_id
  join public.trust_badges as badge on badge.id = assignment.badge_id
  where specialist.status = 'published'
    and badge.is_active = true
    and badge.code <> 'verified';
revoke all on public.published_specialist_trust_badges from public, anon, authenticated;
grant select on public.published_specialist_trust_badges to anon, authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- PROVENANCE SOURCE: 20260808172951_harden_email_rpc_acl.sql
-- ============================================================================

-- Keep the transactional email outbox callable only by the trusted server worker.
-- PostgreSQL function privilege changes are transactional under the migration runner.
revoke execute on function public.claim_email_notifications(integer)
  from public, anon, authenticated;

revoke execute on function public.enqueue_email_notification(
  text, uuid, text, uuid, uuid, uuid, text, jsonb, text
)
  from public, anon, authenticated;

grant execute on function public.claim_email_notifications(integer)
  to service_role;

grant execute on function public.enqueue_email_notification(
  text, uuid, text, uuid, uuid, uuid, text, jsonb, text
)
  to service_role;


-- ============================================================================
-- PROVENANCE SOURCE: 20260808212241_fix_email_notification_recipient_regex.sql
-- ============================================================================

-- Accept ordinary email addresses without changing queue behavior or RPC ACL.
-- With standard_conforming_strings=on, a single backslash is the correct
-- PostgreSQL regex escape for a literal dot.
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
set search_path = public
as $$
declare
  result_id uuid;
  safe_key text;
begin
  if p_recipient_email is null
    or p_recipient_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    return null;
  end if;

  safe_key := coalesce(
    nullif(trim(p_idempotency_key), ''),
    p_event_type || ':' || coalesce(
      p_application_id::text,
      p_revision_id::text,
      p_specialist_id::text,
      p_user_id::text
    )
  );

  insert into public.email_notifications(
    event_type,
    user_id,
    recipient_email,
    application_id,
    revision_id,
    specialist_id,
    subject,
    template_data,
    idempotency_key
  )
  values (
    p_event_type,
    p_user_id,
    lower(trim(p_recipient_email)),
    p_application_id,
    p_revision_id,
    p_specialist_id,
    left(coalesce(p_subject, 'Аманат'), 300),
    coalesce(p_template_data, '{}'::jsonb),
    safe_key
  )
  on conflict (idempotency_key) do nothing
  returning id into result_id;

  return result_id;
end;
$$;


-- ============================================================================
-- PROVENANCE SOURCE: 20260809001646_enforce_server_only_specialist_writes.sql
-- ============================================================================

-- User-originated specialist data writes are accepted only by authenticated
-- Next.js server handlers. The browser keeps owner SELECT access, while the
-- service_role performs validated writes after the server proves ownership.

-- Remove every public Data API write grant. Revoking PUBLIC as well as the two
-- API roles prevents an inherited privilege from keeping the endpoint writable.
revoke insert, update, delete on table public.applications
  from public, anon, authenticated;
revoke insert, update, delete on table public.specialist_revisions
  from public, anon, authenticated;

-- Owner SELECT policies remain intact for Cabinet/Application reads. Owner
-- write policies are removed so an accidental future table GRANT alone cannot
-- reopen the bypass.
drop policy if exists "Authenticated owners submit applications" on public.applications;
drop policy if exists "Authenticated users submit their own applications" on public.applications;
drop policy if exists "Anonymous users submit unowned applications" on public.applications;
drop policy if exists "Anyone submits application" on public.applications;
drop policy if exists "Owners update own applications" on public.applications;

drop policy if exists "Owners create own revisions" on public.specialist_revisions;
drop policy if exists "Owners update pending revisions" on public.specialist_revisions;

-- Defense in depth for internal/service-role code: old v1 rows remain readable
-- and status-only moderation updates remain possible, but every new row and
-- every update of applicant-controlled content must use contract version 2.
create or replace function public.require_application_contract_v2_on_content_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.contract_version is distinct from 2 then
      raise exception 'New applications must use contract version 2';
    end if;
    return new;
  end if;

  if new.contract_version is distinct from old.contract_version
     and new.contract_version is distinct from 2 then
    raise exception 'Changed application contract version must be 2';
  end if;

  if row(
    new.full_name, new.contact, new.country, new.city, new.category_text,
    new.category_id, new.additional_category_ids, new.specialization,
    new.experience_years, new.profile_summary, new.description,
    new.help_topics, new.work_offers, new.services, new.links,
    new.recommendations, new.main_image_path, new.gallery_paths,
    new.video_links, new.consent_truthful, new.consent_personal_data
  ) is distinct from row(
    old.full_name, old.contact, old.country, old.city, old.category_text,
    old.category_id, old.additional_category_ids, old.specialization,
    old.experience_years, old.profile_summary, old.description,
    old.help_topics, old.work_offers, old.services, old.links,
    old.recommendations, old.main_image_path, old.gallery_paths,
    old.video_links, old.consent_truthful, old.consent_personal_data
  ) and new.contract_version is distinct from 2 then
    raise exception 'Changed application content must use contract version 2';
  end if;

  return new;
end;
$$;
revoke all on function public.require_application_contract_v2_on_content_write()
  from public, anon, authenticated;
drop trigger if exists applications_require_contract_v2_on_content_write
  on public.applications;
create trigger applications_require_contract_v2_on_content_write
before insert or update on public.applications
for each row execute function public.require_application_contract_v2_on_content_write();

create or replace function public.require_revision_contract_v2_on_payload_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if jsonb_typeof(new.payload) is distinct from 'object'
       or new.payload->>'contract_version' is distinct from '2' then
      raise exception 'New revision payloads must use contract version 2';
    end if;
  elsif new.payload is distinct from old.payload then
    if jsonb_typeof(new.payload) is distinct from 'object'
       or new.payload->>'contract_version' is distinct from '2' then
      raise exception 'Changed revision payloads must use contract version 2';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.require_revision_contract_v2_on_payload_write()
  from public, anon, authenticated;
drop trigger if exists specialist_revisions_require_contract_v2_on_payload_write
  on public.specialist_revisions;
create trigger specialist_revisions_require_contract_v2_on_payload_write
before insert or update of payload on public.specialist_revisions
for each row execute function public.require_revision_contract_v2_on_payload_write();


-- ============================================================================
-- PROVENANCE SOURCE: LIVE DRIFT FIDELITY (EXPLICIT PRE-HARDENING FINDINGS)
-- ============================================================================

-- KNOWN_SECURITY_FINDING: SEC-025.
-- Live catalog evidence confirms that owner UPDATE returned after the tracked
-- DROP. Reproduce it only in the pre-hardening baseline for regression proof.
drop policy if exists "Users update own account profile" on public.account_profiles;
create policy "Users update own account profile"
on public.account_profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- KNOWN_SECURITY_FINDING: SEC-001, SEC-017.
-- Live bucket metadata permits JPEG, PNG, and WebP despite the tracked
-- WebP-only assignment. No objects are created.
update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'profile-media';

-- KNOWN_SECURITY_FINDING: SEC-018.
-- Live catalog evidence retains a direct moderator audit INSERT boundary.
drop policy if exists "Moderators write own audit entries" on public.audit_log;
drop policy if exists "Moderator writes audit" on public.audit_log;
create policy "Moderator writes audit"
on public.audit_log for insert to authenticated
with check (public.is_moderator());


commit;
