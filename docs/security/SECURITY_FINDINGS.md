# AL-AMIN / «Аманат»: реестр security findings

Дата среза: **2026-08-09**  
Этап: **read-only audit**  
Общий вердикт: **BLOCKED**

## 1. Правила оценки

| Severity | Практическое значение |
|---|---|
| Critical | Немедленный системный компромисс, массовая утечка/разрушение или обход ключевой границы без существенных условий |
| High | Реалистичный обход авторизации/модерации, потеря важных данных/доступности или отсутствие обязательного launch control |
| Medium | Значимый defense-in-depth, abuse, reliability или operational risk с дополнительными условиями |
| Low | Ограниченный residual risk или hardening |
| Informational | Подтверждённый контекст/положительный control без самостоятельного риска |

`Launch blocker: yes` означает, что находка должна быть закрыта или явно принята ответственным владельцем до указанного в roadmap release gate. В этом baseline нет Critical; наличие нескольких независимых High всё равно делает итог **BLOCKED**.

Факты, полученные из live Supabase, проверялись только read-only запросами. Динамические exploit-запросы к production не выполнялись.

## 2. Сводка

| ID | Severity | Кратко | Статус | Blocker |
|---|---|---|---|---:|
| SEC-001 | High | Замена опубликованного media через прямой Storage API | LOCAL_VERIFIED_AWAITING_CONSOLIDATED_PRELAUNCH_BACKEND_RELEASE — live open | yes |
| SEC-002 | High | Владелец заявки читает moderator-only колонки | Open — confirmed live | yes |
| SEC-003 | High | Модератор обходит admin-only transitions/protected fields | Open — confirmed live | yes |
| SEC-004 | High | Прямой anonymous INSERT отзывов/жалоб и spam bypass | Open — confirmed live | yes |
| SEC-005 | High | Stale и нереплейный database bootstrap | Open — confirmed | yes |
| SEC-006 | High | Media cleanup fail open и удаляет используемые объекты | Open — confirmed | yes |
| SEC-007 | High | Race создаёт дубли заявок | Open — confirmed design flaw | yes |
| SEC-008 | High | Race решений оставляет опубликованный профиль у rejected заявки | Open — confirmed design flaw | yes |
| SEC-009 | High | Уязвимые production dependencies | Open — confirmed | yes |
| SEC-010 | High | Нет AAL2/MFA gate для привилегированных действий | Open — confirmed control gap | yes |
| SEC-011 | Medium | Leaked-password и public Auth abuse controls не доказаны | Open — partly live confirmed | yes |
| SEC-012 | High | Нет проверяемого Git/CI/release provenance | Open — evidence gap | yes |
| SEC-013 | High | Backup/restore не доказаны | Partially mitigated — Level 2 proven; config/cadence open | yes |
| SEC-014 | High | Отсутствует Supabase SSR Proxy; причина старых reuse events гипотетична | Open — config confirmed | yes |
| SEC-015 | Medium | Четыре SECURITY DEFINER public views | Open — confirmed live | yes |
| SEC-016 | Medium | Избыточные grants/default ACL/RPC EXECUTE/search_path | Open — confirmed live | yes |
| SEC-017 | Medium | Буферизация тела и media/resource abuse | Open — confirmed | yes |
| SEC-018 | Medium | Audit trail и multi-write операции неатомарны | Open — confirmed | yes |
| SEC-019 | Medium | Недетерминированная supply chain и опасные remote E2E scripts | Open — confirmed | no |
| SEC-020 | Medium | HTTP/cookie/edge security зависит от недоказанной конфигурации | Open — confirmed + unverified | yes |
| SEC-021 | Medium | Observability, retention и incident response неполны | Open — confirmed evidence gap | yes |
| SEC-022 | Medium | «Safe revision» определяется по длине, а не смыслу | Open — confirmed | no |
| SEC-023 | Medium | RLS/index policy performance debt | Open — confirmed live | no |
| SEC-024 | Low | CSP/logging residual risks | Open — confirmed | no |
| SEC-025 | Medium | Live owner UPDATE вернулся на auth-mirrored `account_profiles` | Open — confirmed live drift | yes |
| SEC-026 | Low | Public base `site_content.updated_by` раскрывает admin UUID | Open — confirmed live | no |

## 3. Подробные findings

### SEC-001 — Прямая замена опубликованного media

- **Severity / status:** High; `LOCAL_VERIFIED_AWAITING_CONSOLIDATED_PRELAUNCH_BACKEND_RELEASE`; исходный риск подтверждён live и остаётся launch blocker до rollout/backfill/Phase B. AL-AMIN application пока local-only, поэтому hosting/source-version gates отложены до первого deployment; remote Supabase остаётся живым backend.
- **Область:** Storage ownership, moderation integrity, file upload, availability.
- **Объекты:** `storage.objects`; bucket `profile-media`; `supabase/migrations/202607310001_security_hardening.sql:21-27`; `src/app/api/media/route.ts:12,24-25`; `src/app/api/media/view/route.ts:34-50`; `src/lib/media-paths.ts:1-16`.
- **Доказательство — факт:** live ACL даёт `authenticated` `INSERT/UPDATE/DELETE` на `storage.objects`; owner policy разрешает операции под `submissions/<auth.uid()>/`. Route загружает через user client. Публичная карточка сохраняет и выдаёт тот же path. Серверное перекодирование защищает чтение, но не moderation integrity.
- **Сценарий эксплуатации:** владелец узнаёт path текущего опубликованного avatar/gallery, напрямую вызывает Storage update/delete/reinsert с другим допустимым WebP. Строка профиля не меняется, revision и moderator approval не создаются. Также можно создавать orphan objects.
- **Ущерб / вероятность:** обход модерации, подмена или удаление публичного изображения, репутационный и storage-cost ущерб; вероятность высокая для любого владельца профиля.
- **Локальная реализация:** две forward-only фазы создают отдельный content-addressed `published/` namespace, provenance ledger, no-overwrite server writer, service-only publication RPC и DB guards. Owner submission UPDATE запрещён; удаление разрешено только после dereference. Existing live paths требуют отдельного idempotent backfill; Phase B fail-closed до нулевого остатка legacy references.
- **Тесты:** независимый red phase воспроизвёл stale-review bypass; после коррекции два full role-matrix run: 73 PASS / 23 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP. Все 24 SEC-001 cases PASS; два deployment rehearsal по 19/19 PASS. Quota/expiry/cache/restore остаются SEC-006/017 scope.
- **Rollback/forward-fix:** только forward migration с поэтапным переходом на новые immutable paths; сначала совместимый server writer, затем revoke policies. Откат не должен возвращать broad Storage DML.
- **Launch blocker:** yes. **Уверенность:** High.

