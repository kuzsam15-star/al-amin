# SEC-009 — Dependency remediation

- **Status:** `IMPLEMENTED_LOCAL_VERIFIED_PENDING_PRELAUNCH_RELEASE`.
- **Commit:** `8d38496de8353ade809350a0453013c22e060b8a`.
- **Threat:** vulnerable/transient image, CSS and build dependencies plus `latest` ranges made the installed/released graph unsafe and non-reproducible.

P0-10A selected the minimum compatible graph rather than a blind audit fix. Next moved from lock-resolved 16.2.12 to pinned 16.3.1; its Sharp path moved from 0.34.5 to 0.35.3 and PostCSS from 8.4.31 to 8.5.23. Nanoid moved from 3.3.16 to 3.3.18. Direct framework/runtime/type packages formerly declared as `latest` are exact-pinned. Narrow pnpm overrides patch only the known transitive js-yaml, brace-expansion and Nanoid paths. `allowBuilds` explicitly keeps Sharp and unrs-resolver lifecycle builds disabled.

Two independent frozen-lockfile installs, production build, Node/type/lint, media/PostCSS regressions and two role-matrix environments passed. Production and full audits both reached 0 Critical / 0 High / 0 Moderate. No dependency was added and remote Supabase was not contacted.

Rollback to the previous lockfile is forbidden without explicit risk acceptance because it restores known advisories and nondeterministic ranges. A regression must receive a reviewed compatible forward dependency fix.
