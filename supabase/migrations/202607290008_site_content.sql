create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.moderators where user_id=auth.uid() and role='admin');
$$;

create table if not exists public.site_content (
  id boolean primary key default true check (id),
  brand_name text not null default 'AL-AMIN' check (char_length(brand_name) between 2 and 80),
  tagline text not null default 'Найдите специалиста, которому можно доверять.' check (char_length(tagline) between 2 and 240),
  hero_title text not null default 'Найдите специалиста, которому можно доверять.' check (char_length(hero_title) between 2 and 240),
  hero_text text not null default 'Бесплатное пространство, где мусульмане находят специалистов и выстраивают сотрудничество на основе ответственности и доверия.' check (char_length(hero_text) between 2 and 1000),
  contact_email text not null default 'al-amin@ailvi.ru' check (char_length(contact_email) between 3 and 320),
  about_text text not null default 'Мы помогаем мусульманам находить друг друга, укреплять экономические связи внутри Уммы и создавать культуру, где честность ценится не меньше профессионализма.' check (char_length(about_text) between 2 and 5000),
  rules_intro text not null default 'Платформа знакомит людей и фиксирует прохождение процедуры проверки. Платформа не принимает оплату за услуги и не выступает стороной сделки.' check (char_length(rules_intro) between 2 and 5000),
  privacy_text text not null default 'Мы используем данные анкеты только для рассмотрения кандидатуры, связи с заявителем и последующего ведения профиля при одобрении.' check (char_length(privacy_text) between 2 and 5000),
  seo_title text not null default 'AL-AMIN — найдите специалиста, которому можно доверять' check (char_length(seo_title) between 2 and 160),
  seo_description text not null default 'AL-AMIN — каталог проверенных специалистов.' check (char_length(seo_description) between 2 and 320),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.site_content (id) values (true) on conflict (id) do nothing;
alter table public.site_content enable row level security;
drop policy if exists "Public reads site content" on public.site_content;
create policy "Public reads site content" on public.site_content for select using (true);
drop policy if exists "Admins update site content" on public.site_content;
create policy "Admins update site content" on public.site_content for update using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_site_content()
returns trigger language plpgsql as $$ begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists touch_site_content on public.site_content;
create trigger touch_site_content before update on public.site_content for each row execute function public.touch_site_content();
