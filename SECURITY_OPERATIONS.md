# Security operations — AL-AMIN

## Before every production release

1. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`.
2. Apply reviewed files from `supabase/migrations` in order and verify the migration history in **Supabase Dashboard → SQL Editor → History**.
3. In **Supabase Dashboard → Authentication → URL Configuration**, set Site URL to the production HTTPS origin and list only the exact local and production callback URLs required by `/auth/callback`.
4. In **Supabase Dashboard → Storage → profile-media**, confirm the bucket is private and policies allow only owner uploads plus the controlled application route for viewing.
5. Inspect response headers for `/`, `/cabinet` and `/admin`: CSP, `nosniff`, `DENY`, no-store on private paths, and HSTS over HTTPS.
6. Run the package-manager audit from an environment with registry access; do not use a forced mass upgrade.

## Public API verification

- Before release, verify that anonymous REST requests cannot read `reviews` or `specialist_trust_badges` directly.
- Confirm the two intentionally public views, `published_reviews` and `published_specialist_trust_badges`, return only their documented public columns.

## Credentials and access response

- If a Supabase service-role key, Unisender key, Google OAuth client secret or worker secret might be exposed, rotate it in its source dashboard immediately, update the protected hosting environment variable, redeploy, then invalidate old sessions where supported.
- To remove a compromised administrator: **Supabase Dashboard → Table Editor → moderators**; remove the matching `user_id`, then review `audit_log` and rotate credentials the person could access. Do not delete the auth user until evidence is preserved.
- Keep `.env.local` outside version control. `.env.example` may contain names and placeholders only.

## Backup and recovery

- Database: before launch, export a logical backup from **Supabase Dashboard → Database → Backups** if the plan provides it, or from a controlled `pg_dump` environment. Encrypt the export and store it outside the application repository.
- Storage: list and copy private buckets with service credentials from a controlled backup environment; preserve object path and content type.
- Restore into a separate Supabase project first, apply the same migrations, validate RLS and only then schedule a production restore.
- Auth provider configuration, OAuth consent settings, external email-provider logs and expired signed URLs are not reconstructed by a database-only backup.
- Minimum pre-launch schedule: daily database backup, daily Storage inventory/copy, and a quarterly restore rehearsal.

## Cloudflare / hosting hand-off

- **Cloudflare → SSL/TLS**: Full (strict); verify a valid origin certificate before enabling.
- **Cloudflare → Security → WAF**: enable managed rules and a rate-limit rule for `/api/reviews`, `/api/complaints`, `/api/applications`, `/login` and `/register`.
- **Cloudflare → Caching**: bypass cache for `/cabinet*`, `/admin*`, `/api/*`, `/auth/*`; verify `Cache-Control: no-store` remains present.
- **Google Cloud Console → APIs & Services → Credentials**: add only the exact `https://<domain>/auth/callback` and Supabase callback entries supplied by Supabase; remove unused redirect URIs.
- **Supabase Dashboard → Authentication → Providers**: keep only enabled providers, rotate secrets after any suspected exposure, and ensure CAPTCHA is configured before opening anonymous feedback at scale.
