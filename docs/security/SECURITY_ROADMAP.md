# AL-AMIN / «Аманат»: security roadmap

Дата: **2026-08-09**  
Исходный verdict: **BLOCKED**  
Принцип выполнения: малые проверяемые изменения, сначала disposable staging, затем отдельное явное разрешение на production.

## 1. Release gates

### BLOCKED → READY FOR LIMITED STAGING

Необходимы одновременно:

- canonical Git worktree/commit и воспроизводимый CI artefact;
- явно отдельный disposable Supabase/staging project с synthetic data и test-only keys;
- P0 security boundaries реализованы и прошли dynamic role/concurrency/media tests;
- production dependency audit не содержит unresolved Critical/High либо есть формально ограниченное исключение с доказанной non-exploitability и сроком;
- DB+Storage backup/restore rehearsal успешно завершён в isolated target;
- production остаётся неизменным до отдельного approval.

### READY FOR LIMITED STAGING → CONDITIONALLY READY

- P0 закрыт без открытых High;
- P1 реализован в production-like staging;
- actual TLS/headers/cookies/cache/CORS/Auth dashboard controls проверены;
- advisors triaged, четыре view ERROR устранены/формально приняты с contract tests;
- monitoring, on-call, retention и incident minimum работают.

### CONDITIONALLY READY → READY FOR PUBLIC RELEASE

- нет непринятых Critical/High и нет public-launch Medium blocker;
- полный `SECURITY_TEST_MATRIX.md` имеет PASS по обязательным строкам, а NOT RUN не затрагивает release boundary;
- deploy/rollback/forward-fix и restore rehearsal доказаны artefactами;
- Product, Engineering, Security и Operations явно подписали residual-risk register.

Текущий проект не удовлетворяет первому переходу, поэтому точный verdict остаётся **BLOCKED**.

## 2. Правила безопасной реализации

1. Не переписывать уже применённую production migration history.
2. Не «чинить» permission error через `SECURITY DEFINER`, `GRANT ALL` или открытие private base tables.
3. Сначала добавить узкий совместимый путь и тесты, затем отозвать старый broad path.
4. Любое DDL сначала проходит clean-room replay и role matrix на disposable project.
5. Любое destructive действие имеет preflight, recoverable backup, точный scope и forward-fix.
6. Service role остаётся только на server; test scripts обязаны fail closed по environment allowlist.
7. Одно изменение бизнес-инварианта — один reviewable change set; не объединять все P0 в один патч.

## 3. P0 — до любых реальных пользователей

### P0-01 — Восстановить release provenance и изолировать среду

- **Findings:** SEC-012, SEC-019.
- **Владелец:** Tech Lead + Platform/Security.
- **Работа:** открыть canonical Git worktree; зафиксировать baseline commit; protected branch/review; pin Node/pnpm; создать CI с test/type/lint/build, secret scan, dependency/SBOM, SQL lint/replay и security matrix. Создать отдельный явно именованный disposable staging project; production ref блокируется в test scripts.
- **Доказательство выхода:** clean clone даёт один dependency graph/build hash; artefact связан с commit; negative CI gates работают; remote QA script отказывается запускаться на production ref.
- **Rollback/forward-fix:** CI/config changes отдельными commits; last-known-good signed artefact; никаких direct deploy.
- **Зависимости:** первая задача, потому что все последующие доказательства должны иметь provenance.

### P0-02 — Создать канонический воспроизводимый database baseline

- **Findings:** SEC-005, SEC-016.
- **Владелец:** Database/Supabase owner + Security reviewer.
- **Работа:** не менять production history. Сформировать squashed baseline для новых environments, explicit grants/default privileges, separate seeds и config; исправить dependency order будущего replay. Снять versioned expected catalog snapshot.
- **Доказательство выхода:** пустой disposable project разворачивается без ручных шагов; schema/table/column/index/grant/RLS/view/function/trigger diff совпадает с утверждённым contract; anon writes отсутствуют.
- **Rollback/forward-fix:** previous baseline artefact сохраняется; production получает только отдельные forward migrations после approval.
- **Зависимости:** P0-01.
- **Фактический enabling status (2026-08-11):** verified no-data bootstrap и
  local role-matrix harness готовы. Два независимых harness run совпали:
  49 PASS / 24 approved XFAIL / 0 XPASS / 0 FAIL / 0 SKIP; cleanup PASS.
  P0-02C не исправляет findings: XFAIL сохраняют pre-hardening SEC boundaries.

