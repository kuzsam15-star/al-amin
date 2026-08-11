# AL-AMIN Security Hardening Plan

Дата плана: **2026-08-09**

Исходный baseline commit: `10df78b416ae872eeefe9e8c2c7a641bb6fce89c`

Рабочая ветка: `security/hardening`

Текущий release verdict: **BLOCKED**

Нормативные источники этого плана:

- `SECURITY_FINDINGS.md` — реестр из 26 findings и зафиксированные доказательства;
- `SECURITY_ROADMAP.md` — release gates, зависимости и безопасная последовательность работ;
- `SECURITY_TEST_MATRIX.md` — обязательные роли, отрицательные/положительные проверки и правила интерпретации результатов.

Этот документ готовит workflow. Он не закрывает findings, не разрешает production и не является доказательством прохождения тестов.

## 1. Правила исправлений

1. **Одна уязвимость — один логический change.** Change set должен защищать один явно названный security-инвариант. Сопутствующие рефакторинги, обновления зависимостей и несвязанные hardening-изменения выполняются отдельно.
2. **Перед изменением создаётся threat analysis.** В нём фиксируются actor, asset, prerequisite, attack path, impact, ожидаемый инвариант, границы изменения, зависимости и различие между подтверждённым фактом и гипотезой.
3. **До реализации фиксируется воспроизводимый before-state.** Для finding выбирается хотя бы один тест, который безопасно демонстрирует нарушение в локальной или disposable staging среде. Mutating security tests запрещены против production.
4. **После изменения обязателен security test.** Нужны отрицательные bypass-тесты и положительные allowlisted-сценарии. `PASS (static)` не заменяет runtime/integration test, а `NOT RUN` не считается `PASS`.
5. **После тестов создаётся commit.** Commit создаётся только после прохождения целевых тестов и релевантной регрессии; он содержит один security-инвариант и ссылку на finding/evidence.
6. **Database changes только forward-only.** Уже применённые production migrations не переписываются. Любой DDL сначала проходит clean-room replay, catalog diff, role matrix и rollback/forward-fix rehearsal в отдельном disposable проекте.
7. **Сначала узкий совместимый путь, затем отзыв broad path.** Нельзя исправлять permission error через `GRANT ALL`, новый широкий `SECURITY DEFINER` или открытие private base tables.
8. **Rollback не должен возвращать уязвимость.** Предпочтительны выключение нового worker/path, возврат caller на ранее проверенный узкий интерфейс или forward-fix. Broad DML/ACL не восстанавливаются как аварийная мера.
9. **Evidence обязательно привязывается к commit.** Для закрытия finding сохраняются before-fail, after-pass, regression result, среда, роли, fixtures, фактический результат и идентификатор артефакта.
10. **Production запрещён до полного прохождения roadmap.** До выполнения соответствующего release gate нельзя применять migrations, менять Auth/Storage/hosting, запускать mutating tests или переносить change в production. Отдельное явное разрешение на production обязательно даже после staging.

Минимальный цикл каждой карточки:

`Open → Threat analyzed → Before test reproduced → Change implemented locally → Disposable staging verified → Reviewed → Committed → Finding verified/closed`.

## 2. Приоритет исправлений

Ниже используются **workflow-приоритеты**, заданные для hardening-процесса. Они не меняют исходную `Severity`, не снимают `Launch blocker` и не заменяют порядок/зависимости `SECURITY_ROADMAP.md`. Если тематическая линия ниже отличается от номера задачи в roadmap, действует более строгий release gate roadmap.

### P0 blockers

| Тема | Findings |
|---|---|
| Доступ к media в обход moderation | SEC-001, SEC-006 |
| Owner column exposure | SEC-002 |
| Moderator privilege boundaries | SEC-003 |
| Anonymous writes | SEC-004 |
| Concurrency/race conditions | SEC-007, SEC-008 |
| Restore/provenance и drift gaps | SEC-005, SEC-012, SEC-013, SEC-025 |

**P0 inventory:** SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-012, SEC-013, SEC-025.

### P1

| Тема | Findings |
|---|---|
| Auth hardening, SSR session lifecycle | SEC-010, SEC-014 |
| MFA/AAL2 | SEC-010 |
| Leaked password protection и Auth abuse controls | SEC-011 |
| Dependency vulnerabilities и supply chain | SEC-009, SEC-019 |
| Security headers, transport, cookie, CSP | SEC-020, SEC-024 |
| Monitoring, retention, incident response | SEC-021 |
| Audit improvements и atomic multi-write | SEC-018 |
| ACL/view/resource-boundary hardening | SEC-015, SEC-016, SEC-017 |

**P1 inventory:** SEC-009, SEC-010, SEC-011, SEC-014, SEC-015, SEC-016, SEC-017, SEC-018, SEC-019, SEC-020, SEC-021, SEC-024.

SEC-016 остаётся частью ранней database-baseline работы `P0-02` roadmap, а SEC-024 — частью launch-control `P0-12`, несмотря на их тематическое размещение здесь. Это не понижение приоритета release gate.

### P2

| Тема | Findings |
|---|---|
| Архитектурное улучшение moderation | SEC-022 |
| Performance/security debt | SEC-023 |
| Дополнительная data-minimization проверка | SEC-026 |

**P2 inventory:** SEC-022, SEC-023, SEC-026.

### Зависимости выполнения

1. Сначала завершаются оставшиеся controls `P0-01` и создаётся явно изолированная disposable staging среда с synthetic data и test-only keys.
2. Затем выполняется воспроизводимый database baseline и least-privilege inventory (`P0-02`), без переписывания production migration history.
3. После `P0-02` разблокируются media, owner projection, moderator boundary, anonymous-write и restore workstreams.
4. Concurrency fixes зависят от утверждённой state machine и узких transactional interfaces.
5. Destructive media cleanup зависит от immutable-media boundary и доказанного DB+Storage restore.
6. P1 runtime/deployed controls проверяются только в production-like staging; DAST выполняется последним и только после отдельного разрешения.

## 3. Карточки findings

Все пути и database objects ниже являются предварительной областью анализа, а не разрешением на изменение. Точный scope утверждается в threat analysis соответствующего change.

### SEC-001 — Прямая замена опубликованного media

