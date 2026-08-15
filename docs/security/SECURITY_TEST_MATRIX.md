# AL-AMIN / «Аманат»: security test matrix

Дата среза: **2026-08-09**  
Среда: локальный source + **read-only** live metadata Supabase  
Вердикт матрицы: **FAIL / BLOCKED**

## 1. Правила интерпретации

- **PASS** — проверенный слой соответствует ожидаемому результату. `PASS (static)` не заменяет runtime/integration test.
- **FAIL** — код, SQL или live metadata уже противоречат ожидаемому security contract; destructive exploit request не требуется.
- **NOT RUN** — тест не выполнялся, потому что нужен disposable staging, реальный deploy, dashboard access или mutation. Это не PASS.
- В поле «Запрос» приведён безопасно выполненный metadata/static check либо планируемый pseudocode. Секреты, реальные UUID и токены не приводятся.
- Ни один mutating request из этой матрицы не отправлялся в production.

Тестовые субъекты для будущей isolated staging fixture:

- **anon** — без пользовательской сессии;
- **user A** и **user B** — два независимых обычных аккаунта;
- **profile owner** — user A, владеющий target specialist/application/revision/media;
- **moderator** — отдельный AAL2 account с moderator membership;
- **admin** — отдельный AAL2 account с admin membership;
- **service backend** — только доверенный server/RPC principal, никогда browser token.

## 2. Нормативная матрица доступа

Обозначения: `A` — allow; `D` — deny; `G` — только через валидирующий server gateway/transaction; `A2` — только с AAL2; `Own` — только собственный объект; `Pub` — только published projection.

| Ресурс / действие | anon | user A | user B | profile owner | moderator | admin | service backend |
|---|---|---|---|---|---|---|---|
| Public views: SELECT | A | A | A | A | A | A | A |
| Private base tables: arbitrary SELECT | D | D | D | D | D | D/G | G |
| Application: owner-safe SELECT | D | D | D | Own/G | A2/G | A2/G | G |
| Application: protected columns | D | D | D | D | A2/G | A2/G | G |
| Application: direct INSERT/UPDATE/DELETE | D | D | D | D | D | D | G |
| Application: submit/withdraw/decision | D | D | D | G | A2/G scoped | A2/G | G |
| Revision: direct CRUD | D | D | D | D | D | D | G |
| Revision: create/edit/submit | D | D | D | Own/G | D | A2/G exceptional | G |
| Specialist base: user content UPDATE | D | D | D | D; use revision | A2/G allowlist | A2/G | G |
| Specialist: change `owner_id` | D | D | D | D | D | A2/G exceptional | G |
| Status transition | D | D | D | D | A2/G moderator subset | A2/G full matrix | G |
| Publish/unpublish/archive/block | D | D | D | D | A2/G only assigned subset | A2/G | G |
| Verification/protected fields | D | D | D | D | A2/G allowlist | A2/G | G |
| Role/membership change | D | D | D | D | D | A2/G | G |
| Review/complaint direct table INSERT | D | D | D | D | D | D | G |
| Review/complaint gateway submission | G | G | G | G | G | G | G |
| Moderation of feedback | D | D | D | D | A2/G | A2/G | G |
| Storage canonical upload/update/delete | D | D | D | G new immutable path | A2/G | A2/G | G |
| Storage draft read | D | D | D | Own/G | A2/G | A2/G | G |
| Storage published read | Pub/G | Pub/G | Pub/G | Pub/G | Pub/G | Pub/G | G |
| Direct RPC | D by default | D by default | D | D except explicit | A2 + explicit | A2 + explicit | explicit only |
| Privileged действие без AAL2 | D | D | D | D | D | D | N/A |
| Доступ к чужому UUID/path | D | D | D | D | only assigned/G | A2/G | G |
| Подмена protected fields | D | D | D | D | D except named mutation | D except named mutation | validated G |

### 2.1 CRUD/RPC contract по каждому live public resource

В этой таблице `S/I/U/D` означают `SELECT/INSERT/UPDATE/DELETE`. Это ожидаемый direct-access contract; `G` означает, что операция выполняется только именованным gateway/RPC, а не произвольным table DML. Полный динамический прогон каждой ячейки остаётся обязательным на disposable staging.

