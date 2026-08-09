-- Amanat MVP schema. Apply this file in the Supabase SQL editor to a new project.
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

-- Safe, removable demonstration data. Delete rows with demo.amah.* slugs before production.
insert into public.categories (name, slug) values
  ('Разработка сайтов','web-development'),('Бухгалтерия','accounting'),('Ремонт и строительство','construction'),
  ('Юридические услуги','legal'),('Дизайн','design'),('Образование','education') on conflict do nothing;
insert into public.specialists (slug, full_name, country, city, category_id, services, service_mode, experience_years, short_description, full_description, public_contact, portfolio_links, status, verified_at, verification_method, published_at)
select 'muhammad-abdullaev','Мухаммад Абдуллаев','Россия','Москва',id,array['Сайты для бизнеса','Технические консультации'],'online',7,'Создаю сайты и внутренние системы для малого бизнеса.','Работаю по понятному техническому заданию, согласовываю этапы и поддерживаю проект после запуска.','@amanat_demo',array['https://example.com'], 'published',now(),'Проверка личности и контактов',now() from public.categories where slug='web-development'
on conflict (slug) do nothing;

insert into public.specialists (slug, full_name, country, city, category_id, services, service_mode, experience_years, short_description, full_description, public_contact, status, verified_at, verification_method, published_at) values
('amina-safina','Амина Сафина','Россия','Казань',(select id from public.categories where slug='accounting'),array['Ведение учёта','Налоговые консультации'],'both',9,'Сопровождаю ИП и небольшие компании.','Помогаю выстроить понятный и своевременный учёт.', '@amina_demo','published',now(),'Проверка контактов и рекомендаций',now()),
('ibrahim-nuriev','Ибрахим Нуриев','Россия','Санкт-Петербург',(select id from public.categories where slug='construction'),array['Ремонт квартир','Смета и планирование'],'offline',11,'Веду ремонт с прозрачной сметой и этапами.','До начала работ согласовываю смету, сроки и материалы.', '@ibrahim_demo','published',now(),'Созвон и проверка контактов',now()),
('maryam-kadyrova','Марьям Кадырова','Россия','Грозный',(select id from public.categories where slug='legal'),array['Семейное право','Договоры'],'online',6,'Консультирую по договорам и семейным вопросам.','Объясняю варианты действий понятным языком и работаю по договору.', '@maryam_demo','published',now(),'Проверка личности и контактов',now()),
('yusuf-ramazanov','Юсуф Рамазанов','Казахстан','Алматы',(select id from public.categories where slug='design'),array['Айдентика','Дизайн презентаций'],'online',5,'Создаю визуальный стиль для небольших проектов.','Начинаю с брифа, согласовываю концепцию и готовлю материалы для передачи.', '@yusuf_demo','published',now(),'Проверка рекомендаций',now()),
('fatima-bekova','Фатима Бекова','Кыргызстан','Бишкек',(select id from public.categories where slug='education'),array['Арабский язык','Онлайн-занятия'],'both',8,'Преподаю арабский язык взрослым и подросткам.','Подбираю программу по цели и регулярно даю обратную связь.', '@fatima_demo','published',now(),'Созвон и проверка контактов',now())
on conflict (slug) do nothing;

insert into public.applications (full_name,contact,country,city,category_text,description,services,consent_truthful,consent_personal_data,status) values
('Рустам Хабибов','@rustam_demo','Россия','Москва','Ремонт и строительство','Демонстрационная заявка для проверки очереди модерации и статусов. Описывает опыт работы и подход к взаимодействию с заказчиком.','Сантехнические работы',true,true,'new'),
('Саида Каримова','@saida_demo','Россия','Казань','Дизайн','Демонстрационная заявка, ожидающая дополнительной информации от кандидата. Описание длиннее минимального порога и безопасно для seed.','Дизайн логотипов',true,true,'info_required'),
('Абдуллах Усманов','@abdullah_demo','Россия','Грозный','Юридические услуги','Демонстрационная заявка для сценария созвона. Сведения предназначены только для локального теста панели модерации.','Консультации по договорам',true,true,'call_required');