- **ID:** SEC-001
- **Название:** Замена опубликованного media через прямой Storage API.
- **Severity:** High; launch blocker.
- **Affected components:** Supabase Storage ownership/policies, upload/view routes, moderation и publication integrity.
- **Current evidence:** `authenticated` имеет live DML на `storage.objects`; owner policy разрешает изменения в собственном prefix, а опубликованная карточка продолжает ссылаться на тот же изменяемый object path.
- **Threat:** Владелец после approval заменяет или удаляет публичные bytes без новой revision и moderation.
- **Expected secure behavior:** Canonical published object immutable; новый случайный path создаёт только controlled server writer; publication переключается атомарно после approval; orphan objects ограничены quota/expiry и удаляются безопасно.
- **Files likely affected:** `src/app/api/media/route.ts`, `src/app/api/media/view/route.ts`, `src/lib/media-paths.ts`, новая forward migration и media tests.
- **Database objects likely affected:** `storage.objects`, bucket `profile-media`, Storage grants/policies, revision/publication linkage.
- **Required tests:** ST-03, ST-04, ST-05, ST-06, ST-07, ST-09, ST-11, ST-12; direct owner insert/update/delete canonical path deny; cross-owner deny; approved gateway positive; published hash unchanged until approval; quota/expiry/cache checks.
- **Rollback strategy:** Сначала совместимый server writer и canary, затем revoke broad path; rollback отключает новый writer/переключение, но не возвращает broad Storage DML.
- **Risk of fixing:** Высокий — неверный rollout может остановить upload, оставить orphan objects или снова открыть overwrite.
- **Dependencies:** P0-01 controls, P0-02 reproducible DB baseline, disposable Storage fixtures, publication transaction, restore evidence.
- **Status:** `INDEPENDENTLY_REVIEWED_LOCAL_READY_FOR_CONTROLLED_DEPLOYMENT`; P0-03C production gate is `BLOCKED_BY_RECOVERY_AND_RELEASE_OPERATIONS`. Adversarial review, two deployment rehearsals, and two final role-matrix runs PASS, but no dated DB+Storage/config restore proof, approved production migration/source runner, production backfill wrapper, or monitoring window exists. Live risk remains until those gates, approved deployment, existing-media backfill, Phase B enforcement, and post-deployment verification complete.

### SEC-002 — Owner column exposure

- **ID:** SEC-002
- **Название:** Владелец заявки читает moderator-only колонки.
- **Severity:** High; launch blocker.
- **Affected components:** `applications`, PostgREST read boundary, cabinet projection, PII/moderation confidentiality.
- **Current evidence:** Row-level owner policy не ограничивает колонки; table-level `SELECT` позволяет прямое чтение `internal_notes`, `call_at` и workflow metadata в обход безопасного UI projection.
- **Threat:** Авторизованный owner извлекает внутренние заметки и поля процесса прямым API-запросом.
- **Expected secure behavior:** Owner получает только exact allowlist через safe view/RPC/server response; protected columns доступны лишь AAL2 privileged gateway; base-table read не является публичным контрактом.
- **Files likely affected:** `src/app/cabinet/page.tsx`, новая projection/contract tests и forward migration; определения `applications` используются только как контекст, а не переписываются.
- **Database objects likely affected:** `public.applications`, table/column grants, owner policy, owner-safe projection или RPC.
- **Required tests:** DB-02, DB-03, DB-04, DB-23; deny каждой protected column; safe owner fields succeed; user B cannot read user A; moderator/admin projection positive.
- **Rollback strategy:** Сначала добавить и подключить safe projection, затем отозвать base access; rollback caller допустим только к другому проверенному узкому interface.
- **Risk of fixing:** Средний — ошибочный grant сохранит leak либо сломает cabinet reads.
- **Dependencies:** P0-02 catalog/replay, точные owner/moderator/admin field contracts, disposable role fixtures.
- **Status:** Open — confirmed live; tests not run.

### SEC-003 — Moderator privilege boundaries

- **ID:** SEC-003
- **Название:** Модератор обходит admin-only transitions и protected fields.
- **Severity:** High; launch blocker.
- **Affected components:** admin actions, specialist/verification workflow, role boundary, publication state.
- **Current evidence:** Broad UPDATE и role-based RLS не ограничивают колонки/переходы; generic action принимает все значения `ProfileStatus`.
- **Threat:** Moderator изменяет owner/status/slug/verification attribution или выполняет admin-only transition.
- **Expected secure behavior:** Утверждённая transition matrix, field allowlist, AAL2 и узкие transactional mutations с совпадающим DB enforcement.
- **Files likely affected:** `src/app/admin/actions.ts`, `src/app/admin/page.tsx`, `src/lib/types.ts`, новая forward migration и role tests.
- **Database objects likely affected:** `public.specialists`, `public.verifications`, moderator grants/policies, narrow RPCs.
- **Required tests:** DB-07, DB-08, DB-16, DB-21, DB-24, DB-25, AU-05, RT-11; все transitions/fields; AAL1 deny; direct REST/RPC bypass deny; admin positive.
- **Rollback strategy:** Сначала deploy narrow RPC/caller, затем revoke broad UPDATE; не расширять membership или grants как workaround.
- **Risk of fixing:** Высокий — неполная state machine может заблокировать moderation или оставить обход.
- **Dependencies:** P0-02, утверждённая state machine, AAL2 design, stable actor/audit contract.
- **Status:** Open — confirmed live; tests not run.

### SEC-004 — Anonymous writes