### P0-03 — Сделать опубликованные media immutable и server-only

- **Findings:** SEC-001, SEC-017.
- **Владелец:** App/Storage owner + DB owner.
- **Работа:** route авторизует/декодирует/лимитирует файл, затем controlled backend пишет новый random/content-addressed path; revision ссылается на новый object; publication атомарно переключает path. Revoke owner direct canonical `INSERT/UPDATE/DELETE`, запретить overwrite referenced paths; quotas/reservations/expiry.
- **Доказательство выхода:** owner direct Storage requests deny; cross-owner deny; published bytes/hash неизменны до approval; valid owner upload через gateway работает; orphan quota/GC tests проходят.
- **Rollback/forward-fix:** сначала dual-compatible new paths и backfill only if necessary, затем revoke. Никогда не откатывать broad DML; при ошибке остановить публикацию и использовать предыдущий immutable path.
- **Зависимости:** P0-02; тестовые Storage fixtures.
- **P0-03A local status (2026-08-11):** SEC-001 реализован двумя forward-only
  фазами и server-controlled content-addressed publication. Два fresh run:
  68 PASS / 23 approved XFAIL / 0 XPASS / 0 FAIL / 0 SKIP; SEC-001 XFAIL = 0;
  cleanup PASS. SEC-017 и все остальные findings остаются открыты. Production
  rollout, existing-media backfill и Phase B не выполнялись.
- **P0-03B independent status (2026-08-11):** candidate review обнаружил и
  исправил два stale-review TOCTOU bypass, усилил owner/provenance Phase B и
  добавил dry-run-first backfill core. Два deployment rehearsal: 19/19 PASS;
  два final role-matrix run: 73 PASS / 23 XFAIL / 0 XPASS / 0 FAIL / 0 SKIP.
  Статус: `INDEPENDENTLY_REVIEWED_LOCAL_READY_FOR_CONTROLLED_DEPLOYMENT`;
  production по-прежнему не изменён.
- **P0-03C readiness status (2026-08-11):**
  `BLOCKED_BY_RECOVERY_AND_RELEASE_OPERATIONS`. Локальные bytes заморожены и
  deployment order/compatibility/stop/forward-fix gates сформированы, но
  отсутствуют датированный isolated DB+Storage/config restore proof, точный
  version-recording production migration runner, signed source release
  artifact/command, production backfill wrapper и active monitoring window.
  Production execution не разрешён.

### P0-04 — Закрыть owner column leak applications

- **Findings:** SEC-002.
- **Владелец:** DB owner + App owner.
- **Работа:** owner-safe versioned view/RPC/server response с exact columns; перевести cabinet; убрать authenticated SELECT на base `applications` или применить доказанный column ACL. Moderator/admin read — отдельный AAL2 path.
- **Доказательство выхода:** direct owner запрос каждой protected column получает deny; safe projection работает; user B не видит row user A; public/anon deny.
- **Rollback/forward-fix:** safe path сначала, revoke после switch; rollback caller, не base-table confidentiality.
- **Зависимости:** P0-02.

### P0-04A — Восстановить trusted-only account identity mirror

- **Findings:** SEC-025.
- **Владелец:** Auth/DB owner + Security reviewer.
- **Работа:** установить источник live recreation policy; отдельной forward migration убрать owner UPDATE `account_profiles`; оставить exact trusted Auth sync path; recipient email получать только из authoritative verified identity/mirror.
- **Доказательство выхода:** owner direct UPDATE `email` и остальных mirrored fields deny; trusted Auth email-change sync succeeds; user B deny; catalog drift monitor не показывает policy; notification уходит на authoritative address.
- **Rollback/forward-fix:** сначала доказать sync caller, затем revoke; при проблеме остановить enqueue/починить sync, не возвращать owner UPDATE.
- **Зависимости:** P0-02 и Auth fixtures.

### P0-05 — Зафиксировать moderator/admin/field/transition boundary

