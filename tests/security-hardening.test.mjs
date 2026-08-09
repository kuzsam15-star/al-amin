import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("authentication redirects accept local paths only", async () => {
  const [navigation, callback, login, register] = await Promise.all([
    read("src/lib/navigation.ts"), read("src/app/auth/callback/route.ts"),
    read("src/app/login/actions.ts"), read("src/app/register/actions.ts"),
  ]);
  assert.match(navigation, /candidate\.startsWith\("\/\/"\)/);
  assert.match(navigation, /candidate\.includes\("\\\\"\)/);
  assert.match(callback, /safeNextPath/);
  assert.match(login, /safeNextPath/);
  assert.match(register, /safeNextPath/);
});

test("draft media is private and served only through the authorization route", async () => {
  const [migration, view, media, paths] = await Promise.all([
    read("supabase/migrations/202607300001_security_hardening.sql"),
    read("src/app/api/media/view/route.ts"), read("src/app/api/media/route.ts"), read("src/lib/media-paths.ts"),
  ]);
  assert.match(migration, /set public = false/);
  assert.match(migration, /drop policy if exists "Public reads profile media"/);
  assert.match(migration, /Owners read own submission media/);
  assert.match(migration, /assert_owned_profile_media_path/);
  assert.match(view, /publicAccess/);
  assert.match(view, /private, no-store/);
  assert.match(view, /isProfileMediaPath/);
  assert.match(media, /hasTrustedOrigin/);
  assert.match(paths, /legacyProfileMediaPattern/);
  assert.match(migration, /Backward compatibility/);
});

test("the standalone cloud patch keeps Storage private and exposes only safe views", async () => {
  const migration = await read("supabase/migrations/202607310001_security_hardening.sql");
  assert.match(migration, /set public = false/);
  assert.match(migration, /Owners upload own submission media/);
  assert.match(migration, /tablename in \('reviews', 'specialist_trust_badges'\)/);
  assert.match(migration, /create or replace view public\.published_reviews/);
  assert.match(migration, /create or replace view public\.published_specialist_trust_badges/);
  const publicViews = migration.slice(migration.indexOf("create or replace view public.published_reviews"));
  assert.doesNotMatch(publicViews, /author_contact|assigned_by|admin_note/);
});

test("privileged database paths cannot be called directly and audits retain the actor", async () => {
  const [migration, profile, badgeLoader] = await Promise.all([
    read("supabase/migrations/202607300001_security_hardening.sql"),
    read("src/app/specialists/[slug]/page.tsx"), read("src/lib/public-trust-badges.ts"),
  ]);
  assert.match(migration, /revoke all on function public\.publish_approved_application\(uuid\) from public/);
  assert.match(migration, /actor_id = auth\.uid\(\)/);
  assert.match(migration, /guard_specialist_revision_payload/);
  assert.match(migration, /drop policy if exists "Public reads approved reviews"/);
  assert.match(migration, /create or replace view public\.published_reviews/);
  assert.match(migration, /create or replace view public\.published_specialist_trust_badges/);
  assert.match(profile, /from\("published_reviews"\)/);
  assert.match(badgeLoader, /from\("published_specialist_trust_badges"\)/);
});

test("production headers deny framing, sniffing, and caching of private routes", async () => {
  const config = await read("next.config.mjs");
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /frame-ancestors 'none'/);
  assert.match(config, /X-Content-Type-Options/);
  assert.match(config, /Strict-Transport-Security/);
  assert.match(config, /\/cabinet\/:path\*/);
  assert.match(config, /private, no-store/);
});