- **ID:** SEC-004
- **Название:** Прямой anonymous INSERT отзывов/жалоб и spam bypass.
- **Severity:** High; launch blocker.
- **Affected components:** public forms/routes, PostgREST grants/policies, abuse controls, PII retention.
- **Current evidence:** `anon`/`authenticated` могут напрямую вставлять reviews/complaints, обходя route validation; gateway не доказывает origin/content-type/size/CAPTCHA/durable rate/idempotency controls.
- **Threat:** Bot создаёт spam, protected-field payloads и PII/evidence backlog прямым REST или cross-origin request.
- **Expected secure behavior:** Feature выключена либо все writes идут через controlled validating gateway; direct DML запрещён; есть durable rate, idempotency, retention и monitoring.
- **Files likely affected:** `src/app/api/reviews/route.ts`, `src/app/api/complaints/route.ts`, gateway/config/tests и новая forward migration.
- **Database objects likely affected:** `public.reviews`, `public.complaints`, INSERT grants/policies, moderation queue/retention objects при сохранении feature.
- **Required tests:** DB-05, DB-06, DB-22, RT-03, RT-04, RT-13, AU-08, OP-13; direct/cross-origin/protected-field/oversize/duplicate/burst deny; один valid request succeeds once.
- **Rollback strategy:** Gateway canary до revoke; при проблеме выключить submission, но не возвращать anonymous INSERT.
- **Risk of fixing:** Средний/высокий — false positives могут блокировать legitimate feedback, incomplete gateway сохранит bypass.
- **Dependencies:** P0-01/P0-02, product launch decision, CAPTCHA/rate infrastructure, retention policy.
- **Status:** Open — confirmed locally and live; tests not run.

### SEC-005 — Нереплейный database bootstrap

- **ID:** SEC-005
- **Название:** Stale и невоспроизводимый database bootstrap.
- **Severity:** High; launch blocker.
- **Affected components:** schema provenance, deployment, secure defaults, disaster recovery.
- **Current evidence:** README указывает на stale `schema.sql`; migration dependency order не воспроизводит доказанно live schema; `supabase/config.toml` отсутствует.
- **Threat:** Новый staging/restore либо не запускается, либо получает неполные/небезопасные ACL, RLS и objects.
- **Expected secure behavior:** Canonical forward baseline для новых сред, explicit grants/default privileges, отдельные seeds, clean-room replay и catalog diff без изменения applied production history.
- **Files likely affected:** `README.md`, future bootstrap/config/CI fixtures и новая baseline migration/artifact; существующие migrations неизменны.
- **Database objects likely affected:** Полный catalog: schemas, tables, policies, grants, functions, views, triggers, seeds.
- **Required tests:** MIG-07, MIG-08, OP-08 и полная DB role matrix; empty-project replay, second replay, catalog/ACL diff, no demo/anonymous writes, rollback rehearsal.
- **Rollback strategy:** Forward-only baseline artifact только для новых сред; хранить предыдущий verified artifact; не переписывать history.
- **Risk of fixing:** Высокий — неверный baseline закрепит drift или создаст unsafe environments.
- **Dependencies:** Local Git baseline, isolated disposable Supabase project, catalog snapshot tooling, CI provenance.
- **Status:** Open — confirmed locally; tests not run.

### SEC-006 — Fail-open media cleanup

- **ID:** SEC-006
- **Название:** Media cleanup удаляет используемые objects при ошибках/гонке.
- **Severity:** High; launch blocker.
- **Affected components:** `media-cleanup`, Storage availability, specialist/revision references, error handling.
- **Current evidence:** Reference-query errors превращаются в empty arrays, deletion продолжается; `changes_requested` не учитывается; delete errors игнорируются; snapshot/delete неатомарны.
- **Threat:** Transient fault или concurrent reference приводит к необратимому удалению активного media.
- **Expected secure behavior:** Cleanup fail closed, знает все active states, использует tombstone/delay/recheck, проверяет delete result и публикует metrics.
- **Files likely affected:** `src/lib/media-cleanup.ts`, cabinet callers, media view route и media cleanup tests.
- **Database objects likely affected:** Specialist/revision media references, Storage objects, будущий tombstone/GC state.
- **Required tests:** ST-08, ST-12; fault injection каждого query/delete; `changes_requested`; concurrent reference; idempotent retry; restore/reconciliation.
- **Rollback strategy:** Safe fallback — report-only или остановка GC worker; не возвращать destructive fail-open behavior.
- **Risk of fixing:** Высокий — преждевременное включение может потерять media; report-only временно увеличивает storage usage.
- **Dependencies:** SEC-001 immutable-media design, P0-03, P0-11 DB+Storage restore, inventory всех reference states.
- **Status:** Open — confirmed locally; tests not run.

### SEC-007 — Application race/idempotency

- **ID:** SEC-007
- **Название:** Race создаёт duplicate applications и events.
- **Severity:** High; launch blocker.
- **Affected components:** application route, database invariants, limiter/idempotency, email/outbox.
- **Current evidence:** Process-local `Map` не shared и обновляется после insert; database invariant «одна active application на owner» отсутствует.
- **Threat:** 10–100 parallel first requests создают несколько active rows и side effects.
- **Expected secure behavior:** Transactional submit, утверждённый partial unique invariant, idempotency key и durable privacy-preserving limiter; ровно один business event.
- **Files likely affected:** `src/app/api/applications/route.ts`, application concurrency tests и новая forward migration/RPC.
- **Database objects likely affected:** `public.applications`, unique/index invariant, submit RPC, email/outbox event.
- **Required tests:** RT-02, DB-23, EM-04; synchronized parallel barrier; exactly one active row/event; same-key replay; different owners independent.
- **Rollback strategy:** Сначала auditable deduplication/reconciliation; constraint снимается только при сохранённой server idempotency защите.
- **Risk of fixing:** Высокий — неверное определение active может блокировать valid resubmission или конфликтовать с текущими duplicates.
- **Dependencies:** P0-02, P0-05 state machine, approved active semantics, synthetic concurrency fixtures.
- **Status:** Open — confirmed design flaw; exploit not run.

### SEC-008 — Moderation decision race

- **ID:** SEC-008
- **Название:** Конкурирующие moderation decisions оставляют inconsistent publication state.
- **Severity:** High; launch blocker.
- **Affected components:** admin actions, application/specialist state, audit и email/outbox.
- **Current evidence:** Action читает status и затем делает unconditional service-role update; publication и competing terminal decision выполняются отдельными writes.
- **Threat:** Concurrent approve/reject/change-request оставляет опубликованный profile у rejected application или расходящиеся audit/email events.
- **Expected secure behavior:** Один locked/versioned transactional RPC проверяет expected state и атомарно меняет state, publication, audit и outbox; conflict явный и replay idempotent.
- **Files likely affected:** `src/app/admin/actions.ts`, moderation concurrency tests и новая forward RPC migration.
- **Database objects likely affected:** `applications`, `specialists`, audit/event tables, email outbox, moderation RPC.
- **Required tests:** DB-09, DB-18, RT-09, EM-02, EM-04, AD-01, AD-02, AD-03; parallel terminal outcomes; exactly one result; consistent profile/audit/email; replay.
- **Rollback strategy:** Versioned RPC рядом со старым path, затем caller switch и удаление broad write path; existing inconsistencies исправляются отдельным audited reconciliation.
- **Risk of fixing:** Высокий — transaction/state ошибки могут deadlock moderation или выбрать неверный terminal state.
- **Dependencies:** P0-02, SEC-003/P0-05 state machine, atomic audit/outbox design.
- **Status:** Open — confirmed design flaw; exploit not run.

