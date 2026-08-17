# SEC-009 Local Verification

| Evidence | Result |
|---|---|
| Next | lock-resolved 16.2.12 → exact 16.3.1 |
| Sharp | Next path 0.34.5 → 0.35.3; direct 0.35.3 retained |
| PostCSS | 8.4.31 → 8.5.23 |
| Nanoid | 3.3.16 → 3.3.18 |
| Production audit | 4 High / 2 Moderate → 0 Critical / 0 High / 0 Moderate |
| Full audit | 8 High / 2 Moderate → 0 Critical / 0 High / 0 Moderate |
| Frozen clean install | PASS ×2 |
| Build, Node, typecheck, lint | PASS; lint retained existing warnings only |
| Sharp/media and PostCSS/CSS regression | PASS |
| Role matrix | 183 PASS / 5 approved unrelated XFAIL ×2 at P0-10A |
| Secret/client bundle scan | PASS |

The P0-10 final gate rechecks the same unchanged `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`; any hash drift or Moderate-or-higher advisory blocks readiness.