### SEC-002 — Утечка внутренних колонок заявки владельцу

- **Severity / status:** High; Open — confirmed live.
- **Область:** BOLA/column authorization, PII, moderation confidentiality.
- **Объекты:** `public.applications`; `supabase/schema.sql:27-35`; owner policy из `supabase/migrations/202607280002_product-test-fixes.sql:66-67`; target migration `20260809001646...:12-14`; safe UI projection `src/app/cabinet/page.tsx:17-20`.
- **Доказательство — факт:** live `authenticated` имеет table-level `SELECT`; owner RLS разрешает всю собственную строку. RLS фильтрует строки, но не колонки. В таблице есть `internal_notes`, `call_at` и workflow metadata. UI выбирает безопасный subset, но direct PostgREST может запросить остальные колонки.
- **Сценарий эксплуатации:** пользователь с валидной сессией вызывает `/rest/v1/applications?select=internal_notes,call_at,...` для своей строки, обходя UI projection.
- **Ущерб / вероятность:** раскрытие внутренних заметок, планов звонка и moderation context; вероятность высокая, запрос тривиален.
- **Исправление:** убрать authenticated SELECT с base table; выдать owner-safe view/RPC/server route с точным allowlist. Moderator read отделить. При необходимости применить column privileges, но не полагаться на них без integration tests.
- **Тесты:** owner может читать только разрешённые поля; выбор каждой protected column запрещён; user B не читает row user A; moderator/admin получают только ожидаемые проекции.
- **Rollback/forward-fix:** сначала добавить совместимую safe projection и перевести UI, затем revoke base SELECT. Откат — вернуть приложение на предыдущий endpoint, не открывая private columns.
- **Launch blocker:** yes. **Уверенность:** High.

### SEC-003 — Вертикальное повышение полномочий модератора

- **Severity / status:** High; Open — confirmed live.
- **Область:** moderator/admin boundary, protected fields, status transitions, verification integrity.
- **Объекты:** `public.specialists`, `public.verifications`; policy `Moderators update specialists`; `src/app/admin/actions.ts:141-167,200-201`; `src/app/admin/page.tsx:100-120`; `src/lib/types.ts:55-57`; migrations `202607290003...:91-96`, `202608070001...:478-481`.
- **Доказательство — факт:** live `authenticated` имеет UPDATE на обе таблицы; RLS проверяет роль модератора, но не колонки/transition. Generic `updateProfile()` требует только moderator и принимает все `ProfileStatus`; UI показывает `published`, `suspended`, `blocked`, `archived`, хотя archive/restore actions требуют admin. Runtime test через object lookup не является строгим own-key allowlist.
- **Сценарий эксплуатации:** модератор вызывает Server Action или прямой PostgREST и меняет `owner_id`, status, slug, publication/verification attribution, contact/media content, обходя admin-only workflow.
- **Ущерб / вероятность:** захват/самопубликация профиля, подделка verification, обход блокировки; высокая вероятность для скомпрометированного или злонамеренного модератора.
- **Исправление:** явная transition matrix и field allowlist; admin-only для block/archive/restore и role/owner changes; узкие transactional RPC/server mutations; revoke generic table UPDATE/column privileges; база повторяет ту же границу.
- **Тесты:** moderator попытка каждого status transition, `owner_id`, verification actor и protected field; admin positive paths; prototype-key inputs; direct REST bypass.
- **Rollback/forward-fix:** сначала узкие RPC и callers, затем revoke broad UPDATE/policies. Forward-fix предпочтителен; не расширять admin membership как workaround.
- **Launch blocker:** yes. **Уверенность:** High.

### SEC-004 — Anonymous feedback bypass, spam и PII accumulation

- **Severity / status:** High; Open — confirmed locally and live.
- **Область:** public forms, direct PostgREST, spam, CSRF-like cross-origin submission, retention.
- **Объекты:** `public.reviews`, `public.complaints`; `/api/reviews`, `/api/complaints`; `supabase/schema.sql:95-96` и действующие live policies/grants.
- **Доказательство — факт:** live `anon` и `authenticated` имеют INSERT в обе таблицы. Policy отзывов ограничивает лишь publication/evidence flags; policy жалоб — status. Route handlers не имеют Origin/content-type/body-size/CAPTCHA/rate/idempotency controls и полностью буферизуют JSON. Direct REST обходит route validation и позволяет задать лишние колонки, включая complaint `internal_notes`.
- **Сценарий эксплуатации:** bot отправляет прямые Data API inserts или `text/plain` POST без CORS preflight, создаёт spam/PII/evidence links и неограниченный moderation backlog.
- **Ущерб / вероятность:** PII accumulation, abusive content, cost/availability, возможная подделка protected metadata; вероятность высокая после публикации endpoint.
- **Исправление:** если feature не запускается — deny и disable. Иначе revoke anon/auth table INSERT, controlled server/Edge gateway, strict allowlist/schema/content type/stream limit, CAPTCHA, durable throttling, idempotency, eligibility checks, moderation queue и retention.
- **Тесты:** direct anon/auth PostgREST deny; cross-origin simple request deny; oversized/duplicate/burst tests на staging; protected-field injection deny; valid gateway request succeeds once.
- **Rollback/forward-fix:** gateway сначала поддержать и протестировать, затем revoke direct DML. Не откатывать через возвращение anonymous INSERT.
- **Launch blocker:** yes. **Уверенность:** High.

### SEC-005 — Stale и нереплейный database bootstrap