| Ресурс | anon | user A/B / owner | moderator | admin | service backend | Текущий audit state |
|---|---|---|---|---|---|---|
| `applications` | all D | base all D; owner-safe `S:G` | `S/U:G,A2` | `S/U/D:G,A2` | scoped S/I/U/D | SEC-002 contract PASS locally via `owner_applications_v1`; live remote remains open pending consolidated deployment: DB-02/03/04/23 |
| `specialist_revisions` | all D | own `S/I/U:G`; direct all D | `S/U:G,A2` | `S/U/D:G,A2` | scoped S/I/U/D | Direct I/U/D закрыт; полный runtime CRUD: DB-20 |
| `specialists` | base all D; `S:Pub` | base all D; changes via revision G | allowlisted `S/U:G,A2`; I/D D | lifecycle `S/I/U/D:G,A2` | scoped S/I/U/D | Broad moderator U нарушает contract: DB-07 |
| `verifications` | base all D; `S:Pub` | base all D | allowlisted `S/I/U/D:G,A2` | `S/I/U/D:G,A2` | scoped S/I/U/D | Broad moderator all-policy: DB-08 |
| `reviews` | base all D; `I:G`; `S:Pub` | то же | moderation `S/U:G,A2` | `S/U/D:G,A2` | scoped S/I/U/D | Anon/auth direct I открыт: DB-05 |
| `complaints` | base all D; `I:G` | то же | moderation `S/U:G,A2` | `S/U/D:G,A2` | scoped S/I/U/D | Anon/auth direct I открыт: DB-06 |
| `moderators` | all D | own membership `S` only; I/U/D D | own S; role I/U/D D | role `S/I/U/D:G,A2` | scoped S/I/U/D | Policy выглядит корректно; dynamic role test: DB-16 |
| `account_profiles` | all D | own S only; I/U/D only trusted Auth sync/G | assigned read only if required/A2 | scoped `S/U/D:G,A2` | scoped S/I/U/D | Live owner UPDATE policy существует вопреки recorded drop: DB-17 |
| `application_events` | all D | own S only | `S:G,A2`; I/U/D D | `S:G,A2`; retention D:G | append I; no arbitrary U/D | Static policies; dynamic append-only test: DB-18 |
| `email_notifications` | all D | own S only | `S:G,A2`; no direct mutation | `S/U:G,A2` | queue I/U; retention D:G | Runtime queue/ACL test: DB-18/EM-02–04 |
| `audit_log` | all D | all D | `S:G,A2`; direct I/U/D D | `S:G,A2`; retention D:G | append I; U/D D | Current direct moderator insert против target contract: DB-18 |
| `categories` | active `S:Pub`; I/U/D D | то же | read Pub; I/U/D D | `S/I/U/D:G,A2` | scoped S/I/U/D | Static policies; dynamic admin test: DB-19 |
| `site_content` | public projection S; base I/U/D D | то же | read only | `S/U:G,A2`; I/D D | scoped S/U | Base public S раскрывает operational metadata: DB-19 |
| `trust_badges` | active `S:Pub`; I/U/D D | то же | S; I/U/D D | `S/I/U/D:G,A2` | scoped S/I/U/D | Static policies; dynamic test: DB-19 |
| `specialist_trust_badges` | published `S:Pub`; I/U/D D | то же | `S:G,A2`; I/U/D D | `S/I/U/D:G,A2` | scoped S/I/U/D | Static policies; dynamic test: DB-19 |

RPC contract для всех ресурсов: `PUBLIC`, anon и authenticated не получают `EXECUTE` по умолчанию; разрешаются только versioned named functions с собственной role/AAL/field/transition проверкой. Текущий live результат этому не соответствует (DB-11/DB-12).

## 3. Target migration и database contract

