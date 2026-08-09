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
