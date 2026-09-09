# Hosting-agnostic deployment

The command pnpm build creates out/. The directory contains the complete public site and needs no Node.js server, API routes, runtime secrets, Supabase, Auth or SMTP.

## Root deployment

For a custom domain or any provider serving the artifact from the root, set SITE_URL to the canonical HTTPS origin, keep STATIC_BASE_PATH empty, and run pnpm build.

Upload the contents of out/ to Cloudflare Pages, Netlify, GitHub Pages or another static host.

## Optional subpath

If a host requires a project subpath, set STATIC_BASE_PATH to that path while building. Example: /repository-path. No repository name or Pages URL is stored in source control, and React code is unchanged.

## Provider settings

- Cloudflare Pages: build command pnpm build, output directory out.
- Netlify: build command pnpm build, publish directory out.
- GitHub Pages: use the generated out artifact only after explicit owner approval. No deployment workflow is enabled.

public/_headers is copied into the artifact. Cloudflare Pages and Netlify apply it automatically; hosts without _headers support should configure equivalent security headers in their dashboard.