- **Severity / status:** High; Open — confirmed locally.
- **Область:** deployment, schema provenance, disaster recovery, secure defaults.
- **Объекты:** `README.md:23-30`; `supabase/schema.sql`; весь `supabase/migrations/`; отсутствующий `supabase/config.toml`; `SECURITY_AUDIT.md:8-15`; `SECURITY_OPERATIONS.md:5-10`.
- **Доказательство — факт:** README предлагает выполнить только stale `schema.sql`, где остаются public reviews, anonymous writes, public avatars и demo seeds, но нет поздних hardening objects. Хронологический replay ломается: `202607280001` использует `applications.owner_id`, добавляемый в `202607280002`; `202607290003/4` используют `specialist_revisions`, создаваемый лишь в `202607290009`. Live state новее документации.
- **Сценарий эксплуатации/сбоя:** новый staging/restore создаётся по README либо migration replay падает; окружение получает неполную/небезопасную схему и иные ACL/RLS.
- **Ущерб / вероятность:** silent security drift, невозможность надёжного restore/release; вероятность высокая при следующем environment bootstrap.
- **Исправление:** не переписывать production history. Создать канонический squashed baseline для новых окружений, explicit grants/default privileges, отдельные seeds; clean-room replay CI и catalog diff с live.
- **Тесты:** пустой disposable project → baseline/migrations → tests; schema/ACL/policy/function/view diff; повторный replay; отсутствие demo/anon write; rollback rehearsal.
- **Rollback/forward-fix:** forward-only artefact для новых окружений; production migrations остаются immutable. Возврат — предыдущий проверенный baseline artifact.
- **Launch blocker:** yes. **Уверенность:** High.

### SEC-006 — Media cleanup удаляет используемые объекты

- **Severity / status:** High; Open — confirmed locally.
- **Область:** data integrity/availability, fail-closed behavior, service role.
- **Объекты:** `src/lib/media-cleanup.ts:17-31`; `src/app/cabinet/actions.ts:53-65`; `src/app/cabinet/page.tsx:22-24`; `src/app/api/media/view/route.ts:26`; `tests/specialist-revisions.test.mjs:81-85`.
- **Доказательство — факт:** ошибки трёх reference queries отбрасываются и превращаются в empty arrays, после чего service-role delete продолжается. Проверяется только `pending`, хотя `changes_requested` активна. Delete error игнорируется; snapshot/delete неатомарны. Текущий тест закрепляет только `pending`.
- **Сценарий эксплуатации/сбоя:** transient DB error или объект, используемый лишь `changes_requested`, выглядит orphan и удаляется; concurrent reference возникает после snapshot.
- **Ущерб / вероятность:** потеря media черновиков/публичных профилей, broken pages; вероятность средняя, impact высокий.
- **Исправление:** fail closed при любой query error; учитывать все active states; проверять delete result; tombstone + delayed retryable GC; повторная проверка ссылки непосредственно перед delete; metrics.
- **Тесты:** fault injection каждой query/delete, `changes_requested`, concurrent new reference, idempotent retry и recovery from tombstone.
- **Rollback/forward-fix:** сначала выключить destructive cleanup/перевести в report-only, затем внедрить delayed GC. Восстановление deleted bytes требует backup; поэтому restore доказательство обязательно.
- **Launch blocker:** yes. **Уверенность:** High.

### SEC-007 — Race и отсутствие idempotency у заявки

- **Severity / status:** High; Open — confirmed design flaw; exploit не запускался.
- **Область:** race conditions, duplicate submissions, email abuse.
- **Объекты:** `/api/applications`; `src/app/api/applications/route.ts:9,45,52`; schema/indexes `public.applications`.
- **Доказательство — факт:** limiter — process-local `Map`, проверяется до write и заполняется после insert. Он не разделяется между serverless instances и растёт без очистки. Live/database schema не содержит unique invariant «одна активная заявка на owner».
- **Сценарий эксплуатации:** два параллельных first requests проходят проверку до обновления Map и оба создают строки/email events.
- **Ущерб / вероятность:** дубли, конфликт moderation/email, рост очереди; вероятность высокая при retry/двойном клике даже без атакующего.
- **Исправление:** partial unique constraint или transactional RPC, idempotency key, compare/insert in DB; durable shared limiter. In-memory check оставить только оптимизацией.
- **Тесты:** 10–100 parallel submits в disposable staging; один active row и одно notification event; replay того же key; разные owners не блокируют друг друга.
- **Rollback/forward-fix:** сначала дедупликация существующих строк под контролем оператора, затем constraint/RPC. Откат constraint только при сохранённой server idempotency.
- **Launch blocker:** yes. **Уверенность:** High.

### SEC-008 — Race решений модерации

- **Severity / status:** High; Open — confirmed design flaw; exploit не запускался.
- **Область:** workflow integrity, concurrency, publication.
- **Объекты:** `src/app/admin/actions.ts:42-49`; publication logic `supabase/migrations/202607280002_product-test-fixes.sql:94-102`.
- **Доказательство — факт:** action читает status, затем выполняет unconditional service-role update без expected prior status/version. Publication выполняется при первом approve отдельно от последующего конкурентного решения.
- **Сценарий эксплуатации/сбоя:** approve и reject одновременно читают actionable status; approve публикует, reject становится финальным status. Получается public profile у rejected application.
- **Ущерб / вероятность:** нарушение moderation truth и audit, ошибочная публикация; вероятность средняя при нескольких модераторах/повторе запросов.
- **Исправление:** один locked transactional RPC: validate transition, compare version/status, publish/unpublish, enqueue email и append audit. Zero-row/stale response — конфликт, не success.
- **Тесты:** параллельные approve/reject/change-request; один terminal outcome; профиль, email и audit согласованы; replay idempotent.
- **Rollback/forward-fix:** новый RPC рядом со старым action, затем switch и удаление old write path. Исправление inconsistent rows — отдельный audited reconciliation.
- **Launch blocker:** yes. **Уверенность:** High.

### SEC-009 — Уязвимый production dependency graph

