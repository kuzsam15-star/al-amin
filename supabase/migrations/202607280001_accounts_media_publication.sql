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
insert into public.account_profiles (id,email,display_name,avatar_url)
select id,email,coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name'),raw_user_meta_data->>'avatar_url' from auth.users
on conflict (id) do nothing;

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

select public.publish_approved_application(id) from public.applications where status='approved' and owner_id is not null;