### SEC-009 — Vulnerable production dependencies

- **ID:** SEC-009
- **Название:** Уязвимый production dependency graph.
- **Severity:** High; launch blocker.
- **Affected components:** package graph, image/build tooling, supply chain.
- **Current evidence:** Baseline registry audit зафиксировал unresolved High/Moderate advisories, включая Sharp/PostCSS/nanoid paths.
- **Threat:** Advisory-dependent input или build path может дать file-read/traversal/availability/build compromise.
- **Expected secure behavior:** Reproducible pinned graph без unresolved Critical/High либо с формально ограниченным exception; clean-cache build и image corpus проходят.
- **Files likely affected:** `package.json`, `pnpm-lock.yaml`, runtime/toolchain pins и CI verification.
- **Database objects likely affected:** Нет.
- **Required tests:** OP-01–OP-05, ST-05–ST-07; production/full audit, clean install/build, exact dependency-tree exclusion, media corpus, SBOM.
- **Rollback strategy:** Малые version changes с сохранённым previous lockfile; rollback только с documented risk acceptance.
- **Risk of fixing:** Средний/высокий — framework/native image/build upgrades могут вызвать runtime/deploy regression.
- **Dependencies:** P0-01 provenance/CI, official changelog review, isolated clean-install environment.
- **Status:** Open — confirmed by baseline audit; no package change in P0-01C.

### SEC-010 — MFA/AAL2 gate

- **ID:** SEC-010
- **Название:** Нет AAL2/MFA gate для privileged actions.
- **Severity:** High; launch blocker.
- **Affected components:** Auth, moderator/admin routes/actions, privileged RPC/policy boundary.
- **Current evidence:** Код не проверяет MFA/AAL2/recent-auth; `requireModerator()` доказывает только user и membership; dashboard enrollment неизвестен.
- **Threat:** Украденная AAL1 session получает immediate privileged access.
- **Expected secure behavior:** Обязательное enrollment/recovery и fresh AAL2 на каждом privileged server и sensitive DB boundary; direct REST/RPC bypass невозможен.
- **Files likely affected:** `src/lib/auth.ts`, privileged routes/actions, session helpers и Auth tests.
- **Database objects likely affected:** Moderator/admin helpers, sensitive RPCs/policies; Supabase Auth configuration.
- **Required tests:** AU-05, AU-07, DB-07, DB-08, DB-16, DB-21, DB-22, DB-23, DB-25; AAL1 deny everywhere; AAL2 positive; expired/downgraded/revoked deny.
- **Rollback strategy:** Staged enrollment с audited break-glass/recovery; нельзя просто отключать gate при потере factor.
- **Risk of fixing:** Высокий operational risk — неверный rollout может lock out administrators.
- **Dependencies:** P0-02/P0-05, staging privileged accounts, recovery process, Auth settings access, SSR session design.
- **Status:** Open — confirmed control gap; dashboard enrollment unverified.

### SEC-011 — Leaked-password/Auth abuse controls

- **ID:** SEC-011
- **Название:** Leaked-password protection и public Auth abuse controls не доказаны.
- **Severity:** Medium; launch blocker.
- **Affected components:** signup/login/reset/magic-link, Supabase Auth settings, rate/CAPTCHA controls.
- **Current evidence:** Leaked-password protection disabled live; durable CAPTCHA/rate controls не доказаны; resend limiter process-local; dashboard settings неполны.
- **Threat:** Bot обходит app limiter и атакует Auth endpoints напрямую либо злоупотребляет email delivery.
- **Expected secure behavior:** Leaked-password protection, CAPTCHA/bot control, conservative platform rates, privacy-preserving durable throttle и monitoring.
- **Files likely affected:** login/register/forgot-password flows, abuse config/tests; dashboard settings меняются только в отдельном разрешённом этапе.
- **Database objects likely affected:** Public DB objects не требуются; Supabase Auth configuration.
- **Required tests:** AU-06, AU-08, AU-14, RT-03, RT-04, EM-03, EM-04; breached password deny; burst/cooldown; response indistinguishability; replay.
- **Rollback strategy:** Thresholds настраиваются через staged rollout/monitoring; bot control полностью не снимается.
- **Risk of fixing:** Средний — false positives, login/delivery disruption.
- **Dependencies:** Dashboard inventory, CAPTCHA/edge design, synthetic test accounts, monitoring.
- **Status:** Open — partly confirmed live; mutating tests not run.

### SEC-012 — Repository/release provenance

- **ID:** SEC-012
- **Название:** Нет полного проверяемого repository/CI/release provenance.
- **Severity:** High; launch blocker.
- **Affected components:** Git baseline, review/CI/CD, artifact provenance, secrets history, deploy controls.
- **Current evidence:** Исходный audit snapshot не имел `.git`, CI manifests и release controls. P0-01B уже создал verified local Git baseline, branch и tag, но remote review, CI, SBOM, attestation и deploy provenance отсутствуют.
- **Threat:** Непроверенный artifact может попасть в deploy без доказуемой связи с reviewed commit.
- **Expected secure behavior:** Protected review, least-privilege CI, pinned actions, mandatory gates и artifact-to-commit attestation.
- **Files likely affected:** Будущие CI manifests, CODEOWNERS/review policy, scan configs, SBOM/provenance metadata.
- **Database objects likely affected:** Нет напрямую; migration/catalog evidence становится CI artifact.
- **Required tests:** OP-04, OP-06, OP-07; negative CI gates, fork permissions, attestation, clean-clone reproducibility, secret-history scan.
- **Rollback strategy:** Policy/config commits отдельно; retain last-known-good signed artifact; no direct production deploy.
- **Risk of fixing:** Средний — неверно scoped CI credentials/bypass rules создадут новый release path.
- **Dependencies:** P0-01B local baseline, будущий explicit remote/protected-branch decision, isolated CI credentials.
- **Status:** In progress — local baseline complete; CI/release provenance remains open.