- **Findings:** SEC-003, SEC-010.
- **Владелец:** Product moderation owner + App/DB owners.
- **Работа:** документировать state machine и ownership/verification field ownership; строгий runtime enum; named transactional RPC/actions; admin-only role/archive/block/restore/owner operations; revoke broad table UPDATE/columns. Требовать fresh AAL2 на server и DB boundary.
- **Доказательство выхода:** direct action/REST/RPC matrix для каждого status/protected field; moderator не меняет owner/admin lifecycle; admin positive paths; AAL1 всегда deny.
- **Rollback/forward-fix:** parallel v2 actions/RPC, затем remove old exports/grants. Emergency recovery только audited break-glass AAL2.
- **Зависимости:** P0-02; согласованная бизнес-state-machine.

### P0-06 — Закрыть прямые feedback writes и ввести безопасный gateway

- **Findings:** SEC-004, SEC-011, SEC-017.
- **Владелец:** App/DB owner + Abuse/Operations owner.
- **Работа:** если feature не нужна — routes и policies deny. Иначе server/Edge gateway с exact allowlist, content type, streamed byte limit, CAPTCHA, durable privacy-preserving rate/device/specialist quotas, idempotency, target eligibility, moderation queue и retention. Revoke anon/auth table INSERT.
- **Доказательство выхода:** direct PostgREST deny; cross-origin simple request deny; duplicate/burst/oversize/protected-field tests; один valid synthetic submission создаёт одну минимальную row.
- **Rollback/forward-fix:** gateway canary перед revoke; при false positive корректировать threshold, не открывать base table.
- **Зависимости:** P0-01/02; решение Product запускать ли feedback.

### P0-07 — Атомарные заявки, решения, audit и email events

- **Findings:** SEC-007, SEC-008, SEC-018.
- **Владелец:** DB owner + App owner.
- **Работа:** database invariant «одна активная заявка/owner»; idempotency key; transactional state-machine RPC с expected version/status; publication, audit actor/before-after/request ID и email outbox event в одной транзакции. Zero-row/stale — conflict.
- **Доказательство выхода:** parallel submit создаёт одну row/event; parallel approve/reject имеет один outcome; application/profile/audit/outbox согласованы; fault injection откатывает всё.
- **Rollback/forward-fix:** сначала reconciliation/backup существующих duplicates/inconsistent rows; v2 RPC; caller switch. Исправление данных — отдельный audited plan, не автоматический delete.
- **Зависимости:** P0-02/05.

### P0-08 — Переделать media cleanup в recoverable fail-closed GC

- **Findings:** SEC-006.
- **Владелец:** App/Storage owner + Operations.
- **Работа:** временно report-only; abort на любой query error; все active revision states; tombstone + delay + second reference check; проверять Storage result; retries/metrics; восстановление из object backup.
- **Доказательство выхода:** fault-injection и concurrency tests; `changes_requested` сохраняется; object восстанавливается; cleanup report не содержит referenced object.
- **Rollback/forward-fix:** отключение worker/GC — безопасный rollback; deletion начинается только после observation window.
- **Зависимости:** P0-03 и P0-11.

### P0-09 — Закрыть High dependency advisories и pin build

- **Findings:** SEC-009, SEC-019.
- **Владелец:** App owner + Security reviewer.
- **Работа:** обновить Next/transitive Sharp/PostCSS/nanoid и dev advisories до безопасного graph; убрать `latest`; pin Node/pnpm; принять явное решение по `sharp`/`unrs-resolver` install hooks; generate SBOM.
- **Доказательство выхода:** prod/full audit без unresolved High/Critical; clean install/build/test/media corpus; lock tree не содержит affected versions; SBOM archived with commit.
- **Rollback/forward-fix:** отдельные dependency updates; предыдущий lockfile; rollback только при recorded temporary risk acceptance.
- **Зависимости:** P0-01.

### P0-10 — Исправить Auth refresh и privileged authentication

- **Findings:** SEC-010, SEC-011, SEC-014, SEC-020.
- **Владелец:** Auth/App owner + Supabase administrator.
- **Работа:** documented Next 16 Proxy с request/response cookie propagation и `getClaims()`; request-scoped server clients. MFA enrollment + AAL2/recent-auth gates. Включить leaked-password protection; проверить redirect allowlist, session lifetime/revocation, CAPTCHA/rates. Production origin только HTTPS; explicit Secure cookie.
- **Доказательство выхода:** short-JWT multi-tab refresh без reuse; revoked session deny; all privileged AAL1 deny/AAL2 pass; breached password deny; deployed cookie/redirect tests.
- **Rollback/forward-fix:** limited-staging canary и break-glass procedure; не расширять refresh reuse window как замену Proxy; cookie/Proxy changes откатывать согласованно.
- **Зависимости:** P0-01; отдельные test accounts только в staging.