| ID | Роли | Предусловия | Запрос/check | Ожидается | Фактически | Статус | Доказательство |
|---|---|---|---|---|---|:---:|---|
| MIG-01 | auditor | Локальный файл существует | `SHA256(file)` | Ровно ожидаемый hash | Совпал: `5E798...42FD` | PASS | `20260809001646_enforce_server_only_specialist_writes.sql` |
| MIG-02 | auditor | Read-only Supabase connection | SELECT migration history | Версия присутствует один раз и является последней | Присутствует; позже live/local версий нет | PASS | `supabase_migrations.schema_migrations` |
| MIG-03 | auditor | Локальный и live text доступны | Нормализовать 17 stored statements и сравнить | Exact semantic text equality | Все statements совпали | PASS | Local file + migration history |
| MIG-04 | anon/auth | Live catalog | `has_table_privilege(...applications/revisions, INSERT/UPDATE/DELETE)` | Direct write privileges false | `INSERT/UPDATE/DELETE=false`; SELECT проверяется отдельно | PASS | Live ACL metadata |
| MIG-05 | auditor | Live catalog | SELECT policies/functions/triggers | Old write policies absent; v2 guards enabled; EXECUTE revoked | Эквивалентно migration; оба triggers enabled | PASS | `pg_policy`, `pg_proc`, `pg_trigger` read-only |
| MIG-06 | auditor | Все local migrations | Проверить последующий порядок/conflicts | Нет позднего override | Target — последний local/live migration | PASS | `supabase/migrations/`, live history |
| MIG-07 | all roles | Пустой disposable Supabase project | Replay canonical schema/migrations, затем role matrix | Полный replay без ошибок, catalog равен expected | Не запускалось; static order содержит broken dependencies | FAIL | `202607280001` до owner_id; `202607290003/4` до revisions |
| MIG-08 | operator | Disposable staging + paired server code | Deploy/forward-fix/rollback rehearsal | No downtime/data loss; exact rollback grants | Не запускалось; rollback artefact отсутствует | NOT RUN | Требуется безопасная ветка/окружение |
| DB-01 | all | Live catalog | Проверить `relrowsecurity` public/storage tables | RLS enabled | Включена на всех обнаруженных tables | PASS | Live table metadata |
| DB-02 | owner | Owner application row существует | Direct `select=safe_fields` | Только owner-safe fields | Local v1 projection returns exactly 20 reviewed fields in 2/2 runs; remote not deployed | PASS LOCAL / LIVE OPEN | `APPREAD-001/003`; SEC-002 local verification |
| DB-03 | owner | То же | Direct `select=internal_notes,call_at` | 403/column denied | Local explicit protected and base wildcard reads denied in 2/2 runs; live table SELECT remains open | PASS LOCAL / FAIL LIVE | `READ-005`, `APPREAD-002/009`; SEC-002 |
| DB-04 | user B | UUID application user A известен | Direct SELECT/UPDATE/DELETE чужого UUID | 0 rows/deny | Local safe projection returns no foreign row and direct foreign mutations remain denied in 2/2 runs | PASS LOCAL | `APPREAD-004`; owner RLS |
| DB-05 | anon/auth | Public API key/session | Direct INSERT `reviews` | Deny; только gateway | Live INSERT privilege=true и permissive policy | FAIL | Live ACL/policy; `/api/reviews` |
| DB-06 | anon/auth | То же | Direct INSERT `complaints` с `internal_notes` | Deny/protected field rejected | Live INSERT privilege=true; column allowlist отсутствует | FAIL | Live ACL/policy; `/api/complaints` |
| DB-07 | moderator AAL1 | Moderator membership | Direct UPDATE specialist `owner_id/status/slug/future field` | Deny; named AAL2 transition only | Local direct writes and future-column inheritance denied in 2/2 runs; live broad policy remains | PASS LOCAL / FAIL LIVE | `SPEC-003/004/006/007`, `ROLE-009/010`; SEC-003 |
| DB-08 | moderator AAL1 | Moderator membership | Direct UPDATE verification actor/protected fields | Deny | Local direct moderator/admin-AAL1 writes denied and AAL2 named action allowed in 2/2 runs; live policy remains | PASS LOCAL / FAIL LIVE | `SPEC-005`, `ROLE-008/009/010`; SEC-003/010 |
| DB-09 | moderator | Два concurrent application decisions | Parallel named expected-version RPC | Один commit, второй conflict | P0-07 produced one winner and one complete operation/event/audit/outbox set in 2/2 runs | PASS LOCAL / LIVE OPEN | `P007-008/009/011`, `MOD-003/004/005`; SEC-008 |
| DB-10 | auditor | Live four views | Inspect owner/options/columns/filters | Safe public contract без definer bypass | Columns/filters narrow, но `security_invoker=false`; 4 Advisor ERROR | FAIL | Four `published_*` views |
| DB-11 | anon/auth | Live function catalog | Invoke allowlisted RPC only | Internal/trigger/definer EXECUTE denied | 10/11 SECURITY DEFINER functions executable | FAIL | Live function ACL snapshot |
| DB-12 | auditor | Live ACL catalog | Inspect default privileges | Future table/function private by default | Broad table privileges/function EXECUTE inherited | FAIL | Live `pg_default_acl` |
| DB-13 | auditor | Live function catalog | Inspect `proconfig/search_path` | Fixed/empty path for sensitive functions | 8 mutable-path warnings; target guards correct | FAIL | Security Advisor + `pg_proc` |
| DB-14 | auditor | Live data API schema | Public projection column snapshot | Нет private contacts/moderation fields | Текущие four view projections узкие | PASS | Live view definitions; limited to current version |
| DB-15 | service | Application created by service role | Inspect audit actor | Explicit actor/request ID | `auth.uid()` может быть NULL | FAIL | `record_application_event()`, server writes |
| DB-16 | moderator/admin | Role rows существуют; real local TOTP AAL2 fixture | Moderator/admin AAL1 пытается direct role change; stale membership invokes named privileged action | Direct role mutation deny; current DB role required; admin AAL2 named role function only | Local direct AAL1/stale-role paths denied; named AAL2 function has exact ACL but positive membership mutation intentionally not exercised | PARTIAL LOCAL / FAIL LIVE | `ROLE-006/007`; migration ACL; AU-05 |
| DB-17 | user A/B | Два `account_profiles` | S/U/I/D own и foreign UUID, включая `email` | Только own S; updates через trusted Auth sync/G; foreign deny | Live authenticated UPDATE=true и policy `Users update own account profile` разрешает весь own row, включая `email`; recorded migration содержит DROP этого policy | FAIL | Live ACL/`pg_policies`; `202607300001_security_hardening.sql:24-26`; SEC-025 |
| DB-18 | owner/mod/admin/service | Fixtures application event, notification, audit | S/I/U/D каждой таблицы и direct RPC enqueue/audit | Owner only own S; privileged read AAL2; append/mutation only transactional backend; arbitrary U/D deny | P0-07 application/revision event/audit/outbox writes and worker ACK are atomic/direct-client denied; AAL1 queue read remains XFAIL | PARTIAL LOCAL / FAIL LIVE | `P007-006..016`, `AUDIT-002/003/004`; SEC-018 residual |
| DB-19 | anon/mod/admin | Active/inactive categories/content/badges | S/I/U/D `categories`, `site_content`, `trust_badges`, `specialist_trust_badges` | Public only safe active projection S; admin named AAL2 writes; others D | Base `site_content` public SELECT раскрывает operational `updated_by`; dynamic remaining matrix не запускалась | FAIL | `site_content`; migrations `202607290008`, `202607290010` |
| DB-20 | all roles | Own/foreign revision fixtures | S/I/U/D + decide RPC для user/moderator/admin AAL2 | Owner only G on own; direct DML deny; moderator exact AAL1 decision; admin sensitive actions AAL2 | Local user invoke denied; moderator AAL1 and real TOTP AAL2 revision decisions succeed; replay/media safety enforced | PASS LOCAL / LIVE OPEN | `SPEC-002`, `RPC-001/002/003`, `MEDIA-008`; SEC-003 |
| DB-21 | anon/owner/mod/admin | Published/unpublished specialist + verification | Full base S/I/U/D, foreign UUID, owner_id/protected-field/status substitutions | Public view S only; owner changes via revision; moderator direct DML denied; admin narrow AAL2 G | Local direct moderator writes denied and AAL2 named lifecycle/verification positive; live broad grants remain | PASS LOCAL / FAIL LIVE | `SPEC-001/003/004/005/006/007`, `ROLE-008/009/010` |
| DB-22 | anon/auth/mod/admin | Feedback fixtures | Full S/I/U/D + moderation RPC, protected fields и чужой UUID | Submission only G; moderation narrow G; direct base all D | Local direct moderator UPDATE denied; anonymous/authenticated INSERT remains XFAIL under SEC-004 | PARTIAL LOCAL / FAIL LIVE | `FEEDBACK-001..005`; SEC-004 residual |
| DB-23 | owner/mod/admin/service | Application fixtures v1/v2 | Full S/I/U/D, чужой UUID, protected fields, named decisions | Client direct all D; owner-safe S G; moderator exact decision; admin lifecycle/deletion AAL2 | Submit uniqueness/idempotency and atomic decision/event/audit/outbox paths PASS locally; remote deployment remains open | PASS LOCAL / LIVE OPEN | `APPREAD-001..009`, `P007-001..011`, `ROLE-013..016`, `MOD-001..005` |
| DB-24 | profile owner | Own hidden/draft specialist и revision | Direct UPDATE publication/protected fields and revision status/payload | Deny; publication only reviewed named/server path | Local owner and moderator direct publication-field writes denied; named revision decision remains exact | PASS LOCAL / LIVE OPEN | `SPEC-001/003/004/006`, `RPC-001/002` |
| DB-25 | owner/mod/admin | Versioned RPC list and fixtures | Direct invoke exposed business/trigger RPCs | Owner deny internal/privileged RPC; exact moderator actions; sensitive admin RPC AAL2; trigger funcs not callable | P0-05 named RPCs have exact grants/fixed path and role/AAL behavior PASS locally; unrelated legacy broad function ACL remains SEC-016 XFAIL | PARTIAL LOCAL / FAIL LIVE | `CAT-003/004`, `RPC-001..003`, `ROLE-004/005/009..016` |