### SEC-013 — Backup/restore evidence gap

- **ID:** SEC-013
- **Название:** DB+Storage backup/restore не доказаны.
- **Severity:** High; launch blocker.
- **Affected components:** Database, Storage, Auth/config inventory, RPO/RTO и disaster recovery.
- **Current evidence:** Нет job/config/off-site copy/restore report или Storage bytes proof; database backup сам по себе не восстанавливает Storage objects.
- **Threat:** Destructive bug/operator compromise уничтожает rows/media без coherent recovery.
- **Expected secure behavior:** Encrypted separated DB+Storage+critical-config backup, immutable retention и регулярный isolated restore с reconciliation.
- **Files likely affected:** Operations runbooks/config/evidence records, `docs/security/SECURITY_OPERATIONS.md` при его создании на отдельном этапе.
- **Database objects likely affected:** Full Supabase Database catalog/data, Storage objects, Auth/config inventory.
- **Required tests:** OP-09, ST-12, OP-14; isolated restore, row/object/hash reconciliation, RPO/RTO, corrupted copy и lost-key exercise.
- **Rollback strategy:** Backup changes additive; старые copies сохраняются до многократной проверки новой chain; restore только в isolated target.
- **Risk of fixing:** Средний — retention/custody mistake может уничтожить единственную рабочую copy.
- **Dependencies:** P0-01/P0-02, isolated restore project, admin backup access, approved RPO/RTO и secret custody.
- **Status:** Open — P0-11 Level 0 policy/runbook evidence prepared. The current
  Free plan has no managed daily recovery point or PITR; no owner-approved
  logical DB/Storage artifacts or paid isolated target exist, so DB+Storage+config
  restore and reconciliation remain unproved. `MANUAL_OWNER_APPROVAL_REQUIRED`.

### SEC-014 — Supabase SSR Proxy/session lifecycle

- **ID:** SEC-014
- **Название:** Отсутствует Supabase SSR Proxy; refresh-reuse causality не доказана.
- **Severity:** High; launch blocker.
- **Affected components:** Next.js SSR session refresh, request/response cookies, Auth cache/session lifecycle.
- **Current evidence:** Server client подавляет cookie-write failure, Proxy/middleware отсутствует; исторические reuse events есть, но causal link остаётся hypothesis.
- **Threat:** Concurrent refresh оставляет stale cookies и invalidates token family, вызывая session loss/replay risk.
- **Expected secure behavior:** Documented request-scoped Proxy/session updater, coherent request/response cookies, correct cache exclusions и fail-closed invalid/revoked session behavior.
- **Files likely affected:** Будущий `proxy.ts`/middleware, `src/lib/supabase/server.ts`, Auth/session integration tests.
- **Database objects likely affected:** Нет; Supabase Auth sessions/logs/config.
- **Required tests:** AU-03, AU-04, AU-07, AU-09, AU-14; short-JWT concurrent navigation/multi-tab; both cookie directions; no token reuse; invalid/revoked deny.
- **Rollback strategy:** Canary; Proxy и cookie change откатываются как единое целое; reuse window не расширяется как основное исправление.
- **Risk of fixing:** Высокий operational risk — cookie mismatch может вызвать login loops/mass logout.
- **Dependencies:** Exact installed Next/@supabase/ssr contract, production-like staging, Auth log observation, SEC-020 cookie design.
- **Status:** Open — configuration confirmed; incident causality hypothesis.

### SEC-015 — SECURITY DEFINER public views

- **ID:** SEC-015
- **Название:** Public views работают с definer semantics.
- **Severity:** Medium; launch blocker.
- **Affected components:** Public projections, base-table RLS boundary, Supabase Advisor.
- **Current evidence:** Четыре PostgreSQL-owned views имеют `security_invoker=false`, доступны anon/auth и создают Advisor errors; текущая фактическая утечка не доказана.
- **Threat:** Будущее изменение view незаметно exposes private rows/columns в обход RLS.
- **Expected secure behavior:** Exact minimal public projection через проверенный invoker/API-schema/controlled-function design без broad base grants.
- **Files likely affected:** Future forward migration, public callers и projection contract tests.
- **Database objects likely affected:** `published_reviews`, `published_specialists`, `published_specialist_verification_facts`, `published_specialist_trust_badges`, grants/base policies.
- **Required tests:** DB-10, DB-14, DB-21, OP-11; exact anon schema; forbidden/unpublished/blocked/private deny; base-grant and Advisor review.
- **Rollback strategy:** Parallel v2 projection, caller switch, затем revoke; не открывать private base tables для совместимости.
- **Risk of fixing:** Высокий при механическом изменении — invoker может сломать reads или спровоцировать broad grants.
- **Dependencies:** P0-02/P1-01, exact public contract, coordinated caller migration.
- **Status:** Open — confirmed live; leak not demonstrated.

### SEC-016 — ACL/RPC EXECUTE/search_path

- **ID:** SEC-016
- **Название:** Избыточные grants/default ACL/RPC EXECUTE и mutable search_path.
- **Severity:** Medium; launch blocker.
- **Affected components:** Database least privilege, SECURITY DEFINER functions, future schema defaults.
- **Current evidence:** Broad default ACL, 18 definer functions, anon/auth-callable internal functions и восемь mutable-search-path warnings; direct exploit не доказан.
- **Threat:** Новый object автоматически становится API surface либо забытый definer RPC остаётся callable.
- **Expected secure behavior:** Opt-in default privileges, exact EXECUTE allowlist, fixed/empty search_path, qualified references и catalog drift gate.
- **Files likely affected:** Forward ACL/function migrations, catalog snapshots и DB role tests.
- **Database objects likely affected:** Default ACLs, 18 definer functions, восемь search-path functions и broad table grants из finding inventory.
- **Required tests:** DB-11, DB-12, DB-13, DB-25, MIG-07; exact ACL snapshot; invoke every RPC by role; future dummy object private; search-path regression.
- **Rollback strategy:** До revoke exact inventory; small forward migration; восстанавливать только конкретный required grant, никогда `GRANT ALL`.
- **Risk of fixing:** Высокий — careless revoke ломает trigger/internal caller; broad rollback снова открывает surface.
- **Dependencies:** P0-02 reproducible DB baseline, exact caller inventory, full role matrix.
- **Status:** Open — confirmed live; workflow P1, but early roadmap control.

