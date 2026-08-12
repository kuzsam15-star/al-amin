# AL-AMIN Configuration Recovery Rehearsal

Date: 2026-08-13

Verdict: **RECOVERY_LEVEL_3_PROVEN**

## 1. Scope and safety boundary

This rehearsal completes the configuration-only part of the previously proven
production-derived Level 2 recovery. The disaster scenario was total loss of
the AL-AMIN Supabase project with only these approved recovery sources left:

- the owner-held encrypted database and Storage archive;
- the canonical Git repository;
- the redacted configuration manifest;
- owner password-manager and external-provider credentials.

Production remained read-only. No Dashboard setting was saved, no secret value
was read or recorded, and no production Auth, Storage, database, API, Realtime,
Edge Function, network, or project configuration was changed. The local runs
used synthetic secrets, loopback endpoints, a local SMTP sink, and no external
OAuth or SMTP request.

## 2. Configuration inventory result

`CONFIG_RECOVERY_MANIFEST.json` v2 contains 67 unique fields.

| Classification | Count |
| --- | ---: |
| `PROVEN_RESTORABLE` | 13 |
| `PROVEN_MANUAL_REENTRY` | 48 |
| `PROVEN_NOT_APPLICABLE` | 6 |
| `UNKNOWN_BLOCKER` | 0 |

All launch-critical fields have a source of evidence, recovery action, and
verification. Each manual field also records an exact Dashboard/provider path,
setting, secret requirement, verification, and failure impact.

## 3. Read-only source evidence

The current non-secret state was reconciled from the existing live-catalog
evidence, Git configuration, official project metadata, and owner-authorized
read-only Dashboard inspection. The inspection confirmed, without saving:

- Email and Google providers enabled; all other built-in providers disabled;
- signup and email confirmation enabled; anonymous sign-in disabled;
- Site URL `http://localhost:3000` and exactly two localhost callback/reset URLs;
- 3600-second JWT expiry, refresh rotation enabled, 10-second reuse interval;
- single-session/timebox/inactivity controls at the current Free-plan defaults;
- TOTP enabled, 10 enrolled factors, and the AAL1 duration limit enabled;
- CAPTCHA and leaked-password protection disabled in the current pre-hardening state;
- custom SMTP enabled with the documented UniSender host, port, sender, and a
  secret value that was neither revealed nor captured;
- PostgreSQL 17 in `eu-west-2`, Free/Nano (`t4g.nano`), SSL enforcement off,
  database network restrictions absent, pool size 15, max clients 200;
- Data API enabled, 1000-row limit, current legacy automatic exposure enabled;
- `supabase_realtime` publication with all event classes and zero tables;
- no deployed Edge Functions and no required Edge Function secrets;
- two Storage buckets and seven application Storage policies already covered by
  Level 2 database/Storage reconciliation.

These facts reproduce the current pre-hardening state. They do not close
unrelated Auth, transport, Data API, or network findings.

## 4. Secret re-entry map

Seven secret names are `MUST_REENTER`; no values are stored.

| Secret name | Source of truth | Destination/use |
| --- | --- | --- |
| `DATABASE_PASSWORD` | owner password manager; new target-specific value | owner-operated logical restore |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud and owner password manager | Supabase Google provider |
| `SUPABASE_AUTH_SMTP_PASSWORD` | UniSender Go and owner password manager | Supabase Auth SMTP |
| `SUPABASE_SERVICE_ROLE_KEY` | newly generated target Dashboard | server-only deployment environment |
| `UNISENDER_GO_API_KEY` | UniSender Go | deployment secret store |
| `EMAIL_WORKER_SECRET` | owner password manager | deployment secret store |
| `TEMPORARY_S3_SECRET_ACCESS_KEY` | temporary replacement-project key | hidden recovery prompt, then immediate deletion |

The target project receives new API/JWT/project identifiers. Old project
signing material is not restored. A new publishable key and project URL are
wired into the public deployment configuration; the new service key remains
server-only.

## 5. Dashboard/provider recovery checklist

The 48 manual fields are grouped below; the manifest is authoritative for each
individual field.