### 3.1 SEC-002 local owner-projection regression

| Cases | Secure expectation | Final result |
|---|---|---|
| READ-005, APPREAD-002, APPREAD-009 | protected columns and base/projection wildcard bypass unavailable | PASS in 2/2 clean-room runs |
| APPREAD-001, APPREAD-003 | owner v1 projection is usable and has exactly the 20 reviewed columns | PASS in 2/2 clean-room runs |
| APPREAD-004, APPREAD-005 | foreign owner and anon cannot obtain the projection row | PASS in 2/2 clean-room runs |
| APPREAD-006 | moderator client session cannot directly read protected base columns | PASS in 2/2 clean-room runs |
| APPREAD-007 | trusted local service backend retains explicit moderation read | PASS in 2/2 clean-room runs |
| APPREAD-008 | a synthetic future sensitive base column receives no grant and is absent from the view | PASS in 2/2 clean-room runs |

These results are local implementation evidence, not live closure. The remote
catalog remains in the pre-hardening state until an owner-approved consolidated
pre-launch backend deployment.

### 3.2 P0-05 moderator/admin boundary regression

| Cases | Secure expectation | Final result |
|---|---|---|
| SPEC-003–SPEC-007 | moderator cannot mutate owner, lifecycle, slug, verification or a future protected field directly | PASS in 2/2 clean-room runs |
| FEEDBACK-004/005, AUDIT-003 | moderator cannot bypass named feedback actions or forge audit rows | PASS in 2/2 clean-room runs |
| ROLE-006–ROLE-016 | current DB membership is authoritative; direct/AAL1 admin writes deny; named AAL2 actions succeed | PASS in 2/2 clean-room runs |
| MOD-001–MOD-005 | named moderator decisions enforce actor, states, expected version, replay and row-lock conflict | PASS in 2/2 clean-room runs |
| RPC-001–RPC-003 | user deny, moderator AAL1 exact decision and real-TOTP AAL2 admin decision | PASS in 2/2 clean-room runs |

This is local implementation evidence. SEC-003 remains live-open until the
consolidated pre-launch backend deployment. SEC-010 is only partially covered:
the mutation slice is verified, while private reads, enrollment/recovery,
recent-auth and full session downgrade/revocation remain open.

## 4. Storage и media

