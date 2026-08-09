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