### SEC-017 — Resource abuse/body buffering

- **ID:** SEC-017
- **Название:** Буферизация request body и media/resource abuse.
- **Severity:** Medium; launch blocker.
- **Affected components:** API routes, upload/media transformation/cache, ingress/hosting controls.
- **Current evidence:** Handlers buffer text/JSON/formData до effective byte check; media cache miss вызывает DB+Storage+Sharp; durable quota/rate/concurrency controls не доказаны.
- **Threat:** Oversized/chunked bodies, cache busting и orphan uploads истощают memory/CPU/egress/storage.
- **Expected secure behavior:** Ingress и streamed limits, auth-before-body, canonical cache keys, bounded transforms и durable quota/concurrency controls.
- **Files likely affected:** Applications/reviews/complaints/media routes, media view route, hosting/edge config и resource tests.
- **Database objects likely affected:** Возможные Storage quota/reservation/expiry objects; exact design ещё не утверждён.
- **Required tests:** RT-01, RT-04, ST-07, ST-09, ST-10, AU-08, OP-10; lying length/chunked/parallel/cache-key tests и measured ceilings.
- **Rollback strategy:** Canary with metrics; thresholds можно корректировать, protection не снимается полностью.
- **Risk of fixing:** Средний — tight limits отклонят valid payloads; load tests опасны вне disposable staging.
- **Dependencies:** Production-like staging, edge inventory, telemetry, approved resource budgets.
- **Status:** Open — code confirmed; deployed edge impact unverified.

### SEC-018 — Audit/atomicity gaps

- **ID:** SEC-018
- **Название:** Audit trail и multi-write actions неатомарны.
- **Severity:** Medium; launch blocker.
- **Affected components:** Admin actions, audit/events, state mutations, email outbox, actor attribution.
- **Current evidence:** Audit/write errors подавляются; mutation и audit выполняются отдельно; status/verification/badges/email — отдельные calls; service-role actor может быть `NULL`.
- **Threat:** Partial failure оставляет inconsistent state без достоверного forensic record либо audit-only success.
- **Expected secure behavior:** One transactional mutation атомарно пишет immutable before/after audit с explicit actor/request ID и idempotent outbox.
- **Files likely affected:** `src/app/admin/actions.ts`, audit/email callers, dead exported actions и fault/concurrency tests.
- **Database objects likely affected:** `record_application_event()`, audit/event tables, mutation RPCs, email outbox.
- **Required tests:** DB-09, DB-15, DB-18, EM-02, EM-04, AD-01, AD-02, AD-03; write/audit/email fault rollback; concurrency; actor attribution; no partial state.
- **Rollback strategy:** Versioned transactional path и dual verification; historical records не переписываются без provenance marker.
- **Risk of fixing:** Высокий — transaction refactor может изменить workflow semantics или actor identity.
- **Dependencies:** SEC-003/SEC-008 state machine, stable actor/request contract, idempotent email design.
- **Status:** Open — confirmed locally; atomic portion is prerequisite for race closure.

### SEC-019 — Supply-chain/E2E safety

- **ID:** SEC-019
- **Название:** Недетерминированная supply chain и опасные remote E2E utilities.
- **Severity:** Medium; not an original launch blocker, but required hardening control.
- **Affected components:** Toolchain pinning, lock reproducibility, remote QA scripts, secrets/artifacts.
- **Current evidence:** `latest`/unpinned toolchain и scripts, читающие `.env.local`/service role без proven production-ref fail-closed guard. P0-01B добавил local baseline и ignore rules, но остальные controls открыты.
- **Threat:** Lock refresh меняет graph либо оператор случайно запускает mutating QA against production.
- **Expected secure behavior:** Pinned toolchain/dependencies; explicit test-project allowlist/confirmation/cleanup; production ref hard-deny; redacted scanned artifacts.
- **Files likely affected:** `package.json`, workspace/toolchain config, lockfile, remote E2E scripts, artifact policy и CI.
- **Database objects likely affected:** Нет; используется только allowlisted disposable project.
- **Required tests:** OP-05, OP-06, OP-07, OP-15; identical clean installs, build-hook checks, negative production-ref run, artifact secret/PII scan.
- **Rollback strategy:** Small version/CI changes; scripts first dry-run; retain known-good lockfile.
- **Risk of fixing:** Средний — guard может ошибочно блокировать tests или, хуже, fail open.
- **Dependencies:** Isolated test project identity, P0-01 provenance/CI.
- **Status:** Open — local Git/artifact-ignore portion improved; toolchain/script/CI controls remain.

### SEC-020 — Transport/cookie/edge controls

- **ID:** SEC-020
- **Название:** HTTP, cookie и deployed edge controls не доказаны.
- **Severity:** Medium; launch blocker.
- **Affected components:** Public origin, TLS/HSTS, Auth cookies, CORS/CSP/cache/WAF/body limits.
- **Current evidence:** Canonical URL допускает HTTP в code path; explicit `Secure` cookie не доказан; фактические deployed controls не проверены.
- **Threat:** Misconfiguration exposes session material, допускает downgrade или caches private responses.
- **Expected secure behavior:** HTTPS-only origin, explicit Secure/SameSite cookies, no-store private responses и automated deployed verification/IaC.
- **Files likely affected:** `src/lib/navigation.ts`, Supabase cookie helpers, `next.config.mjs`, hosting/IaC и operations evidence.
- **Database objects likely affected:** Нет; Auth redirect/cookie/hosting configuration.
- **Required tests:** AU-09, AU-10, OP-10, ST-10; Set-Cookie, HTTP→HTTPS, HSTS, cache, CSP/CORS и origin variants in production-like staging.
- **Rollback strategy:** Canary domain; cookie/origin change откатывается coherent set; HSTS preload только после readiness.
- **Risk of fixing:** Высокий operational risk — domain/cookie mismatch ломает Auth; preload трудно обратим.
- **Dependencies:** Deployed staging/hosting access, exact public origin, SEC-014 SSR Proxy design.
- **Status:** Open — code gaps confirmed; deployment unverified.