| ID | Роли | Предусловия | Запрос/check | Ожидается | Фактически | Статус | Доказательство |
|---|---|---|---|---|---|:---:|---|
| ST-01 | anon | Bucket metadata | Read arbitrary `profile-media` object directly | Deny/private | Bucket `public=false` | PASS | Live bucket metadata |
| ST-02 | owner | Auth session, own prefix | Policy metadata check | Draft access только `submissions/<uid>/` | Owner-path predicate присутствует | PASS | Live `storage.objects` policies |
| ST-03 | user B | Path user A известен | Direct read/upload/update/delete чужого path | Deny | Disposable post-fix role matrix denies all four operations | PASS (local) | MEDIA-014–016 + STORAGE cases |
| ST-04 | owner | Published path принадлежит owner | Direct Storage UPDATE/DELETE/reinsert | Deny; canonical immutable | Local post-fix canonical mutations deny and source deletion leaves canonical bytes intact; live rollout not performed | PASS (local) / FAIL (live) | MEDIA-001, 004, 006, 007, 013, 018 |
| ST-05 | owner | Valid session + image | POST `/api/media` JPEG/PNG/WebP | Decode, dimension bound, WebP re-encode | Existing route plus canonical server transform/hash tests pass | PASS | Route + `published-media-security.test.mjs` |
| ST-06 | owner | SVG/polyglot input | POST `/api/media` | Reject; no SVG execution | Accept list и decoded format исключают SVG | PASS | Route + Storage MIME restrictions; static |
| ST-07 | owner | Hostile image corpus | Decompression bomb, truncated file, huge dimensions, EXIF, HEIF | Bounded reject/strip без crash | Malformed/MIME-spoof/size boundary covered locally; full hostile corpus remains separate SEC-017 work | PASS (targeted) / NOT RUN (full corpus) | Targeted unit + role matrix |
| ST-08 | service cleanup | Query failure/`changes_requested` reference | Run cleanup dry fixture | Abort; object preserved | Code игнорирует errors и state | FAIL | `src/lib/media-cleanup.ts:17-31` |
| ST-09 | owner/bot | Много uploads/bytes/objects | Burst upload | Durable quota/rate deny | Quota/rate отсутствуют; direct API доступен | FAIL | Route/policies |
| ST-10 | anon | Public media URL | Cache-busting query burst | Canonical cache key/prebuilt derivative | Route ignores extra query but per-request work возможен; не load-tested | NOT RUN | `/api/media/view`; edge unknown |
| ST-11 | anon/owner | Published/own draft | GET `/api/media/view`/`source` | Public только approved; private только owner/mod | Dynamic local published projection/canonical read and private submission boundaries pass | PASS (local) | MEDIA-002, 003, 007, 014 + view cases |
| ST-12 | operator | Takedown/restore fixture | Delete reference/purge cache/restore object | Предсказуемый purge и recoverability | Production-derived DB/Auth/Storage restore and hash reconciliation pass twice; takedown/cache behavior remains unproved | PASS (restore Level 2) / NOT RUN (takedown/cache) | Recovery proof; SEC-006/013 remain open |

## 5. Auth, sessions и privileged access

| ID | Роли | Предусловия | Запрос/check | Ожидается | Фактически | Статус | Доказательство |
|---|---|---|---|---|---|:---:|---|
| AU-01 | authenticated | Valid/invalid cookie | Server authorization code review | Identity проверяется network-validated method | Используется `auth.getUser()` | PASS | `src/lib/auth.ts`, routes/actions |
| AU-02 | anon/auth | Malicious external `next` | Login/callback redirect tests | Только local safe path | Existing tests/static helpers pass | PASS | Auth tests; `src/lib/auth-flow.ts`/navigation |
| AU-03 | auth | Next Server Components | Inspect Proxy/cookie refresh path | Один documented Proxy updater | Proxy/middleware отсутствует; cookie errors swallowed | FAIL | `src/lib/supabase/server.ts:11-26` |
| AU-04 | auth | Short JWT, two tabs | Concurrent expired-session navigation | One refresh; coherent cookies; no reuse | Не запускалось; current 24h logs без events | NOT RUN | Нужен limited staging |
| AU-05 | moderator/admin AAL1 | Valid privileged membership | Sensitive admin mutation; privileged read remains separate scope | Admin mutation deny до AAL2; exact moderator subset only | Local sensitive admin mutations deny at AAL1 and succeed with real TOTP AAL2 in 2/2 runs; private reads remain open | PARTIAL LOCAL / FAIL LIVE | `ROLE-004/005/009..016`; SEC-010 residual |
| AU-06 | signup | Breached password | Register | Deny | Live Advisor: leaked-password protection disabled | FAIL | Supabase Security Advisor |
| AU-07 | revoked user | Existing sessions/tabs | Revoke then call app/Data API/RPC | Все sessions быстро denied | Не запускалось; dashboard policy unknown | NOT RUN | Требуется Auth staging/admin procedure |
| AU-08 | bot | Login/signup/reset/magic-link burst | Bounded generic responses | CAPTCHA/durable rate + alerts | App controls отсутствуют/Map local; Supabase config unknown | NOT RUN | Code gap confirmed, remote setting unknown |
| AU-09 | auth | Production-like HTTPS deploy | Inspect `Set-Cookie` | `Secure; SameSite` и correct refresh cache | Actual headers не проверены; Secure не задан явно | NOT RUN | Supabase SSR defaults + deployment gap |
| AU-10 | operator | Production env config | Set public origin to HTTP | Startup/deploy fail | Helper принимает HTTP | FAIL | `src/lib/navigation.ts:35-43` |
| AU-11 | user A/B | Known foreign UUID | Cabinet/profile/action against other owner | Deny server + DB | Owner ID filters присутствуют; dynamic role test не запускался | NOT RUN | `src/app/cabinet/actions.ts:15-65` |
| AU-12 | user | Forged `user_metadata.role` | Call moderator boundary | Deny; DB membership authoritative | Code не использует metadata для роли | PASS | `requireModerator()` + code search |
| AU-13 | former moderator | Membership удалено, старый JWT ещё не истёк | Повторить named privileged mutation; privileged read remains separate scope | Немедленный mutation deny по актуальной DB role | Local role row deletion immediately denied the named mutation in 2/2 runs; privileged reads remain SEC-010 scope | PARTIAL LOCAL | `ROLE-006`; current DB membership helper |
| AU-14 | anon/user | Один magic-link/reset code уже использован | Replay callback/code во второй вкладке/сессии | Single-use generic failure; no session fixation/open redirect | Локальный flow изучен, dynamic replay не запускался | NOT RUN | Auth callback/tests; staging required |

