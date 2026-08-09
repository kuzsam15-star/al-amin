-- Keep the transactional email outbox callable only by the trusted server worker.
-- PostgreSQL function privilege changes are transactional under the migration runner.
revoke execute on function public.claim_email_notifications(integer)
  from public, anon, authenticated;

revoke execute on function public.enqueue_email_notification(
  text, uuid, text, uuid, uuid, uuid, text, jsonb, text
)
  from public, anon, authenticated;

grant execute on function public.claim_email_notifications(integer)
  to service_role;

grant execute on function public.enqueue_email_notification(
  text, uuid, text, uuid, uuid, uuid, text, jsonb, text
)
  to service_role;