- **Severity / status:** High; Open — confirmed by current registry audit.
- **Область:** supply chain, image/build tooling.
- **Объекты:** `package.json`, `pnpm-lock.yaml:1626-1629,1736-1738,3656-3681,3781-3783`.
- **Доказательство — факт:** `pnpm audit --prod` завершился с 4 High и 2 Moderate. Paths: Next → `sharp 0.34.5` (patched `>=0.35.0`), Next → `postcss 8.4.31` (2 High/2 Moderate), PostCSS → `nanoid 3.3.16` (High). Full audit: 8 High/2 Moderate, включая dev `brace-expansion` и `js-yaml`.
- **Сценарий эксплуатации:** зависит от advisory: обработка изображения либо attacker-controlled build/content input. Для PostCSS/nanoid production exploitability частично условна, но release gate уже fail.
- **Ущерб / вероятность:** file read/path traversal/availability или build compromise в зависимости от path; вероятность от low до medium, impact высокий.
- **Исправление:** обновить до graph без известных High, сверить official changelogs, regenerate lockfile, выполнить clean install/test/build/media regression и повторный audit/SBOM scan.
- **Тесты:** audit prod/full = 0 unresolved High/Critical; image upload/view corpus; build from clean cache; dependency tree доказывает отсутствие старых versions.
- **Rollback/forward-fix:** отдельные малые dependency PR; хранить предыдущий lockfile; rollback версии только вместе с documented risk acceptance.
- **Launch blocker:** yes. **Уверенность:** High.

### SEC-010 — Нет AAL2/MFA gate для модераторов и администраторов

- **Severity / status:** High; Open — confirmed control gap; dashboard enrollment unknown.
- **Область:** privileged access, session theft, vertical escalation.
- **Объекты:** `src/lib/auth.ts:4-17`; все privileged Server Actions/routes; DB role helpers/policies.
- **Доказательство — факт:** поиск не нашёл MFA/AAL/AAL2/recent-auth enforcement. `requireModerator()` проверяет только valid user и membership row. Привилегированные DB paths также не проверяют AAL2.
- **Сценарий эксплуатации:** украденная обычная сессия модератора сразу позволяет читать заявки, публиковать/изменять профили и управлять email/moderation.
- **Ущерб / вероятность:** массовая integrity/privacy compromise; вероятность средняя, impact высокий.
- **Исправление:** обязательное MFA enrollment privileged accounts; `aal2` + recent-auth check на каждом privileged server boundary и в sensitive DB RPC/policy; recovery/admin bootstrap procedure.
- **Тесты:** AAL1 session получает deny для всех moderator/admin mutations и private reads; AAL2 succeeds; downgrade/expired/revoked token deny; direct RPC/REST не обходит gate.
- **Rollback/forward-fix:** staged enrollment с break-glass account, журналом и сроком; не отключать gate из-за одного потерянного factor — использовать audited recovery.
- **Launch blocker:** yes. **Уверенность:** High для отсутствия code gate; Low для dashboard enrollment state.

### SEC-011 — Leaked-password и Auth/email abuse controls

- **Severity / status:** Medium; Open — leaked-password disabled confirmed live, остальные settings unverified.
- **Область:** credential stuffing, signup/login/reset/magic-link abuse.
- **Объекты:** Supabase Auth settings; `src/app/login/actions.ts`; `src/app/register/actions.ts:15-83`; `src/app/forgot-password/page.tsx:7-10`.
- **Доказательство — факт:** Security Advisor сообщает leaked-password protection disabled. В app нет durable CAPTCHA/rate limits; resend limiter — process-local unbounded Map. **Не подтверждено:** Supabase Auth rate/CAPTCHA/password/session dashboard settings.
- **Сценарий:** bot напрямую вызывает Supabase Auth, обходя app limiter, выполняет credential stuffing или email bombing.
- **Ущерб / вероятность:** takeover, provider/domain reputation и cost; вероятность высокая для публичного Auth.
- **Исправление:** leaked-password checks, CAPTCHA/bot protection и conservative Auth rate limits на Supabase/edge; durable privacy-preserving throttle; monitoring; не раскрывать существование email.
- **Тесты:** staging burst/rate behavior без реального спама; breached password deny; response indistinguishability; reset/magic-link cooldown.
- **Rollback/forward-fix:** feature flags и мониторинг false positives; откат rate threshold, но не полного bot control.
- **Launch blocker:** yes для public release. **Уверенность:** High/Low соответственно подтверждённой/непроверенной части.

### SEC-012 — Нет проверяемого repository/release provenance

- **Severity / status:** High; Open — confirmed evidence gap.
- **Область:** SDLC, CI/CD, secrets history, supply chain.
- **Объекты:** переданный workspace; отсутствующие `.git`, CI manifests, CODEOWNERS, dependency bot, SBOM, hosting manifest.
- **Доказательство — факт:** `git status` и `git log` возвращают «not a git repository». Невозможно доказать branch/commit/dirty state/history. Enforcement для review, tests, migration diff, secret scan и deploy permissions не найден.
- **Сценарий:** непроверенный или изменённый artefact попадает в deploy; secret/unsafe migration остаётся вне audit; результат нельзя связать с commit.
- **Ущерб / вероятность:** полный обход release controls; вероятность средняя, impact высокий.
- **Исправление:** провести следующий этап в canonical Git worktree; protected branch/review; least-privilege CI OIDC; pinned actions; mandatory test/type/lint/build/audit/migration replay/RLS matrix/secret scan/SBOM; signed release provenance.
- **Тесты:** negative CI gates, fork PR permissions, artifact-to-commit attestation, clean clone reproducibility, secret history scan.
- **Rollback/forward-fix:** policy/config PRs отдельно; сохранённый last-known-good signed artefact; no direct production deploy.
- **Launch blocker:** yes. **Уверенность:** High относительно предоставленного каталога.

### SEC-013 — Backup/restore readiness