## 6. Public routes, CSRF, XSS, SSRF, races

| ID | Роли | Предусловия | Запрос/check | Ожидается | Фактически | Статус | Доказательство |
|---|---|---|---|---|---|:---:|---|
| RT-01 | anon | Forged Origin + huge chunked body | POST `/api/applications` | Auth/ingress limit до buffering | `request.text()` до auth/actual limit | FAIL | `route.ts:13-23` |
| RT-02 | owner | Два parallel valid submits | POST `/api/applications` same owner | One row/event | Local Map race, no DB unique/idempotency | FAIL | `route.ts:9,45,52`; schema |
| RT-03 | anon | `text/plain` JSON, cross-origin | POST reviews/complaints | Origin/content-type reject | Handlers accept via `Request.json`; no controls | FAIL | Public feedback routes |
| RT-04 | bot | Oversized bodies | POST public routes/media | Stream terminated before full buffer | All handlers fully buffer relevant body | FAIL | `text/json/formData` usage; edge unverified |
| RT-05 | browser | Cross-origin Server Action | Forged action request | Origin-versus-Host deny | Next 16 built-in check present | PASS | Next action handler; framework control |
| RT-06 | user | Stored/reflected HTML payload | Render profile/review/email | Text escaped, no execution | React/email escaping; sinks not found | PASS | Static source search; runtime corpus NOT RUN |
| RT-07 | user | `javascript:`, `data:`, external next | Submit links/redirect | Unsafe protocols/redirect reject | HTTPS validators/local redirect helpers found | PASS | Source + existing tests; production HTTP origin exception in AU-10 |
| RT-08 | user | URL causing backend fetch | Submit profile/evidence URL | No server-side attacker fetch | User-controlled server fetch sink not found | PASS | Static source search; not proof against future paths |
| RT-09 | moderator | Parallel application decisions | Invoke named action concurrently with expected version | Transactional single transition | Exactly one local winner and complete side-effect set in 2/2 P0-07 runs | PASS LOCAL / LIVE OPEN | `P007-009`, `MOD-005`; SEC-008 |
| RT-10 | moderator | Same-length unrelated description | Batch safe approval | Classified risky/manual | Length delta marks safe | FAIL | `admin/actions.ts:15-24`; client duplicate |
| RT-11 | moderator | Forbidden specialist field/status or future column | Direct DML or named action | Exact allowlist; future fields default deny; admin transition AAL2 | Generic action removed; local protected/future fields deny and AAL1/AAL2 state paths PASS in 2/2 runs | PASS LOCAL / FAIL LIVE | `SPEC-003..007`, `ROLE-009/010` |
| RT-12 | client | Malformed input/error | Route/action failure | Generic response, no secret/stack | Не найден secret verbose path; full deployed exercise not run | NOT RUN | Static review only |
| RT-13 | anon/auth | SQL injection corpus в UUID/text/filter-like fields | Отправить quotes, comments, boolean/time payloads через каждый public/owner/moderator input | Schema rejects invalid identifiers; text передаётся как data; query structure не меняется | Raw SQL interpolation/user-controlled SQL sink не найден; dynamic WSTG corpus не отправлялся | NOT RUN | Supabase query builder/static search; staging test required |

## 7. Email, audit и operations

