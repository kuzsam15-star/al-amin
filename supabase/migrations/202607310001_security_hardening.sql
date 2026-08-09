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