- **Severity / status:** High historical severity; `RECOVERY_READINESS_PROVEN` for the MVP recovery gate; recurring operational maturity remains open.
- **Область:** availability, ransomware/operator error, DR.
- **Объекты:** `SECURITY_OPERATIONS.md:23-29`; Supabase database, Storage objects, Auth/config/secrets.
- **Доказательство — факт:** owner-approved encrypted database + Storage generation создана вне Git; RPO/RTO утверждены; два fresh isolated local restore совпали по 47 table counts, 5 Auth users и SHA-256 всех 36 Storage objects. Temporary S3 key удалён до encryption, plaintext и disposable resources очищены. Manifest v2 классифицирует 67 configuration fields: 13 restorable, 48 exact manual re-entry, 6 not applicable, 0 critical unknowns; все 7 secret names имеют explicit source. Два независимых disposable Level 3 run и complete-project-loss walkthrough PASS без production/external-provider calls и без residual resources. Automated cadence, retention generations, measured incident-time RTO и lost-key exercise остаются maturity work.
- **Сценарий:** ошибочная миграция, cleanup bug или compromise уничтожает rows/media; команда не может доказуемо восстановить согласованный snapshot.
- **Ущерб / вероятность:** необратимая потеря PII/media и длительный outage; вероятность средняя, impact высокий.
- **Исправление:** зашифрованные DB + Storage + config backups, раздельные credentials/off-site/immutability, RPO/RTO; автоматическая проверка; quarterly isolated restore с reconciliation и documented evidence.
- **Тесты:** restore в isolated project, row/object/hash counts, Auth/config checklist, point-in-time objectives, lost-key exercise.
- **Rollback/forward-fix:** backup changes additive; не удалять предыдущие copies до успешной проверки новой цепочки.
- **Launch blocker:** no для MVP recovery readiness; ongoing cadence/retention and resilience maturity remain required operations, not a claim of an ideal backup system. **Уверенность:** High; Level 2 and Level 3 each passed twice with matching evidence and zero critical unknowns.

### SEC-014 — Отсутствует Supabase SSR Proxy

- **Severity / status:** High; Open — configuration confirmed, incident causality hypothesis.
- **Область:** Auth session lifecycle, refresh-token replay/race, availability.
- **Объекты:** отсутствующие `proxy.ts`/middleware; `src/lib/supabase/server.ts:11-26`; `@supabase/ssr` server client behavior.
- **Доказательство — факт:** Server Components подавляют cookie-write failure, хотя код предполагает Proxy; Proxy отсутствует. Browser helper использует singleton, поэтому «много browser clients» локально не подтверждено. Последние 24h live logs не содержат reuse events. **Гипотеза:** старые 75 `refresh_token_already_used` вызваны stale cookies/concurrent refresh из-за отсутствующего Proxy; требуются reproduction/longer logs.
- **Сценарий:** несколько Server Components/вкладок обновляют один single-use refresh token, ответные cookies не согласуются, session family инвалидируется.
- **Ущерб / вероятность:** неожиданный logout, denial of session, неверная интерпретация как abuse; вероятность средняя, impact высокий для Auth reliability.
- **Исправление:** documented Next 16 Proxy/session updater, `getClaims()`, обновление request и response cookies, request-scoped server client, корректные cache headers/exclusions.
- **Тесты:** short JWT lifetime, concurrent navigation/multi-tab, one coherent refresh, cookies на request/response, zero reuse events; invalid/revoked session deny.
- **Rollback/forward-fix:** feature branch + limited staging/canary; revert Proxy code и cookies together, не увеличивать reuse window как основное исправление.
- **Launch blocker:** yes. **Уверенность:** High для missing control, Medium для root cause.

### SEC-015 — SECURITY DEFINER public views

- **Severity / status:** Medium; Open — confirmed live.
- **Область:** public data projections, RLS bypass, Supabase Advisor.
- **Объекты:** `published_reviews`, `published_specialists`, `published_specialist_verification_facts`, `published_specialist_trust_badges`.
- **Доказательство — факт:** все четыре PostgreSQL-owned, `security_invoker=false`, `security_barrier=true`, доступны anon/auth и дают четыре Advisor ERROR. Текущие definitions имеют узкие columns/status filters; прямой data leak не найден.
- **Сценарий:** будущая правка view добавляет private column/relaxes filter и обходит RLS владельца view, сразу публикуя данные. Простое переключение invoker может сломать public read из-за закрытых base tables.
- **Ущерб / вероятность:** latent массовая privacy leak; вероятность средняя при schema evolution.
- **Исправление:** спроектировать public projection boundary с минимальными grants; по возможности `security_invoker=true` при подходящих underlying policies либо изолированная API schema/controlled function; contract tests exact columns/filters.
- **Тесты:** anon schemasnapshot, forbidden column names/rows, unpublished/blocked/private records, owner/base grants; Advisor review.
- **Rollback/forward-fix:** сначала параллельные v2 views и callers; не открывать private base tables anon. Rollback на предыдущую проверенную view definition.
- **Launch blocker:** yes для public release/zero-ERROR gate. **Уверенность:** High.

### SEC-016 — Избыточные ACL, function EXECUTE и mutable search_path

- **Severity / status:** Medium; Open — confirmed live.
- **Область:** least privilege, RPC, future schema drift.
- **Объекты:** live default ACL; 18 SECURITY DEFINER functions; 8 advisor search-path functions; broad table grants.
- **Доказательство — факт:** default ACL выдаёт future public tables широкие API privileges и future functions EXECUTE. 10 definer functions executable anon, 11 authenticated. Несколько trigger/internal functions видны как RPC. Большинство bodies имеют checks/trigger-only semantics; рабочий exploit не доказан. `public` schema даёт PUBLIC USAGE, но не CREATE, что снижает search-path exploitability.

Точный inventory среза:

| Категория | SQL objects / principals |
|---|---|
| Mutable `search_path` Advisor warnings | `public.track_application_status`, `public.set_updated_at`, `public.set_specialist_revision_updated_at`, `public.guard_owner_application_update`, `public.touch_email_notification`, `public.guard_owner_revision_update`, `public.set_trust_badge_updated_at`, `public.touch_site_content` |
| SECURITY DEFINER `EXECUTE` для anon и authenticated | `public.enqueue_application_email`, `public.enqueue_profile_hidden_email`, `public.enqueue_revision_email`, `public.is_admin`, `public.is_moderator`, `public.record_application_event`, `public.request_specialist_revision_changes`, `public.return_owner_changes_to_moderation`, `public.sync_account_profile`, `public.sync_published_verified_badge` |
| Дополнительно `EXECUTE` для authenticated | `public.apply_specialist_revision` |
| Broad default ACL | ACL owners `postgres` и `supabase_admin`: будущие public tables автоматически получают широкие privileges для API roles, будущие functions — `EXECUTE`; точный catalog snapshot должен стать CI artefact |

