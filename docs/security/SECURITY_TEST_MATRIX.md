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
| `applications` | all D | base all D; owner-safe `S:G` | `S/U:G,A2` | `S/U/D:G,A2` | scoped S/I/U/D | Direct I/U/D закрыты, но base owner S сейчас открыт: DB-03 |
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
| DB-02 | owner | Owner application row существует | Direct `select=safe_fields` | Только owner-safe fields | UI делает safe projection; dynamic REST не запускался | NOT RUN | `src/app/cabinet/page.tsx:17-20` |
| DB-03 | owner | То же | Direct `select=internal_notes,call_at` | 403/column denied | Live table SELECT + owner row policy разрешают columns | FAIL | `applications`; live ACL/policy; SEC-002 |
| DB-04 | user B | UUID application user A известен | Direct SELECT/UPDATE/DELETE чужого UUID | 0 rows/deny | Owner predicate подтверждён; dynamic request не отправлялся | NOT RUN | Owner policy `(select auth.uid())=owner_id` |
| DB-05 | anon/auth | Public API key/session | Direct INSERT `reviews` | Deny; только gateway | Live INSERT privilege=true и permissive policy | FAIL | Live ACL/policy; `/api/reviews` |
| DB-06 | anon/auth | То же | Direct INSERT `complaints` с `internal_notes` | Deny/protected field rejected | Live INSERT privilege=true; column allowlist отсутствует | FAIL | Live ACL/policy; `/api/complaints` |
| DB-07 | moderator AAL1 | Moderator membership | Direct UPDATE specialist `owner_id/status/...` | Deny; named AAL2 transition only | Live authenticated UPDATE + broad moderator policy | FAIL | `specialists`; policy; admin actions |
| DB-08 | moderator AAL1 | Moderator membership | Direct UPDATE verification actor/protected fields | Deny | Live authenticated UPDATE + moderator policy | FAIL | `verifications`; `202608070001...` |
| DB-09 | moderator | Два concurrent decisions | Parallel approve/reject expected-version RPC | Один commit, второй conflict | RPC/locking/version absent | FAIL | `src/app/admin/actions.ts:42-49` |
| DB-10 | auditor | Live four views | Inspect owner/options/columns/filters | Safe public contract без definer bypass | Columns/filters narrow, но `security_invoker=false`; 4 Advisor ERROR | FAIL | Four `published_*` views |
| DB-11 | anon/auth | Live function catalog | Invoke allowlisted RPC only | Internal/trigger/definer EXECUTE denied | 10/11 SECURITY DEFINER functions executable | FAIL | Live function ACL snapshot |
| DB-12 | auditor | Live ACL catalog | Inspect default privileges | Future table/function private by default | Broad table privileges/function EXECUTE inherited | FAIL | Live `pg_default_acl` |
| DB-13 | auditor | Live function catalog | Inspect `proconfig/search_path` | Fixed/empty path for sensitive functions | 8 mutable-path warnings; target guards correct | FAIL | Security Advisor + `pg_proc` |
| DB-14 | auditor | Live data API schema | Public projection column snapshot | Нет private contacts/moderation fields | Текущие four view projections узкие | PASS | Live view definitions; limited to current version |
| DB-15 | service | Application created by service role | Inspect audit actor | Explicit actor/request ID | `auth.uid()` может быть NULL | FAIL | `record_application_event()`, server writes |
| DB-16 | moderator/admin | Role rows существуют; AAL2 fixture | Moderator пытается I/U/D `moderators`; admin выполняет named role change | Moderator deny; admin AAL2 one audited mutation | Admin/self-read policies найдены, но AAL2/atomic audit отсутствуют; dynamic role request не отправлялся | FAIL | `moderators` policies; AU-05/AD-01 |
| DB-17 | user A/B | Два `account_profiles` | S/U/I/D own и foreign UUID, включая `email` | Только own S; updates через trusted Auth sync/G; foreign deny | Live authenticated UPDATE=true и policy `Users update own account profile` разрешает весь own row, включая `email`; recorded migration содержит DROP этого policy | FAIL | Live ACL/`pg_policies`; `202607300001_security_hardening.sql:24-26`; SEC-025 |
| DB-18 | owner/mod/admin/service | Fixtures application event, notification, audit | S/I/U/D каждой таблицы и direct RPC enqueue/audit | Owner only own S; privileged read AAL2; append/mutation only transactional backend; arbitrary U/D deny | Static policies/RPC ACL изучены; direct moderator audit I и service actor gap нарушают target contract | FAIL | `application_events`, `email_notifications`, `audit_log`; SEC-018 |
| DB-19 | anon/mod/admin | Active/inactive categories/content/badges | S/I/U/D `categories`, `site_content`, `trust_badges`, `specialist_trust_badges` | Public only safe active projection S; admin named AAL2 writes; others D | Base `site_content` public SELECT раскрывает operational `updated_by`; dynamic remaining matrix не запускалась | FAIL | `site_content`; migrations `202607290008`, `202607290010` |
| DB-20 | all roles | Own/foreign revision fixtures | S/I/U/D + submit/decide RPC для каждого role | Owner only G on own; direct DML deny; moderator/admin named AAL2 transitions | Direct I/U/D deny подтверждён live; SELECT/BOLA/RPC transitions динамически не проверены | NOT RUN | Target migration + revision policies/actions |
| DB-21 | anon/owner/mod/admin | Published/unpublished specialist + verification | Full base S/I/U/D, foreign UUID, owner_id/protected-field/status substitutions | Public view S only; owner changes via revision; moderator/admin narrow AAL2 G | Direct broad authenticated U уже противоречит contract | FAIL | Live specialist/verification ACL/policies; DB-07/08 |
| DB-22 | anon/auth/mod/admin | Feedback fixtures | Full S/I/U/D + moderation RPC, protected fields и чужой UUID | Submission only G; moderation narrow AAL2 G; direct base all D | Anon/auth direct I подтверждён live; остальные runtime cells не запускались | FAIL | Live review/complaint grants/policies; DB-05/06 |
| DB-23 | owner/mod/admin/service | Application fixtures v1/v2 | Full S/I/U/D, чужой UUID, owner_id/status/protected fields, decision RPC | Client direct all D; owner-safe S G; moderator/admin named AAL2 G | I/U/D deny live; owner base S leak; server owner_id/audit limitations | FAIL | Target migration; DB-03/09/15 |
| DB-24 | profile owner | Own hidden/draft specialist и revision | Direct UPDATE `specialists.status='published'`, protected publication fields и revision status/payload | Deny; публикация только named moderator/admin AAL2 transaction | Specialist owner policy не разрешает UPDATE, revision direct DML revoked; runtime request не отправлялся | NOT RUN | Live policies/ACL; target migration |
| DB-25 | owner/mod/admin | Versioned RPC list и fixtures | Прямой invoke каждого exposed business/trigger RPC, включая `apply_specialist_revision` | Owner deny internal/privileged RPC; moderator/admin only named AAL2 RPC; trigger funcs not callable | 10/11 definer functions exposed anon/auth, что уже нарушает default-deny contract; dynamic body/exploit matrix не выполнена | FAIL | Live `pg_proc` ACL + function bodies; DB-11 |

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
| ST-12 | operator | Takedown/restore fixture | Delete reference/purge cache/restore object | Предсказуемый purge и recoverability | SEC-001 source-dereference survival passes; takedown/cache/restore remains unproved | PASS (SEC-001 local) / NOT RUN (restore) | MEDIA-007; SEC-006/013 remain open |