| ID | Роли | Предусловия | Запрос/check | Ожидается | Фактически | Статус | Доказательство |
|---|---|---|---|---|---|:---:|---|
| EM-01 | anon/auth | No/invalid worker secret | POST internal worker | 401/deny | Shared-secret check present | PASS | `/api/internal/email-worker/route.ts`; static |
| EM-02 | service | Provider/enqueue failure | Submit/decision action | Atomic enqueue; provider failure becomes bounded retry without rolling back accepted business state | Atomic enqueue and fake provider retry PASS; caller observability remains SEC-021 | PARTIAL LOCAL / LIVE OPEN | `P007-006/008/010/014`; fake worker tests |
| EM-03 | operator | Queue has pending row | Wait scheduled interval | Verified scheduler processes + alerts | Scheduler config отсутствует | NOT RUN | Repo/hosting evidence absent |
| EM-04 | service | Replay same event/request | Worker retry | Exactly-once enqueue, safe repeated claim/ACK; external semantics documented | Exact enqueue/replay and disjoint lease claims PASS; external delivery is at-least-once with send-before-ACK residual | PARTIAL LOCAL / LIVE OPEN | `P007-003/008/010/012..014`; fake worker tests |
| AD-01 | moderator | Audit append participates in named mutation | Perform P0-07 application/revision mutation | Entire named mutation and authoritative audit share one DB transaction | P0-07 state/domain event/audit/outbox rollback and success sets PASS; wider unrelated actions remain SEC-018 | PARTIAL LOCAL / FAIL LIVE | `P007-006..011`; SEC-018 residual |
| AD-02 | moderator | Invalid/replayed target or transition | Call named action | Mutation failure, no success audit | Generic feedback/avatar actions removed; invalid/replayed decisions fail locally without state change | PASS LOCAL / LIVE OPEN | `MOD-003/004`, focused Node tests |
| AD-03 | service | Server-only application event | Inspect actor | Explicit actor/role/operation ID | P0-07 submit stores authoritative owner actor/role and shared operation ID | PASS LOCAL / LIVE OPEN | `P007-006`; forward migration |
| OP-01 | auditor | Local dependencies installed | `node --test tests/*.test.mjs` | All pass | 85/85 pass | PASS | Local run 2026-08-09 |
| OP-02 | auditor | Source tree | TypeScript `--noEmit` | No errors | Pass | PASS | Local run |
| OP-03 | auditor | Source tree | ESLint | No errors | Exit 0, 12 warnings | PASS | 11 image warnings, 1 Hook dependency |
| OP-04 | auditor | Local env | Production Next build | Build succeeds | Pass; 25 routes | PASS | Local build; not release provenance |
| OP-05 | auditor | Registry reachable | `pnpm audit --prod` / full | No unresolved High/Critical | 4H/2M prod; 8H/2M full | FAIL | Current registry audit |
| OP-06 | auditor | Source/build/env | Exact secret/signature scan | Server secrets absent from source/client | Exact configured server secrets not found outside env | PASS | Git history unavailable; anon key expected |
| OP-07 | CI | Canonical Git worktree | Required release workflow | Review + tests + scans + signed artifact | `.git`/CI/provenance absent | NOT RUN | Provided root not Git worktree |
| OP-08 | operator | Empty disposable project | Clean DB bootstrap/catalog diff | Reproducible secure state | Static migration chain fails order; not executed | FAIL | README/schema/migration analysis |
| OP-09 | operator | Isolated restore target | Restore DB+Storage+config | Meet RPO/RTO and reconcile hashes | Two production-derived Level 2 restores reconcile 47 tables, 5 Auth users and 36 object hashes; two independent Level 3 configuration rehearsals reconcile 67 fields, 7 secret sources and 48 exact manual checklists with 0 critical unknowns and 0 residual resources. Process is compatible with approved RPO/RTO; incident-time achievement remains an operational metric. | PASS (Level 3 capability) | `docs/security/recovery/RECOVERY_PROOF.md`; `docs/security/recovery/CONFIG_RECOVERY_REHEARSAL.md` |
| OP-10 | auditor | Public staging/production URL | TLS/headers/cookies/cache/CORS scan | Match source policy and secure cookies | URL/config evidence unavailable | NOT RUN | `next.config.mjs` is source only |
| OP-11 | auditor | Live Supabase | Security/performance advisors | No unaccepted Error/High; bounded debt | 34 security + 33 performance notices | FAIL | Read-only advisor run |
| OP-12 | auditor | Returned Auth-log sample | Count reuse/abuse/limit events в последних 100 возвращённых entries | No unexplained anomalies в полном согласованном окне | В выборке 100 entries: 0 target events; это не доказывает чистоту всех 24h | NOT RUN | Ограниченная read-only выборка; historical 75 не опровергнуты |
| OP-13 | operator | PII older than retention | Dry-run/report/purge | Defined retention + recoverable audited deletion | Policy/mechanism отсутствуют | NOT RUN | Schema/privacy/operations review |
| OP-14 | response team | Tabletop incident | Detect, contain, notify, recover | Named roles/SLA/evidence/postmortem | Полный playbook отсутствует | NOT RUN | Repo evidence gap |
| OP-15 | auditor | Current production build artefact | Найти client/server source maps и exact server secrets | Нет публичных client maps/secret values; server maps недоступны извне | `.next/static` production maps: 0; server maps существуют; exact configured server secrets не найдены; deployment exposure не проверен | PASS | Local build artefact scan, ограниченный отсутствием hosting evidence |

## 8. Итоги по классам контроля

| Класс | PASS | FAIL | NOT RUN | Вывод |
|---|---:|---:|---:|---|
| Target migration/database | 8 | 20 | 5 | Target control работает; общая DB boundary небезопасна |
| Storage/media | 5 | 3 | 4 | Published media integrity не защищена |
| Auth/sessions | 3 | 4 | 7 | Privileged/Auth release gate не закрыт |
| Routes/application | 4 | 7 | 2 | Public abuse и concurrency controls недостаточны |
| Email/audit/operations | 7 | 7 | 8 | Нет release/restore/monitoring evidence |

Числа суммируют строки выше и не являются risk score: один High FAIL достаточен для BLOCKED.

## 9. Минимальный staging test pack перед изменением verdict