- **Сценарий:** новая таблица/функция автоматически становится Data API surface; забытая definer function вызывается напрямую; object shadowing влияет на mutable path при дополнительной ошибке привилегий.
- **Ущерб / вероятность:** расширение API/privilege escalation; вероятность средняя со временем.
- **Исправление:** opt-in default privileges; explicit operation matrix; revoke PUBLIC/anon/auth EXECUTE по умолчанию; expose только named RPC; fixed/empty search_path и fully qualified objects; удалить stale functions.
- **Тесты:** catalog ACL snapshot; anon/auth invoke каждого RPC; future dummy object в disposable DB остаётся private; search-path regression.
- **Rollback/forward-fix:** inventory exact grants до revoke; малыми forward migrations; rollback только конкретного caller, не `GRANT ALL`.
- **Launch blocker:** yes для public release. **Уверенность:** High для exposure, Medium/Low для exploitability.

### SEC-017 — Буферизация тела и resource abuse

- **Severity / status:** Medium; Open — confirmed code, edge impact unverified.
- **Область:** request smuggling-adjacent limits, memory/CPU/egress/storage DoS.
- **Объекты:** `/api/applications:13-23`; `/api/reviews:4-9`; `/api/complaints:4-10`; `/api/media:14-16`; `/api/media/view:34-50`.
- **Доказательство — факт:** handlers выполняют `text/json/formData` до фактического byte limit; Origin можно подделать raw client. Public media делает DB lookups, Storage download и Sharp re-encode на каждый cache miss; upload не имеет quota/rate/concurrency limit; arbitrary query params могут дробить cache. **Не подтверждено:** более низкий ingress body cap/WAF/CDN.
- **Сценарий:** oversized chunked body расходует память до 401/413; cache-busting media requests расходуют CPU/egress; uploads создают orphan storage.
- **Ущерб / вероятность:** instance exhaustion/cost/degradation; вероятность высокая для публичных маршрутов без edge control.
- **Исправление:** hard ingress + streamed application limits, auth before body where possible, canonical query keys/cache, immutable preprocessed derivatives, durable rate/concurrency/byte/object quotas, reservation/expiry.
- **Тесты:** staging oversized/lying-length/chunked, parallel requests/uploads, cache-key canonicalization, resource ceilings; не запускать против production.
- **Rollback/forward-fix:** вводить limits с metrics/canary; rollback threshold, не удаление защиты.
- **Launch blocker:** yes для public release. **Уверенность:** High/Low для app/edge частей.

### SEC-018 — Ненадёжный audit trail и неатомарные multi-write actions

- **Severity / status:** Medium; Open — confirmed locally.
- **Область:** audit logging, transaction integrity, accountability.
- **Объекты:** `src/app/admin/actions.ts:12,42-49,149-167,188-203`; `record_application_event()`; email enqueue callers.
- **Доказательство — факт:** `audit()` и ряд writes игнорируют errors; mutation обычно commit до audit. `moderateFeedback`/`updateAvatar` могут записать success audit без фактической mutation. Status/verification/badges меняются отдельными calls. Service-role application writes дают `auth.uid()=NULL` в event function.
- **Сценарий:** mutation проходит при failed audit либо конкурентный/частичный failure оставляет несогласованные status, verification, email и log.
- **Ущерб / вероятность:** отсутствие forensic truth и ошибочное состояние; вероятность средняя.
- **Исправление:** один transactional RPC на business transition; immutable append-only audit с explicit actor ID/request ID/before-after; fail closed; idempotent email event; удалить dead exported actions.
- **Тесты:** fault injection audit/email/write; вся transaction rolls back; concurrency; actor attribution; no audit-only success.
- **Rollback/forward-fix:** dual-read/verify new audit, затем switch; старые записи не переписывать без provenance marker.
- **Launch blocker:** yes для privileged public launch. **Уверенность:** High.

### SEC-019 — Недетерминированная supply chain и опасные E2E utilities

- **Severity / status:** Medium; Open — confirmed locally.
- **Область:** build reproducibility, environment safety, secret/artifact hygiene.
- **Объекты:** `package.json:17-22,27-31`; `pnpm-workspace.yaml`; `.env.local`; `.gitignore`; `outputs/`; `next-local.out.log`; `scripts/application-validation-remote-e2e-setup.cjs:42-55` и сходные remote scripts.
- **Доказательство — факт:** direct deps используют `latest`; Node/pnpm не pinned; build hook allowlist содержит placeholders; scripts читают `.env.local` и service role и могут создать remote users/data без project allowlist/opt-in. Outputs/logs содержат recipient/auth metadata; exact configured server secrets вне `.env.local` не найдены. Git tracking/history неизвестны.
- **Сценарий:** lock refresh/clean install меняет major graph; operator запускает destructive QA против production; auth code/PII попадает в artefact/history.
- **Ущерб / вероятность:** supply-chain drift, production mutation, secret/PII exposure; вероятность средняя.
- **Исправление:** exact semver, Node/pnpm pin, explicit build-script decisions, clean-install policy; remote scripts fail closed по allowlisted test project + confirmation + integrated cleanup; redact/ignore/protect artefacts; secret scan in CI.
- **Тесты:** clean install twice with identical graph/hash; ignored-build checks; negative script run on prod ref; log redaction and artifact scan.
- **Rollback/forward-fix:** version/CI changes малыми commits; remote scripts сначала dry-run; keep last known lockfile.
- **Launch blocker:** no отдельно, но входит в SEC-012/production audit gate. **Уверенность:** High.

### SEC-020 — Transport, cookie и deployed edge controls не доказаны

- **Severity / status:** Medium; Open — code gaps confirmed, deployment unverified.
- **Область:** HTTPS, cookies, CORS/headers, hosting/WAF.
- **Объекты:** `src/lib/navigation.ts:26-45`; Supabase client cookie options; `next.config.mjs`; `SECURITY_OPERATIONS.md:31-37`.
- **Доказательство — факт:** production canonical URL принимает HTTP; app не задаёт `Secure` cookie option явно, а library default его не содержит. Source headers сильные, но actual `Set-Cookie`, HSTS, redirects, CSP, CORS, CDN caching, WAF и body limits не проверены.
- **Сценарий:** misconfigured HTTP callback/first request передаёт session material без transport guarantee; edge не применяет ожидаемые headers/limits.
- **Ущерб / вероятность:** session exposure/CSRF-defense degradation/caching leak; вероятность зависит от hosting config.
- **Исправление:** fail startup/deploy при non-HTTPS public origin; explicit production Secure/SameSite cookies; automated deployed-header/TLS/cache/CORS checks; IaC для edge controls.
- **Тесты:** production-like staging `Set-Cookie`, HTTP→HTTPS, HSTS, no-store, CSP/CORS, cached private response denial, origin variants.
- **Rollback/forward-fix:** canary domain и cookie compatibility test; rollback whole cookie/origin change, не HSTS preload без readiness.
- **Launch blocker:** yes до проверки public hosting. **Уверенность:** High для code, Low для actual edge.

