# Dependency and Lockfile Review

P0-10A changed only `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`. Lockfile churn was 199 additions / 453 deletions and was explained by removal of vulnerable obsolete resolution branches plus exact package pinning. It was not a bulk upgrade and did not add application capabilities.

The frozen contract is:

- Next 16.3.1, React/React DOM 19.2.8;
- Supabase JS 2.112.0 and SSR 0.12.4;
- Sharp 0.35.3, PostCSS 8.5.23, Nanoid 3.3.18;
- exact framework/type package versions where the prior manifest used `latest`;
- scoped transitive overrides only for js-yaml, brace-expansion and Nanoid;
- no allowed dependency install scripts for Sharp or unrs-resolver.

Registry URLs and lockfile integrity are rechecked by frozen installation and audit. The pre-launch source manifest freezes hashes of all three package files; a byte change blocks the release gate. P0-10 does not change the dependency tree.