### P0-11 — Доказать DB+Storage+config backup/restore

- **Findings:** SEC-013.
- **Владелец:** Platform/Operations + DB owner.
- **Работа:** encrypted off-site/immutable copies DB, Storage objects и critical config; раздельные credentials; определить RPO/RTO; автоматические integrity checks; isolated restore runbook.
- **Доказательство выхода:** датированный restore report с row/object/hash reconciliation, временем, RPO/RTO и найденными gaps; quarterly schedule.
- **Rollback/forward-fix:** новые backups additive; старую цепочку не удалять до двух успешных restore cycles.
- **Зависимости:** P0-01/02; никаких restore в production.

### P0-12 — Минимальный detection/response baseline

- **Findings:** SEC-018, SEC-021, SEC-024.
- **Владелец:** Platform/Operations + Security.
- **Работа:** structured redacted security events, auth/admin/storage/email metrics, queue age/failure alerts, scheduler ownership, uptime, log access/retention; короткий incident playbook с ролями/escalation/evidence/communications.
- **Доказательство выхода:** synthetic failure/unauthorized attempt вызывает alert; on-call подтверждает; sensitive query values отсутствуют в logs; tabletop завершён.
- **Rollback/forward-fix:** observability additive; redaction fail closed, не включать raw secrets/PII ради диагностики.
- **Зависимости:** P0-01.

## 4. P1 — до публичного запуска

| ID | Работа | Findings | Владелец | Exit evidence | Rollback/forward-fix |
|---|---|---|---|---|---|
| P1-01 | Redesign four public views и public `site_content` projection: безопасная invoker/API-schema boundary без открытия base tables | SEC-015/026 | DB + Security | Exact column/row contract, anon negative tests, Advisor decision | v2 views параллельно; caller switch; previous definition retained |
| P1-02 | Opt-in default privileges, explicit table/sequence/function matrix, revoke stale RPC, fixed search paths | SEC-016 | DB | Catalog snapshot; future dummy objects private; RPC role tests | Exact grant inventory; малыми forward migrations |
| P1-03 | Ingress body limits, WAF/rate/CAPTCHA, media cache/query canonicalization и derivatives | SEC-004/017 | Platform + App | Production-like abuse/load tests в staging; cost/latency ceilings | Canary thresholds; rollback threshold only |
| P1-04 | Проверить actual TLS redirect, HSTS, Secure cookies, CSP, CORS, no-store и CDN cache | SEC-020/024 | Platform | Automated deployed URL report | Не включать irreversible HSTS preload до readiness |
| P1-05 | Сделать audit immutable/atomic для всех privileged actions; убрать dead server actions | SEC-018 | App + DB | Fault injection, actor attribution, no orphan audit/mutation | v2 event format + dual read |
| P1-06 | Retention/deletion: applications, complaints, review contacts, email/outbox/logs/media | SEC-021 | Privacy/Product + DB | Approved schedule, report-only preview, audited purge + restore | Backup/legal-hold guard; phased delete |
| P1-07 | Полный monitoring/SLO: Auth anomalies, RLS denials, moderation, media, queue, provider, backup | SEC-021 | Operations | Dashboards, thresholds, paging test, runbooks | Tune thresholds; never log secrets |
| P1-08 | Удалить/пересмотреть length-based safe batch revision | SEC-022 | Product + App | Same-length/adversarial diff tests; manual fallback | Disable batch approval |
| P1-09 | Устранить RLS/index advisor debt по измеренным plans | SEC-023 | DB | Plans on realistic data, latency budget, role regression | Concurrent indexes; one policy change per migration |
| P1-10 | Укрепить email abuse/deliverability: idempotency, scheduler, alerts, DMARC progression | SEC-011/021 | Operations | Synthetic send/retry, queue SLO, DNS evidence | Gradual DMARC enforcement with reports |
| P1-11 | Redact/protect logs/outputs, artifact retention, secret history scan canonical repo | SEC-019/024 | Security + Platform | CI scan + access/retention policy + zero forbidden patterns | Preserve forensic copy in restricted vault if required |
| P1-12 | Провести независимый staging security review/targeted DAST | Все | Security | Signed report; all High closed; no production attack | Scope/allowlist/stop conditions defined first |