### SEC-021 — Observability, retention и incident response неполны

- **Severity / status:** Medium; Open — confirmed evidence gap.
- **Область:** detection/response, email reliability, privacy lifecycle.
- **Объекты:** email outbox/worker; `.catch(() => undefined)` в application/admin/cabinet; `SECURITY_OPERATIONS.md`; privacy page; application/review/complaint/email tables.
- **Доказательство — факт:** нет structured application logger, error tracker, health/metrics/alert rules, uptime monitor или scheduler config. Queue errors часто подавляются; worker отдаёт generic 500 без logging. Нет purge/retention implementation и полного incident playbook.
- **Сценарий:** abuse/failed email/authorization anomaly или breach остаётся незамеченным; PII хранится бессрочно; команда не имеет согласованного response/notification process.
- **Ущерб / вероятность:** длительный incident, privacy/compliance и availability impact; вероятность средняя.
- **Исправление:** structured redacted events, SLO/alerts, verified scheduler/dead-letter runbook; retention table per data class + purge/legal hold; incident roles/severity/escalation/communications/evidence/postmortem.
- **Тесты:** synthetic worker failure, alert delivery, queue age SLO; purge dry-run/restore; tabletop incident exercise.
- **Rollback/forward-fix:** observability additive; retention сначала report-only и backup, затем audited deletion.
- **Launch blocker:** yes до реальных данных для минимального monitoring/retention/IR set. **Уверенность:** High для repo evidence.

### SEC-022 — Weak «safe revision» classifier

- **Severity / status:** Medium; Open — confirmed locally.
- **Область:** content moderation integrity.
- **Объекты:** `src/app/admin/actions.ts:15-24,127-139`; `src/components/RevisionModeration.tsx:12-54`.
- **Доказательство — факт:** description считается risky только при абсолютной разнице длины >140; полностью иной текст той же длины классифицируется safe. Часть других public text fields всегда low-risk. Client и server дублируют правило.
- **Сценарий:** владелец заменяет public text на unrelated/abusive content той же длины; batch approve пропускает полноценный review.
- **Ущерб / вероятность:** нежелательная публикация; вероятность средняя при использовании batch flow.
- **Исправление:** field-specific rules, actual diff и обязательное explicit review; server — единственный policy source. Не называть semantic safety по length delta.
- **Тесты:** same-length replacement, Unicode normalization, links/contact injection, deletion/reordering; batch не approve risky change.
- **Rollback/forward-fix:** отключить auto/batch approve до новой модели; rollback к manual review.
- **Launch blocker:** no, если batch flow отключён до запуска. **Уверенность:** High.

### SEC-023 — RLS/index performance debt

- **Severity / status:** Medium; Open — confirmed live.
- **Область:** availability, policy maintainability.
- **Объекты:** 33 Supabase Performance Advisor notices: 15 unindexed FKs, 8 auth RLS initplan, 10 multiple permissive policies.
- **Доказательство — факт:** среди прочего отсутствуют owner/reference indexes, а несколько policies на одну action увеличивают planning/execution cost. Корректность exploit не доказана.

Точный Advisor inventory:

- **Unindexed FK constraints (15):** `application_events_actor_id_fkey`, `applications_category_id_fkey`, `applications_owner_id_fkey`, `audit_log_actor_id_fkey`, `complaints_review_id_fkey`, `complaints_specialist_id_fkey`, `email_notifications_application_id_fkey`, `email_notifications_revision_id_fkey`, `email_notifications_specialist_id_fkey`, `reviews_specialist_id_fkey`, `site_content_updated_by_fkey`, `specialist_revisions_moderator_id_fkey`, `specialist_trust_badges_assigned_by_fkey`, `specialists_category_id_fkey`, `verifications_checked_by_fkey`.
- **Auth initplan policies (8):** `moderators.Users read own moderator role`, `specialists.Owners read own specialists`, `applications.Owners read own applications`, `account_profiles.Users read own account profile`, `account_profiles.Users update own account profile`, `specialist_revisions.Owners read own revisions`, `application_events.Owners read own application events`, `email_notifications.Owners read own email notifications`.
- **Multiple permissive authenticated SELECT (10 tables):** `application_events`, `applications`, `categories`, `email_notifications`, `moderators`, `specialist_revisions`, `specialist_trust_badges`, `specialists`, `trust_badges`, `verifications`.