## 5. Auth, sessions и privileged access

| ID | Роли | Предусловия | Запрос/check | Ожидается | Фактически | Статус | Доказательство |
|---|---|---|---|---|---|:---:|---|
| AU-01 | authenticated | Valid/invalid cookie | Server authorization code review | Identity проверяется network-validated method | Используется `auth.getUser()` | PASS | `src/lib/auth.ts`, routes/actions |
| AU-02 | anon/auth | Malicious external `next` | Login/callback redirect tests | Только local safe path | Existing tests/static helpers pass | PASS | Auth tests; `src/lib/auth-flow.ts`/navigation |
| AU-03 | auth | Next Server Components | Inspect Proxy/cookie refresh path | Один documented Proxy updater | Proxy/middleware отсутствует; cookie errors swallowed | FAIL | `src/lib/supabase/server.ts:11-26` |
| AU-04 | auth | Short JWT, two tabs | Concurrent expired-session navigation | One refresh; coherent cookies; no reuse | Не запускалось; current 24h logs без events | NOT RUN | Нужен limited staging |
| AU-05 | moderator/admin AAL1 | Valid privileged membership | Любой privileged read/mutation | Deny до AAL2 | AAL2 checks отсутствуют | FAIL | `src/lib/auth.ts:4-17`; code search |
| AU-06 | signup | Breached password | Register | Deny | Live Advisor: leaked-password protection disabled | FAIL | Supabase Security Advisor |
| AU-07 | revoked user | Existing sessions/tabs | Revoke then call app/Data API/RPC | Все sessions быстро denied | Не запускалось; dashboard policy unknown | NOT RUN | Требуется Auth staging/admin procedure |
| AU-08 | bot | Login/signup/reset/magic-link burst | Bounded generic responses | CAPTCHA/durable rate + alerts | App controls отсутствуют/Map local; Supabase config unknown | NOT RUN | Code gap confirmed, remote setting unknown |
| AU-09 | auth | Production-like HTTPS deploy | Inspect `Set-Cookie` | `Secure; SameSite` и correct refresh cache | Actual headers не проверены; Secure не задан явно | NOT RUN | Supabase SSR defaults + deployment gap |
| AU-10 | operator | Production env config | Set public origin to HTTP | Startup/deploy fail | Helper принимает HTTP | FAIL | `src/lib/navigation.ts:35-43` |
| AU-11 | user A/B | Known foreign UUID | Cabinet/profile/action against other owner | Deny server + DB | Owner ID filters присутствуют; dynamic role test не запускался | NOT RUN | `src/app/cabinet/actions.ts:15-65` |
| AU-12 | user | Forged `user_metadata.role` | Call moderator boundary | Deny; DB membership authoritative | Code не использует metadata для роли | PASS | `requireModerator()` + code search |
| AU-13 | former moderator | Membership удалено, старый JWT ещё не истёк | Повторить privileged read/action/RPC | Немедленный deny по актуальной DB role, независимо от JWT freshness | Role lookup не использует `user_metadata/app_metadata`; removal/session scenario не выполнялся | NOT RUN | `requireModerator()`/`is_moderator()` static evidence |
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
| RT-09 | moderator | Parallel approve/reject | Invoke action concurrently | Transactional single transition | Read-then-unconditional-write | FAIL | `admin/actions.ts:42-49` |
| RT-10 | moderator | Same-length unrelated description | Batch safe approval | Classified risky/manual | Length delta marks safe | FAIL | `admin/actions.ts:15-24`; client duplicate |
| RT-11 | moderator | `__proto__`/valid forbidden status | Call generic updateProfile | Strict enum + role transition deny | Runtime own-key validation weak; valid admin statuses allowed | FAIL | `admin/actions.ts:141-152` |
| RT-12 | client | Malformed input/error | Route/action failure | Generic response, no secret/stack | Не найден secret verbose path; full deployed exercise not run | NOT RUN | Static review only |
| RT-13 | anon/auth | SQL injection corpus в UUID/text/filter-like fields | Отправить quotes, comments, boolean/time payloads через каждый public/owner/moderator input | Schema rejects invalid identifiers; text передаётся как data; query structure не меняется | Raw SQL interpolation/user-controlled SQL sink не найден; dynamic WSTG corpus не отправлялся | NOT RUN | Supabase query builder/static search; staging test required |