| Path | Required state or action | Secret | Verification | Failure impact |
| --- | --- | --- | --- | --- |
| Authentication > Sign In / Providers | signup on; anonymous/manual-linking off; Email and Google enabled | Google secret: yes | synthetic signup and OAuth redirect smoke | login/registration loss or auth drift |
| Authentication > Sign In / Providers > Email | secure email change on; current password controls as recorded; password/OTP values exact | no | exact Dashboard reconciliation | account or email-flow drift |
| Authentication > URL Configuration | Site URL plus exact two-URL allowlist | no | exact-set equality and callback/reset smoke | broken/unsafe redirects |
| Authentication > Sessions | JWT 3600; refresh rotation on; reuse 10; other session limits current-state | no | exact values and refresh smoke | session drift |
| Authentication > Multi-Factor | TOTP enabled; max 10; AAL1 duration limit on | no | synthetic TOTP/AAL check | privileged-auth degradation |
| Authentication > Attack Protection / Rate Limits | current CAPTCHA/leaked-password state plus recorded limits | no | exact numeric/state reconciliation | abuse or compatibility drift |
| Authentication > Emails > SMTP Settings | documented host/port/sender/minimum interval; provider credential re-entry | SMTP password: yes | owner-approved synthetic mail | signup/reset mail failure |
| Authentication > Emails > Templates | 13-template inventory and required callback variables | no | render synthetic messages | broken auth/security mail |
| Database > Settings | SSL, allowed networks, pool, logging, database credential | DB password: yes | connection and exact-state checks | restore failure or network drift |
| Database > Publications | empty `supabase_realtime` publication, all event types | no | catalog equality | replication drift |
| Integrations > Data API > Settings | enabled, 1000 max rows, current exposure/search path | no | API/RLS smoke and exact state | API outage or privilege drift |
| Project creation / General / Infrastructure | `eu-west-2`, approved plan, PostgreSQL 17, target-generated ID/keys | service key: yes | version/region/compute and target identity | wrong project/topology |
| Project Settings > Storage > S3 Access Keys | one temporary recovery key only | S3 secret: yes | LIST/HEAD/GET then owner-confirmed deletion | Storage recovery blocked or credential residue |
| Deployment environment | new project URL/publishable key plus server-only secrets | service/provider/worker secrets: yes | app, worker, provider synthetic smoke | application unavailable or secret boundary failure |
| External DNS and UniSender Go | preserve sender domain, one SPF record, DKIM and tracking domain | provider secrets remain external | provider status plus independent DNS check | email rejection or broken links |

## 6. Isolated two-run proof

Command:

```powershell
node scripts/recovery/config-recovery-rehearsal.mjs
```

Both runs used different disposable project IDs and ports. Each run proved:

- local-only guard and manifest validation;
- 67 fields, seven secret sources, 48 manual checklists, zero critical unknowns;
- healthy PostgreSQL, Auth, Storage, Kong, Realtime, and local SMTP services;
- running PostgREST/Data API;
- PostgreSQL major 17 and all five required extension versions;
- Email signup with confirmation and delivery only to the local SMTP sink;
- Google provider enabled with synthetic in-memory credentials and zero OAuth calls;
- exact bucket privacy, size, and MIME metadata for `avatars` and `profile-media`;
- `supabase_realtime` publication with all event classes and zero tables;
- configuration values persisted only in the disposable config; secret values
  remained environment-indirected and were cleared from the process object;
- project-specific cleanup with zero containers, networks, volumes, or workdirs.

The stable summaries matched. The initial regression exposed that Supabase CLI
2.113.0 now generates the `local_smtp` section rather than the helper's older
`inbucket` section name. The helper was updated and the final two clean runs
passed. Failed attempts also left zero residual Docker resources.

## 7. Complete-project-loss walkthrough

1. Create the owner-approved replacement project in `eu-west-2` with
   PostgreSQL 17 and record its new identity in the recovery change record.
2. Create/store a new database password; restore the encrypted database/Auth
   payload and reconcile 47 tables and five Auth users.
3. Create a temporary S3 key, restore both buckets, reconcile all 36 object
   hashes, delete the key, and preserve the owner confirmation.
4. Apply the 67-field manifest. Re-enter the seven secrets only from their
   mapped custodians; never copy old project signing material.
5. Recreate/verify the empty Realtime publication, project/Data API settings,
   Auth providers, URLs, sessions/MFA, SMTP, email template structure, and DNS.
6. Wire the new project URL/publishable key and server-only secrets into the
   deployment environment; run synthetic Auth, Storage, API, and email checks.
7. Reconcile the full manifest and stop if any critical field is unknown or any
   secret source is unavailable. Cutover is a separate owner-approved action.

Walkthrough result: **PASS**. No paid project was created and no production
cutover was attempted during this rehearsal.

## 8. RPO/RTO compatibility and limits

The documented sequence is compatible with the approved MVP targets: database
24h/8h, Storage 24h/12h, and configuration every approved change/4h. This is a
capability proof, not proof of continuous cadence. The owner must still generate
daily encrypted artifacts, update the redacted manifest in every approved
configuration change, retain the approved generations, and conduct quarterly
Level 3 exercises. Managed PITR, automated cadence evidence, a lost-key drill,
and measured incident-time RTO remain maturity work; none is falsely claimed.

## 9. Security decision

SEC-013 status is `RECOVERY_READINESS_PROVEN`. Its recovery-readiness launch
blocker is removed because Level 2 remains valid, Level 3 configuration recovery
passed twice, critical unknowns are zero, and secret/manual mappings are
complete. Historical High severity and remaining operational maturity work are
retained in the ledger.

For SEC-001, only the recovery blocker is removed. Production deployment remains
unauthorized until the release wrapper, project/checkpoint identity, exact
migration/source mechanism, backfill controls, monitoring window, and human
approval gates are independently ready.