### SEC-021 — Monitoring/retention/IR

- **ID:** SEC-021
- **Название:** Observability, retention и incident response неполны.
- **Severity:** Medium; launch blocker.
- **Affected components:** Logging/metrics/alerts, worker/outbox, PII lifecycle, on-call и incident runbooks.
- **Current evidence:** Structured logger/error tracker/SLO/alerts/scheduler config и complete incident playbook не доказаны; suppressed errors и retention gaps есть.
- **Threat:** Abuse/failure/breach остаётся незамеченным, а PII хранится неопределённо долго; logging сам может утечь PII.
- **Expected secure behavior:** Redacted structured events, actionable SLO/alerts, scheduler/dead-letter runbook, approved retention/legal hold и incident ownership.
- **Files likely affected:** Email/outbox callers, suppressed-error sites, operations/privacy docs и monitoring config.
- **Database objects likely affected:** Applications, complaints, reviews, outbox/log tables, future retention jobs.
- **Required tests:** EM-02, EM-03, EM-04, OP-09, OP-12, OP-13, OP-14; synthetic alert, queue-age SLO, purge dry-run/restore и tabletop.
- **Rollback strategy:** Observability additive; retention начинает report-only и только после backup proof переходит к audited deletion.
- **Risk of fixing:** Высокий для retention/logging — ошибочный purge уничтожит evidence, verbose logs раскроют PII.
- **Dependencies:** SEC-013 restore proof, approved retention/legal-hold schedule, on-call owner.
- **Status:** Open — confirmed evidence gap.

### SEC-022 — Safe-revision classifier

- **ID:** SEC-022
- **Название:** Weak «safe revision» classifier.
- **Severity:** Medium; not an original launch blocker.
- **Affected components:** Revision moderation, batch approval, duplicated client/server policy.
- **Current evidence:** Description считается risky только при length delta >140; unrelated same-length text проходит как safe; правило дублируется.
- **Threat:** Abusive same-length/Unicode/link replacement проходит batch approval.
- **Expected secure behavior:** Field-specific actual diff, one server policy source и explicit review для risky changes; manual review is safe fallback.
- **Files likely affected:** `src/app/admin/actions.ts`, `src/components/RevisionModeration.tsx`, revision classifier tests.
- **Database objects likely affected:** Specialist revision workflow/status, если enforcement переносится в DB; design не утверждён.
- **Required tests:** RT-10; same-length replacement, Unicode normalization, links/contact injection, delete/reorder и batch deny.
- **Rollback strategy:** Disable auto/batch approval и вернуть manual review; не ослаблять classifier.
- **Risk of fixing:** Низкий/средний — stricter logic увеличит moderator workload/false positives.
- **Dependencies:** Product-approved revision risk model, single-source policy decision.
- **Status:** Open — confirmed locally; tests not run.

### SEC-023 — RLS/index performance debt

- **ID:** SEC-023
- **Название:** RLS/index performance и maintainability debt.
- **Severity:** Medium; not an original launch blocker.
- **Affected components:** Database availability, indexes, auth initplans, policy composition.
- **Current evidence:** Advisor зафиксировал 15 unindexed FKs, восемь auth-initplan policies и десять tables с multiple permissive SELECT policies; correctness exploit не доказан.
- **Threat:** Growth/request amplification увеличивает DB/RLS cost; механическая consolidation может изменить authorization.
- **Expected secure behavior:** Measured indexes, `(select auth.uid())` optimization и consolidation только semantically equivalent policies с полной role regression.
- **Files likely affected:** Future performance/index/policy migrations, query evidence и role tests.
- **Database objects likely affected:** Exact FK constraints, policies и tables перечисленные в finding.
- **Required tests:** OP-11, DB-20–DB-25; realistic data `EXPLAIN`, latency/lock budget и full role matrix after each change.
- **Rollback strategy:** Concurrent indexes где возможно; один reversible policy change на migration; no broad ACL fallback.
- **Risk of fixing:** Средний/высокий — index build нагружает DB, policy merge меняет semantics.
- **Dependencies:** Realistic disposable staging dataset, query baseline, завершённые P0 authorization fixes.
- **Status:** Open — confirmed live; optimization deferred until authorization invariants stable.

### SEC-024 — CSP/logging residual

- **ID:** SEC-024
- **Название:** CSP и sensitive logging residual risks.
- **Severity:** Low; defense-in-depth, but roadmap launch control applies.
- **Affected components:** CSP/security headers, logging/redaction, recovery/callback metadata.
- **Current evidence:** CSP допускает `unsafe-inline` и broad Supabase origins; active XSS sink не найден; logs содержат token-like query keys/identifiers.
- **Threat:** Future injection получает слабое containment либо sensitive callback/recovery material попадает в logs.
- **Expected secure behavior:** Nonce/hash CSP, project-specific origins, first-layer redaction и scanned retained artifacts.
- **Files likely affected:** `next.config.mjs`, logging/redaction config, artifact policy/tests.
- **Database objects likely affected:** Нет.
- **Required tests:** RT-06, OP-06, OP-10, OP-15; XSS corpus, CSP report-only telemetry, forbidden-key/PII log scan, source-map review.
- **Rollback strategy:** CSP сначала report-only/canary; logging redaction additive и не откатывается к secret logging.
- **Risk of fixing:** Средний — CSP может сломать legitimate scripts/styles; over-redaction ухудшит diagnostics.
- **Dependencies:** Deployed telemetry, exact required-origin inventory, SEC-020 edge design.
- **Status:** Open — confirmed locally; no header/logging change in P0-01C.

### SEC-025 — Account-profile owner UPDATE drift

