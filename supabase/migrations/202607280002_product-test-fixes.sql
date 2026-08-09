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

insert into public.categories (name, slug) values
  ('IT и разработка ПО','it-software'),('Разработка сайтов','web-development-services'),('Мобильные приложения','mobile-apps'),('Дизайн','design-services'),('Маркетинг и реклама','marketing'),('Фото и видео','photo-video'),('Монтаж и озвучка','editing-voice'),('Тексты и переводы','copywriting-translation'),('Образование и репетиторство','education-tutoring'),('Юридические услуги','legal-services'),('Бухгалтерия и финансы','finance-accounting'),('Строительство и ремонт','construction-repair'),('Архитектура и интерьер','architecture-interior'),('Электрика','electrical'),('Сантехника','plumbing'),('Автомобили','automotive'),('Логистика','logistics'),('Производство','manufacturing'),('Торговля','retail'),('Недвижимость','real-estate'),('Консалтинг','consulting'),('Красота и уход','beauty-care'),('Питание и кондитерское дело','food-confectionery'),('Организация мероприятий','events'),('Бытовые услуги','household-services')
on conflict do nothing;

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

select public.publish_approved_application(id) from public.applications where status = 'approved';