## 7. Email, audit и operations

| ID | Роли | Предусловия | Запрос/check | Ожидается | Фактически | Статус | Доказательство |
|---|---|---|---|---|---|:---:|---|
| EM-01 | anon/auth | No/invalid worker secret | POST internal worker | 401/deny | Shared-secret check present | PASS | `/api/internal/email-worker/route.ts`; static |
| EM-02 | service | Provider/enqueue failure | Submit/decision action | Transaction/error visible; retry state | Enqueue errors часто swallowed | FAIL | `.catch(() => undefined)` callers |
| EM-03 | operator | Queue has pending row | Wait scheduled interval | Verified scheduler processes + alerts | Scheduler config отсутствует | NOT RUN | Repo/hosting evidence absent |
| EM-04 | service | Replay same event/request | Worker retry | Exactly-once business effect, safe repeated send | Full replay/idempotency not verified | NOT RUN | Requires provider/staging fixture |
| AD-01 | moderator | Audit insert failure | Perform mutation | Entire mutation rolls back | Audit error ignored/after mutation | FAIL | `src/app/admin/actions.ts:12` |
| AD-02 | moderator | Valid nonexistent UUID | Call legacy action | Mutation failure, no success audit | Некоторые results ignored, false audit possible | FAIL | `moderateFeedback`, `updateAvatar` |
| AD-03 | service | Server-only application event | Inspect actor | Explicit actor/reason/request ID | `auth.uid()` NULL path possible | FAIL | DB function + service client flow |
| OP-01 | auditor | Local dependencies installed | `node --test tests/*.test.mjs` | All pass | 85/85 pass | PASS | Local run 2026-08-09 |
| OP-02 | auditor | Source tree | TypeScript `--noEmit` | No errors | Pass | PASS | Local run |
| OP-03 | auditor | Source tree | ESLint | No errors | Exit 0, 12 warnings | PASS | 11 image warnings, 1 Hook dependency |
| OP-04 | auditor | Local env | Production Next build | Build succeeds | Pass; 25 routes | PASS | Local build; not release provenance |
| OP-05 | auditor | Registry reachable | `pnpm audit --prod` / full | No unresolved High/Critical | 4H/2M prod; 8H/2M full | FAIL | Current registry audit |
| OP-06 | auditor | Source/build/env | Exact secret/signature scan | Server secrets absent from source/client | Exact configured server secrets not found outside env | PASS | Git history unavailable; anon key expected |
| OP-07 | CI | Canonical Git worktree | Required release workflow | Review + tests + scans + signed artifact | `.git`/CI/provenance absent | NOT RUN | Provided root not Git worktree |
| OP-08 | operator | Empty disposable project | Clean DB bootstrap/catalog diff | Reproducible secure state | Static migration chain fails order; not executed | FAIL | README/schema/migration analysis |
| OP-09 | operator | Isolated restore target | Restore DB+Storage+config | Meet RPO/RTO and reconcile hashes | No evidence/job/result | NOT RUN | `SECURITY_OPERATIONS.md` only |
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

Concurrency, production Auth/headers/monitoring, dependency/provenance,
backup/restore и sustained abuse остаются `NOT_AUTOMATED`; это не PASS и не
понижение release-blocker severity.
