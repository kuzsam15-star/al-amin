import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("transactional outbox has idempotency, server-only delivery and owner-safe RLS", async () => {
  const [migration, queue, provider, worker] = await Promise.all([
    read("supabase/migrations/202607290004_email_notifications.sql"),
    read("src/lib/email/queue.ts"),
    read("src/lib/email/provider.ts"),
    read("src/app/api/internal/email-worker/route.ts"),
  ]);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /Owners read own email notifications[\s\S]*user_id=auth\.uid\(\)/);
  assert.match(migration, /Moderators read email notifications[\s\S]*public\.is_moderator\(\)/);
  assert.match(migration, /claim_email_notifications[\s\S]*skip locked/i);
  assert.match(migration, /status='failed' and attempts<3/);
  assert.match(queue, /createSupabaseAdminClient/);
  assert.match(provider, /process\.env\.UNISENDER_GO_API_KEY/);
  assert.match(provider, /goapi\.unisender\.ru/);
  assert.doesNotMatch(provider, /NEXT_PUBLIC_.*UNISENDER_GO_API_KEY/);
  assert.match(worker, /authorization/);
});

test("email queue RPCs are executable only by the trusted service role", async () => {
  const migration = await read("supabase/migrations/20260808172951_harden_email_rpc_acl.sql");
  assert.match(migration, /revoke execute on function public\.claim_email_notifications\(integer\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /revoke execute on function public\.enqueue_email_notification\([\s\S]*text, uuid, text, uuid, uuid, uuid, text, jsonb, text[\s\S]*\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.claim_email_notifications\(integer\)[\s\S]*to service_role/i);
  assert.match(migration, /grant execute on function public\.enqueue_email_notification\([\s\S]*text, uuid, text, uuid, uuid, uuid, text, jsonb, text[\s\S]*\)[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /alter function|security invoker|security definer|grant all|alter table|drop function/i);
});

test("email queue recipient validation uses a PostgreSQL-safe literal dot", async () => {
  const migration = await read("supabase/migrations/20260808212241_fix_email_notification_recipient_regex.sql");
  const recipientPattern = migration.match(/p_recipient_email !~\* '([^']+)'/)?.[1];

  assert.equal(recipientPattern, "^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$");
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = public/i);
  assert.doesNotMatch(migration, /grant|revoke|alter table|drop function/i);
});

test("confirmation emails can be resent without exposing an auth secret", async () => {
  const [actions, page, login] = await Promise.all([
    read("src/app/register/actions.ts"),
    read("src/app/resend-confirmation/page.tsx"),
    read("src/app/login/page.tsx"),
  ]);
  assert.match(actions, /auth\.resend/);
  assert.match(actions, /confirmationRequests/);
  assert.match(page, /resendConfirmation/);
  assert.match(login, /resend-confirmation/);
});

test("email events are deduplicated and never contain moderator internal notes", async () => {
  const [migration, templates, actions] = await Promise.all([
    read("supabase/migrations/202607290004_email_notifications.sql"),
    read("src/lib/email/templates.ts"),
    read("src/app/admin/actions.ts"),
  ]);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/i);
  assert.match(migration, /application_changes_requested/);
  assert.match(migration, /revision_changes_requested/);
  assert.match(templates, /message/);
  assert.doesNotMatch(templates, /internal_notes/);
  assert.match(actions, /processEmailQueue\(5\)\.catch/);
});

test("specialization has its own visual line and never falls back to category", async () => {
  const [card, homeLoader, profile, civicProfile] = await Promise.all([
    read("src/components/SpecialistCard.tsx"),
    read("src/lib/civic-home.ts"),
    read("src/app/specialists/[slug]/page.tsx"),
    read("src/components/civic/CivicPublicProfile.tsx"),
  ]);
  assert.match(card, /specialist-specialization/);
  assert.match(card, /item\.specialization\?\.trim\(\)/);
  assert.match(homeLoader, /specialization/);
  assert.match(profile, /CivicPublicProfile/);
  assert.match(civicProfile, /styles\.specialization/);
  assert.doesNotMatch(card, /category\?\.name/);
});

test("public brand and transactional sender are configured independently of internal identifiers", async () => {
  const [brand, layout, home, civicHome, provider, templates, manifest, migration, admin] = await Promise.all([
    read("src/lib/brand.ts"), read("src/app/layout.tsx"), read("src/app/page.tsx"), read("src/components/civic/CivicHome.tsx"), read("src/lib/email/provider.ts"),
    read("src/lib/email/templates.ts"), read("src/app/manifest.ts"), read("supabase/migrations/202607290008_site_content.sql"), read("src/app/admin/actions.ts"),
  ]);
  assert.match(brand, /AL-AMIN/);
  assert.match(brand, /Найдите специалиста, которому можно доверять/);
  assert.match(layout, /content\.brand_name/);
  assert.match(home, /getSiteContent/);
  assert.match(civicHome, /content\.hero_title/);
  assert.match(provider, /EMAIL_FROM/);
  assert.match(provider, /EMAIL_REPLY_TO/);
  assert.match(provider, /replaceAll\("Аманат", brand\.name\)/);
  assert.match(templates, /brand\.name/);
  assert.match(manifest, /brand\.name/);
  assert.match(migration, /create table if not exists public\.site_content/);
  assert.match(migration, /Admins update site content/);
  assert.match(admin, /requireAdmin\(\)/);
  assert.match(admin, /updateSiteContent/);
});