- **ID:** SEC-025
- **Название:** Live drift вернул owner UPDATE auth-mirrored account profile.
- **Severity:** Medium; launch blocker due confirmed live integrity boundary.
- **Affected components:** `account_profiles`, Auth mirror, notification recipient integrity, migration drift.
- **Current evidence:** Owner UPDATE policy live, хотя recorded migration её удаляла; owner может менять mirrored email, используемый email enqueue functions; источник recreation неизвестен.
- **Threat:** Owner перенаправляет workflow email на arbitrary/third-party address и нарушает verified-identity boundary.
- **Expected secure behavior:** Только trusted Auth-trigger sync меняет exact mirrored fields; recipient берётся из authoritative verified identity; catalog drift gate обнаруживает возврат policy.
- **Files likely affected:** New reviewed forward migration, trusted sync/email callers и drift tests; applied migration не переписывается.
- **Database objects likely affected:** `public.account_profiles`, policy `Users update own account profile`, grants, `sync_account_profile`, три email enqueue functions.
- **Required tests:** DB-17, DB-18, MIG-07, MIG-08; owner update each field deny; trusted Auth sync positive; user B deny; recipient/catalog proof.
- **Rollback strategy:** Revoke только после proving sync; при incompatibility остановить enqueue/fix sync, не возвращать owner email UPDATE.
- **Risk of fixing:** Высокий operational risk — premature revoke ломает profile/email synchronization.
- **Dependencies:** P0-02/P0-04A, source-of-drift investigation, Auth fixtures, catalog monitor.
- **Status:** Open — confirmed live schema drift; tests not run.

### SEC-026 — Public operational actor UUID

- **ID:** SEC-026
- **Название:** Public `site_content.updated_by` раскрывает admin UUID.
- **Severity:** Low; not an original launch blocker.
- **Affected components:** Public content projection, metadata minimization, admin identity privacy.
- **Current evidence:** `anon` может выбрать `site_content.updated_by` напрямую, хотя UI поле не показывает.
- **Threat:** Public caller коррелирует stable operational actor UUID.
- **Expected secure behavior:** Exact public projection содержит только content fields; anon base-table access revoked; admin update remains AAL2 controlled.
- **Files likely affected:** Public site-content caller, `src/app/admin/page.tsx`, future projection migration/tests.
- **Database objects likely affected:** `public.site_content`, `updated_by`, public grants/policy, safe projection.
- **Required tests:** DB-19, DB-14, AU-05; exact public snapshot, protected-column deny, public page positive, admin AAL2 positive.
- **Rollback strategy:** Projection/caller first, then revoke; не добавлять protected base columns ради compatibility.
- **Risk of fixing:** Средний — projection switch может сломать public content rendering.
- **Dependencies:** SEC-015 public projection redesign, SEC-010 AAL2 path.
- **Status:** Open — confirmed live; tests not run.

### Контроль полноты карточек

- Всего карточек: **26**.
- Severity: **13 High, 11 Medium, 2 Low**.
- Workflow lanes: **11 P0, 12 P1, 3 P2**.
- Finding считается закрытым только после цепочки `before FAIL → after PASS → relevant regression PASS → evidence tied to commit`.

## 4. Первый security fix

### Выбор: SEC-001 — immutable canonical published media

Первым **finding-scoped functional fix** предлагается узкий vertical slice SEC-001: запретить владельцу прямую замену/удаление canonical published media и переводить новое media через controlled writer и approval boundary.

Почему он первый:

1. Это подтверждённый locally и live **High** risk с непосредственным публичным integrity impact: approved карточка может показывать bytes, которых moderation никогда не одобряла.
2. Attack path простой и реалистичный для обычного profile owner; не требуется moderator/admin compromise.
3. Радиус можно ограничить одним security-инвариантом: canonical published bytes immutable для owner, запись и publication идут только через controlled path.
4. Поведение имеет чёткие deterministic tests: owner direct update/delete/reinsert deny; cross-owner deny; server gateway positive; published hash не меняется до approval.
5. Rollout можно сделать совместимым и поэтапным: сначала новый writer/path и verification, затем revoke broad owner mutation. Это уменьшает риск остановки upload.
6. Выбор совпадает с первым functional vertical slice в разделе 8 `SECURITY_ROADMAP.md` после enabling controls.

Почему не другие узкие кандидаты:

- SEC-002 также ограничен и хорошо тестируется, но его immediate impact ограничен internal metadata владельца; SEC-001 нарушает публичную moderation integrity.
- SEC-006 нельзя безопасно завершить до immutable-media design и доказанного Storage restore; ранняя безопасная мера для него — только report-only/disable destructive cleanup.
- SEC-014 имеет широкий session/cookie blast radius, а причинность исторических reuse events пока не доказана.
- SEC-007/SEC-008 требуют утверждённых invariants/state machine и transactional design.

P0-03A выполнил этот vertical slice локально, а P0-03B независимо проверил stale-review, Phase B provenance, backfill и failure sequencing. Evidence находится в `docs/security/SEC-001_LOCAL_VERIFICATION.md`, `SEC-001_ADVERSARIAL_REVIEW.md` и `SEC-001_DEPLOYMENT_REHEARSAL.md`. P0-03C сформировал operational gate, но заблокировал production execution до доказанного DB+Storage/config recovery, versioned migration/source release mechanism, owner-operated backfill wrapper и monitoring window. Это не production closure: controlled deployment, live legacy-media backfill и Phase B остаются обязательными.

## 5. Security change template

Обязательный шаблон будущего change находится в `docs/security/SECURITY_CHANGE_TEMPLATE.md`. Один экземпляр шаблона относится ровно к одному finding и одному security-инварианту.

## 6. Проверка состояния Git

После создания документов необходимо выполнить read-only команды:

```text
git branch
git status --short
git log -1 --oneline
```

Ожидаемое состояние P0-01C:

- active branch: `security/hardening`;
- baseline HEAD остаётся `10df78b416ae872eeefe9e8c2c7a641bb6fce89c`;
- только `docs/security/HARDENING_PLAN.md` и `docs/security/SECURITY_CHANGE_TEMPLATE.md` являются новыми локальными файлами;
- production source, existing SQL migrations, package manifests/lockfile и Git configuration не изменены;
- production, remote Supabase и реальные данные не изменены;
- документы P0-01C ещё не являются commit, пока отдельный review/commit не разрешён.
