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

insert into public.trust_badges (code, title, description, icon, assignment_type, is_active, sort_order) values
  ('verified', 'Проверен', 'Личность и основные данные специалиста подтверждены модерацией AL-AMIN. Это не является гарантией качества будущих услуг.', 'badge-check', 'automatic', true, 1),
  ('documents_verified', 'Документы подтверждены', 'Модератор проверил предоставленные специалистом документы, дипломы или сертификаты.', 'file-check', 'manual', true, 2),
  ('high_rating', 'Высокий рейтинг', 'Значок присваивается на основании отзывов пользователей и рассчитанного рейтинга.', 'star', 'automatic', false, 3),
  ('quick_response', 'Быстро отвечает', 'Специалист обычно отвечает пользователям быстрее установленного платформой срока.', 'zap', 'automatic', false, 4),
  ('supports_project', 'Поддерживает проект', 'Специалист добровольно помогает развитию AL-AMIN. Поддержка не влияет на позицию в каталоге, поиск, рекомендации или выдачу.', 'hand-heart', 'manual', true, 5)
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  icon = excluded.icon,
  assignment_type = excluded.assignment_type,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

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

insert into public.specialist_trust_badges (specialist_id, badge_id, assigned_by, source, admin_note)
select s.id, b.id, null, 'automatic', null
from public.specialists s
join public.trust_badges b on b.code = 'verified'
where s.status = 'published'
on conflict (specialist_id, badge_id) do update set source = 'automatic', assigned_by = null, admin_note = null;