## 5. P2 — до платежей, документов, чатов или масштабирования

| ID | Trigger | Обязательная работа | Exit criteria |
|---|---|---|---|
| P2-01 | Платежи | Provider-hosted payment fields, signed webhooks, idempotent ledger, replay protection, refunds/disputes, financial audit, PCI scope decision | Threat model + sandbox tests + reconciliation/incident runbook |
| P2-02 | Документы | Data classification, encryption, malware/CDR scan, short-lived signed access, download watermark/audit, retention/legal hold, no public buckets | Cross-tenant negative tests, scanner failure fail closed, key/restore rehearsal |
| P2-03 | Чаты | Abuse/report/block, attachment pipeline, participant authorization, notification privacy, edit/delete semantics, E2EE decision | Conversation BOLA matrix, moderation/retention and load tests |
| P2-04 | Multi-tenant | Tenant ID in every table/RPC/object path/cache key; tenant-admin boundary; per-tenant quotas/keys | Automated cross-tenant suite and catalog policy proof |
| P2-05 | Масштаб | Queue isolation, async media derivatives, DDoS/cost controls, indexed RLS, regional DR, capacity/load model | Tested SLO/error budgets/DR failover in non-production |
| P2-06 | Mobile/native | Secure token storage, deep-link validation, device/session inventory, remote revoke, app attestation decision | Device compromise/session tests |
| P2-07 | Sensitive analytics/AI | Purpose limitation, minimization, prompt/data exfiltration controls, model/provider DPA, deletion propagation | Privacy/security review and red-team tests |

## 6. Ongoing — постоянный процесс

| Частота | Проверка | Gate/evidence |
|---|---|---|
| Каждый change | Code review, tests/type/lint/build, secret/dependency/SBOM, SQL/RLS diff | Required CI checks и signed artefact |
| Каждый DB change | Clean-room replay, full role matrix, Advisor diff, grants/default ACL snapshot | Zero unexplained Advisor regression |
| Каждый Auth change | Login/signup/reset/magic-link/refresh/revoke/AAL2 multi-tab suite | No reuse anomalies; AAL1 privileged deny |
| Каждый media change | Hostile corpus, immutable-path, cross-owner, quota/cache/cleanup fault tests | No moderation bypass/data loss |
| Еженедельно | Dependency/security advisories, Auth/admin/storage/email anomaly review | Triage owner + SLA |
| Ежемесячно | Access/membership/key/service-account review; queue/retention evidence | Signed access review |
| Ежеквартально | DB+Storage restore, incident tabletop, WAF/rate exercise, threat-model review | Dated restore/tabletop report |
| Перед public release | Independent targeted review/DAST только на allowlisted staging | No unresolved Critical/High |
| Ежегодно/при крупном изменении | ASVS L2 reassessment, privacy/retention, provider/supply-chain review | Updated baseline/findings/model/matrix/roadmap |

## 7. Специальный план для target migration

`20260809001646_enforce_server_only_specialist_writes.sql` уже подтверждена live и **не должна применяться повторно**.

- Сохранить hash и normalized live equality как release evidence.
- Добавить clean-room test её preconditions и v1/v2 behavior в canonical CI.
- Проверить новые/изменённые application/revision writes, status-only legacy moderation, direct role DML deny и guard EXECUTE deny.
- Зафиксировать короткий lock/maintenance expectation для будущих trigger migrations.
- Исправлять residual owner SELECT/owner_id/audit actor отдельными forward migrations.
- Не создавать rollback, который возвращает anonymous/owner DML. При необходимости использовать точечный forward-fix с exact prior ACL inventory.

## 8. Следующий один безопасный этап

**Выполнить только P0-11 — isolated DB+Storage+config recovery readiness
proof.**

P0-03C не разрешил production deployment: SEC-013/OP-09/ST-12 recovery
evidence отсутствует, а migration/source/backfill operational commands ещё не
имеют утверждённой production provenance. P0-11 должен дать датированный
isolated restore report без изменения production; затем P0-03C повторно
проверяет остальные release gates.