1. Fresh disposable Supabase bootstrap + catalog/ACL/policy/view/function diff.
2. Полная role matrix с user A/user B и direct PostgREST, RPC, Storage requests.
3. Protected-column SELECT и moderator protected-field/status negative tests.
4. Immutable published media bytes и cross-owner object tests.
5. Concurrent submit и approve/reject transaction tests.
6. Short-JWT multi-tab Proxy refresh + revocation + privileged AAL2.
7. Public form body/rate/CAPTCHA/idempotency tests без реального спама.
8. Hostile media corpus и cleanup fault injection.
9. Deployed TLS/header/cookie/cache/CORS checks.
10. Dependency/secret/SBOM/clean-build gates и isolated DB+Storage restore.

Эти тесты должны выполняться только на явно allowlisted disposable/limited-staging environment с отдельными keys, synthetic data и автоматической cleanup verification.

## 10. P0-02C local role-matrix execution

Дата: 2026-08-11.

Verified no-data bootstrap теперь имеет executable local role matrix:
`tests/security/role-matrix/`. Два независимых disposable прогона дали
одинаковый результат: **49 PASS / 24 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**;
cleanup обоих проектов — PASS.

Динамически закрыты прежние `NOT RUN` gaps для cross-owner application/profile,
revision read, direct owner/moderator writes, four public views, actual Storage
API, allowlisted RPC, role revocation и real local TOTP AAL2. XFAIL не меняют
статус findings: они кодируют безопасное ожидание и указывают на открытые
SEC-001/002/003/004/010/015/016/017/018/025/026.

Полный stable case ledger и resource/action coverage находятся в:

- `tests/security/role-matrix/cases.json`;
- `tests/security/role-matrix/expected-failures.json`;
- `tests/security/role-matrix/coverage-matrix.json`;
- `docs/security/ROLE_MATRIX_BASELINE_RESULTS.md`.

### 10.1 P0-03A SEC-001 post-fix execution

Verified baseline evidence above remains historical. After applying the two
SEC-001 forward migrations, two new independent disposable runs matched:
**73 PASS / 23 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**; cleanup PASS.

`STORAGE-010` and `MEDIA-001`–`MEDIA-023` are PASS. `MEDIA-019/020` bind the
decision to the reviewed row version; `MEDIA-021/022/023` verify concurrent
replay and overlapping decisions. SEC-001 has no entry in
the expected-failure ledger. The 23 remaining XFAIL mappings are unchanged and
no other finding produced XPASS. Live deployment/backfill was not performed.
Evidence: `docs/security/SEC-001_LOCAL_VERIFICATION.md`,
`docs/security/SEC-001_ADVERSARIAL_REVIEW.md`, and
`docs/security/SEC-001_DEPLOYMENT_REHEARSAL.md`.

Concurrency, production Auth/headers/monitoring, dependency/provenance, Level 3
configuration recovery/cadence и sustained abuse остаются `NOT_AUTOMATED`; это
не PASS и не понижение release-blocker severity.

### 10.2 P0-05 SEC-003/SEC-010 mutation-boundary execution

Before the P0-05 migration, two independent red-phase runs matched at
**88 PASS / 36 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**. The added secure
expectations reproduced only approved SEC-003 and mutation-scoped SEC-010
violations.

After the forward migration and exact server actions, two new independent
disposable runs matched at **108 PASS / 16 XFAIL / 0 XPASS / 0 FAIL /
0 SKIP**; database lint was 0/0/0, security advisors remained at the unrelated
pre-hardening 4 ERROR / 8 WARN / 0 INFO, and cleanup passed. Every SEC-003
expected failure was removed from the ledger after adjudication. The targeted
SEC-010 admin-mutation cases also PASS with real local TOTP AAL2, while
`AUDIT-004` remains XFAIL for the still-open privileged-read/session and
SEC-018 scope.

Evidence: `docs/security/changes/SEC-003_MODERATOR_ADMIN_BOUNDARY.md` and
`docs/security/SEC-003_LOCAL_VERIFICATION.md`. Remote Supabase was not
contacted, so these results do not close the live findings.

### 10.3 P0-06 SEC-004 feedback-gateway execution

The expanded red phase ran twice at **108 PASS / 28 XFAIL / 0 XPASS / 0
FAIL / 0 SKIP**. Sixteen cases mapped to SEC-004: `CAT-007`,
`FEEDBACK-001..003`, and `FEEDBACK-006..017`.

After the forward migration and server gateway, two fresh runs matched at
**124 PASS / 12 unrelated XFAIL / 0 XPASS / 0 FAIL / 0 SKIP**. DB-05, DB-06,
and DB-22 are PASS locally; feedback-specific RT-03/RT-04/AU-08 are exercised
by 17 targeted Node tests covering exact Origin, JSON-only and streamed 8 KiB
limit, CAPTCHA failure, field injection, idempotency, duplicate and concurrent
rate behavior. RT-13 is covered structurally by typed SDK/RPC parameters,
strict UUID/text normalization, no dynamic SQL, and malformed/injection-field
tests. OP-13 remains NOT RUN because retention is SEC-011 scope.

Database lint remained 0/0/0. Advisors were 4 ERROR / 8 WARN / 1 INFO; the
single INFO is the RLS-enabled private gateway ledger without a direct policy,
and no new ERROR/WARN appeared. Remote Supabase was not contacted, so live
DB-05/06/22 remain open pending consolidated pre-launch deployment.

Evidence: `docs/security/changes/SEC-004_SAFE_FEEDBACK_GATEWAY.md` and
`docs/security/SEC-004_LOCAL_VERIFICATION.md`.