Advisor remediation reference: [Supabase Database Linter](https://supabase.com/docs/guides/database/database-linter).

- **Сценарий:** рост данных/запросов делает RLS scans дорогими; attacker усиливает cost публичными запросами.
- **Ущерб / вероятность:** latency/DB load и ошибки при эволюции policy; вероятность растёт с масштабом.
- **Исправление:** explain/analyze в staging, индексы по FKs/owner/filter columns; `(select auth.uid())`; консолидировать только семантически эквивалентные policies.
- **Тесты:** realistic dataset, query plans/latency, full role matrix после каждой policy rewrite.
- **Rollback/forward-fix:** `CREATE INDEX CONCURRENTLY` где доступно; каждый policy change отдельно и reversible.
- **Launch blocker:** no для limited staging; пересмотреть до scale. **Уверенность:** High.

### SEC-024 — CSP и logging residual risks

- **Severity / status:** Low; Open — confirmed locally.
- **Область:** XSS defense in depth, sensitive logs.
- **Объекты:** `next.config.mjs:3-17`; `next-local.out.log`; local output reports.
- **Доказательство — факт:** CSP разрешает `'unsafe-inline'` scripts/styles и широкие Supabase origins. XSS sink (`dangerouslySetInnerHTML`, eval, executable Markdown) не найден; React escaping действует. Logs содержат `code=` query parameters и identifiers; значения в этом отчёте не раскрываются.
- **Сценарий:** будущий injection получает меньше CSP containment; recovery/callback token-like query попадает в сборщик логов.
- **Ущерб / вероятность:** ограниченная session/privacy exposure при дополнительной уязвимости; вероятность low/medium.
- **Исправление:** nonce/hash CSP где совместимо, project-specific origins; редактировать sensitive query keys на первом logging layer; retention/access controls.
- **Тесты:** CSP report-only telemetry, XSS corpus, log scan запрещённых keys/PII.
- **Rollback/forward-fix:** CSP tighten через report-only/canary; logging redaction additive.
- **Launch blocker:** no отдельно. **Уверенность:** High.

### SEC-025 — Live drift вернул owner UPDATE auth-mirrored профиля

- **Severity / status:** Medium; Open — confirmed live schema drift.
- **Область:** account identity mirror, transactional email integrity, migration drift.
- **Объекты:** `public.account_profiles`; policy `Users update own account profile`; `supabase/migrations/202607300001_security_hardening.sql:24-26`; `enqueue_application_email()`, `enqueue_revision_email()`, `enqueue_profile_hidden_email()`.
- **Доказательство — факт:** live `authenticated` имеет UPDATE, а live policy разрешает владельцу обновлять всю собственную строку с колонками `id,email,display_name,avatar_url,created_at,updated_at`. Recorded migration `202607300001` содержит и в history, и локально явный `DROP POLICY "Users update own account profile"`, но policy снова существует live. Email trigger functions выбирают recipient из `account_profiles.email`. Причина повторного создания после recorded migration не установлена.
- **Сценарий эксплуатации:** authenticated user напрямую меняет mirrored `email` через PostgREST, затем его workflow notifications уходят на произвольный/чужой адрес; создаются unsolicited messages, privacy leak и расхождение с Auth identity. Cross-user update всё ещё ограничен owner predicate.
- **Ущерб / вероятность:** нарушение целостности identity/notification channel, раскрытие содержания собственных workflow сообщений третьей стороне, abuse репутации email; вероятность высокая для владельца своей строки, impact medium.
- **Исправление:** отдельной reviewed forward migration повторно revoke authenticated UPDATE/drop policy; изменять mirror только trusted `sync_account_profile`/Auth-trigger path с exact field allowlist. Провести полный live catalog drift diff и установить источник recreation.
- **Тесты:** owner direct UPDATE каждой колонки deny; trusted Auth email sync succeeds и совпадает с verified Auth identity; user B deny; queued recipient берётся только из authoritative value; catalog diff после deploy.
- **Rollback/forward-fix:** только forward-fix после проверки sync caller; rollback не должен возвращать owner email UPDATE. При несовместимости временно остановить email enqueue и исправить trusted sync, а не открыть policy.
- **Launch blocker:** yes до реальных transactional messages. **Уверенность:** High.

### SEC-026 — Public `site_content` раскрывает operational actor UUID

- **Severity / status:** Low; Open — confirmed live.
- **Область:** metadata/privacy minimization, public projection boundary.
- **Объекты:** `public.site_content.updated_by`; policy `Public reads site content`; `src/app/admin/page.tsx:44`.
- **Доказательство — факт:** live anon имеет table- и column-level SELECT на `updated_by`, а public RLS policy разрешает строку. UI выбирает безопасный content subset без этого поля, но direct PostgREST может запросить admin UUID.
- **Сценарий эксплуатации:** anon вызывает direct Data API `select=updated_by` и связывает operational identifier администратора с другими доступными metadata.
- **Ущерб / вероятность:** ограниченное раскрытие stable identifier и расширение reconnaissance; запрос тривиален, самостоятельный impact низкий.
- **Исправление:** убрать anon SELECT с base table и публиковать versioned safe projection/RPC только с content fields; согласовать с redesign public views.
- **Тесты:** exact public schema snapshot; anon protected-column request deny; public page content продолжает работать; admin update AAL2 path.
- **Rollback/forward-fix:** сначала safe projection/caller, затем revoke base access. Не открывать дополнительные base columns для совместимости.
- **Launch blocker:** no отдельно. **Уверенность:** High.

## 4. Проверенный control: целевая миграция

`supabase/migrations/20260809001646_enforce_server_only_specialist_writes.sql` не является находкой «не применена». Наоборот, подтверждено:

- SHA-256 точно равен `5E79860BA9D020F434EA704A69B31F3021EA0EC7A7A8CA672F50540681D142FD`;
- migration history live содержит её как последнюю версию;
- сохранённые 17 statements нормализованно равны локальному файлу;
- live revoke/policies/functions/triggers эквивалентны;
- direct write operations `INSERT/UPDATE/DELETE` для applications/revisions у `PUBLIC`, `anon`, `authenticated` закрыты; owner `SELECT` остаётся и рассматривается отдельно в SEC-002;
- изменения недеструктивны для данных, но deployment требует краткого trigger/table lock и согласованного server code;
- rollback в истории отсутствует; безопасная стратегия — точечный forward-fix, не generic regrant.

Оставшиеся SEC-002 и server-side ownership/audit ограничения находятся **вне** заявленной цели этой миграции и не означают, что она не сработала.

Равенство target migration не является равенством всей live schema локальной истории: SEC-025 подтверждает отдельный drift policy, относящийся к более ранней migration.

## 5. Подтверждённые положительные наблюдения

- RLS включена на всех обнаруженных live public/storage tables.
- Service role находится в `server-only` модуле и не найден в client bundle exact-value scan.
- Sensitive server authorization использует `getUser()`; `user_metadata` не используется как роль.
- Public projections сейчас исключают известные private contact/moderation columns.
- Media read path авторизуется и re-encode выполняется с pixel limit; SVG не принимается.
- Open redirect helper блокирует внешние `next` paths; backend SSRF sink не найден.
- `dangerouslySetInnerHTML`, `innerHTML`, `eval` и executable Markdown не найдены.
- Базовые security headers сильные; private/API paths настроены `no-store`.
- Lockfile содержит integrity hashes; 85 локальных тестов проходят.

Положительные наблюдения не снижают severity подтверждённых bypass paths и не являются доказательством готовности к публичному запуску.
