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
