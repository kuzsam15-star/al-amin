-- Permanent removal is limited to administrators. Published specialists are never
-- deleted by these policies or the corresponding server actions.
drop policy if exists "Admin deletes applications" on public.applications;
create policy "Admin deletes applications" on public.applications
for delete to authenticated using (public.is_admin());

drop policy if exists "Admin deletes specialist revisions" on public.specialist_revisions;
create policy "Admin deletes specialist revisions" on public.specialist_revisions
for delete to authenticated using (public.is_admin());
