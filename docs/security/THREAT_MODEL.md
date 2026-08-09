# AL-AMIN / «Аманат»: модель угроз

Дата среза: **2026-08-09**  
Версия: **baseline 1.0**  
Связанный вердикт: **BLOCKED**

## 1. Контекст и security objectives

AL-AMIN — публичный каталог специалистов с регистрацией, заявками, owner revision workflow, модерацией, verification facts/trust badges, отзывами/жалобами, медиа и транзакционной почтой. Критическая бизнес-граница: никакой пользовательский контент или статус не должен стать публичным без ожидаемого server-side и moderator/admin решения.

Основные цели:

1. Пользователь читает и изменяет только собственные разрешённые данные.
2. Модератор не получает admin-only полномочия и не меняет protected fields произвольно.
3. Публичная карточка отражает только утверждённый immutable snapshot.
4. Anon не может изменять данные или получать непубличные данные через прямой Data/Storage API; легитимный direct SELECT разрешён только для versioned public projections.
5. Сессия, recovery и privileged access устойчивы к replay/краже.
6. Изменения статуса, публикация, audit и email атомарны и идемпотентны.
7. PII хранится минимально, наблюдаемо и удаляется по правилам.
8. Схема, релиз и данные воспроизводимы и восстанавливаемы.

## 2. Активы и последствия компрометации

| Актив | C | I | A | Наиболее опасное последствие |
|---|:---:|:---:|:---:|---|
| Auth identities, cookies, refresh/recovery tokens | H | H | H | Захват аккаунта/привилегированной роли |
| Roles, moderator/admin membership | H | H | H | Вертикальная эскалация |
| Applications и внутренние заметки | H | H | M | Утечка PII/решений; неверное решение |
| Specialist draft/revision/published snapshot | M | H | H | Самопубликация или подмена профиля |
| Verification facts/trust badges | M | H | M | Ложное доверие к специалисту |
| Profile media и Storage references | M | H | H | Обход модерации, вредный/ложный публичный контент |
| Reviews/complaints и контакты авторов | H | H | M | Спам, доксинг, ложные утверждения, backlog |
| Email outbox/provider credentials | H | H | H | Email abuse, PII leak, репутация домена |
| Service role/worker secret | H | H | H | Обход RLS и широкий контроль backend data |
| Audit trail | M | H | H | Невозможность доказать актёра/событие |
| Migrations/release artefacts | M | H | H | Insecure drift или supply-chain compromise |
| DB/Storage backups | H | H | H | Потеря данных/невозможность recovery |

`C/I/A`: confidentiality, integrity, availability; H/M — относительный приоритет.

## 3. Актёры

| Актёр | Возможности | Мотивация/риск |
|---|---|---|
| Анонимный посетитель | Public web, anon key, direct Data API/Storage endpoints | Просмотр, scraping, spam, DoS |
| Bot/spammer | Параллельные raw HTTP/PostgREST requests, forged Origin, disposable identifiers | Spam, cost, SEO/reputation damage |
| Обычный authenticated user | JWT, direct browser Supabase client | BOLA/IDOR, чтение hidden columns, duplicate submissions |
| Владелец профиля | Собственные revision/media paths | Самопубликация, подмена approved media, storage abuse |
| User B против user A | Собственный JWT и guessed/leaked UUID/path | Horizontal escalation |
| Злонамеренный/скомпрометированный модератор | Moderator membership + обычная AAL1 session | Protected-field/status/owner/verification mutation |
| Администратор | Максимальные business privileges | Ошибка, compromised account, destructive action |
| Attacker с server secret | Service role/worker/provider key | Bypass RLS, data/email compromise |
| Supply-chain attacker | Package/lock/build/CI influence | Build/runtime compromise |
| Оператор/разработчик | Миграции, scripts, environment credentials | Ошибка окружения, insecure bootstrap, accidental prod mutation |
| Provider/infra failure | Supabase, hosting/CDN, UniSender | Outage, partial transaction, lost notification |
| Insider с log/backup access | Artefacts, logs, copies | PII/token exfiltration |

## 4. Роли и авторизационная модель

- **anon** — только публичные проекции и контролируемые public submissions.
- **user A / user B** — собственный account context; не равны owner конкретной сущности автоматически.
- **profile owner** — user, чей `auth.uid()` связан с specialist/application/revision/media path.
- **moderator** — review/decision role; не должен менять membership, owner identity или admin-only lifecycle.
- **admin** — role management и явно определённые destructive/lifecycle operations.
- **service backend** — доверенный server-only principal, обходящий RLS; никогда не клиентская роль.

Текущая система смешивает три authorization layers:

1. Next route/Server Action checks;
2. PostgreSQL grants + RLS + function body checks;
3. Storage grants + object policies.

Безопасность требует пересечения всех трёх. Сейчас некоторые прямые API paths шире, чем server UI/workflow.

## 5. Trust boundaries и data flows

```mermaid
sequenceDiagram
    participant C as "Недоверенный клиент"
    participant N as "Next.js server"
    participant A as "Supabase Auth"
    participant P as "PostgREST / RPC"
    participant S as "Storage"
    participant E as "Email provider"

    C->>A: "signup/login/refresh"
    A-->>C: "session cookies/JWT"
    C->>N: "pages, route handlers, Server Actions"
    N->>A: "сейчас getUser; getClaims — planned Proxy control"
    N->>P: "user client или service backend"
    N->>S: "media upload/read/cleanup"
    N->>E: "worker sends queued email"
    C->>P: "прямой anon/auth Data API — отдельная граница"
    C->>S: "прямой authenticated Storage API — отдельная граница"
```

| Boundary | Что пересекает | Обязательная проверка | Текущий риск |
|---|---|---|---|
| Internet → Next | body, cookies, Origin, files, redirects | Auth до дорогой обработки, byte/type/schema limit, CSRF/origin, rate/idempotency | Часть body полностью буферизуется; public feedback без abuse controls |
| Internet → Supabase Data API | anon/auth JWT и произвольные columns/actions | Explicit grants, RLS, column/RPC allowlist | Owner column leak; anon feedback INSERT; moderator broad UPDATE |
| Internet → Storage API | bucket/path/object bytes | Bucket privacy, owner path, immutable canonical boundary, quota | Owner может заменить published object |
| Next user client → DB/Storage | Пользовательский JWT | RLS/policies должны повторять business rules | Route validation можно обойти прямым API |
| Next service client → DB/Storage | Service role | Жёсткая server auth/allowlist, transaction, audit | RLS bypass; cleanup и multi-write fail-open |
| Auth → app | JWT/cookies/refresh | Proxy refresh, claims verification, AAL2, revocation | Proxy/AAL2 отсутствуют |
| DB outbox → email provider | recipient/template/provider key | Worker auth, retry/idempotency, redacted logs | Scheduler/alerts не доказаны; enqueue errors подавляются |
| Developer → environment | migrations, scripts, secrets | Canonical Git/CI, environment allowlist, approval | Worktree provenance нет; remote scripts fail-open по project selection |
| Backup → restore | DB, Storage, config | Encryption, separation, integrity, rehearsal | Доказательства отсутствуют |

## 6. Entry points

### Public web/Auth

- `/`, `/specialists`, `/specialists/[slug]`, public media view;
- `/login`, `/register`, `/forgot-password`, `/reset-password`, `/resend-confirmation`, `/auth/callback`;
- `/apply` и `/api/applications`;
- `/api/reviews`, `/api/complaints`;
- Supabase Auth API напрямую.

### Authenticated/owner

- `/cabinet` и owner Server Actions;
- `/api/media`, `/api/media/source`;
- direct PostgREST SELECT/RPC;
- direct Storage upload/update/delete.

### Privileged

- `/admin`, admin/moderator Server Actions;
- `/api/admin/session`;
- direct PostgREST/RPC с moderator/admin session;
- `/api/internal/email-worker` с shared secret.

### Operational/supply chain

- `.env.local`, package install/build hooks, lockfile;
- migration/bootstrap instructions;
- remote E2E scripts;
- CI/deploy/hosting/DNS, отсутствующие в переданном worktree;
- logs, outputs, backups и restore tooling.

## 7. STRIDE-анализ

| Категория | Конкретная угроза AL-AMIN | Существующие меры | Недостающие меры / finding |
|---|---|---|---|
| Spoofing | Кража moderator session; replay refresh/recovery; подмена actor attribution | `getUser()`, PKCE/magic-link flow, DB role lookup | AAL2/recent-auth, SSR Proxy, verified revocation, audit actor: SEC-010/014/018 |
| Tampering | Замена published media; moderator owner/status/verification edit; concurrent state overwrite | RLS, revision concept, target server-only migration, validation | Immutable media, column/RPC boundary, transactional transitions: SEC-001/003/008 |
| Repudiation | Mutation без audit или audit без mutation; service role actor NULL | Audit tables/functions присутствуют | Atomic immutable audit/request IDs: SEC-018 |
| Information disclosure | Owner читает `internal_notes`; public view future drift; logs/backup PII | RLS row filters, narrow current views, no-store source config | Safe projections, invoker/public boundary, retention/log controls: SEC-002/015/021/024 |
| Denial of service | Oversized buffered bodies, media re-encode/cache bust, spam, queue backlog | File pixel/declared-size checks, some local limiter | Ingress streaming limits, durable quotas/rates/CAPTCHA/monitoring: SEC-004/007/017/021 |
| Elevation of privilege | Moderator выполняет admin-only status/field changes; direct RPC/default grants | Role helper, admin actions, RLS | Transition matrix, narrow RPC/grants/default deny, AAL2: SEC-003/010/016 |

## 8. Приоритетные abuse cases

### TM-01 — Подмена одобренного изображения

1. Владелец публикует безопасное изображение через revision.
2. После approval находит сохранённый Storage path.
3. Прямым authenticated Storage request заменяет bytes или удаляет/reinserts объект.
4. Профиль/ревизия не меняются, audit/moderation не запускаются.
5. Public media route выдаёт новый content.

**Текущий результат:** exploit path подтверждён live ACL/policy и code flow; не выполнялся против production. **Требование:** immutable content-addressed/random path и server-only canonical writes.

### TM-02 — Чтение внутренних заметок собственной заявки

1. Пользователь открывает DevTools или пишет REST request.
2. Запрашивает protected columns `applications`, которых нет в UI projection.
3. Owner RLS разрешает row, table SELECT разрешает columns.

**Текущий результат:** boundary violation подтверждён live metadata. **Требование:** base table private + owner-safe projection.

### TM-02A — Подмена mirrored email и адреса уведомлений

1. Authenticated user напрямую обновляет собственный `account_profiles.email` через live owner UPDATE policy.
2. Email trigger берёт recipient из этой строки, а не непосредственно из authoritative Auth identity.
3. Workflow notification уходит на сторонний адрес без изменения подтверждённого Auth email.

**Текущий результат:** live grant/policy и recipient flow подтверждены; recorded migration должна была удалить policy, что доказывает schema drift. **Требование:** trusted sync-only mirror, deny direct UPDATE и continuous catalog drift detection.

### TM-03 — Модератор захватывает lifecycle профиля

1. Модератор использует AAL1 session.
2. Вызывает generic Server Action или прямой PostgREST.
3. Меняет status/owner/public content/verification, включая admin-only transitions.

**Текущий результат:** широкие live UPDATE grants/policies и Server Action подтверждены. **Требование:** role/field/transition enforcement одновременно в server и DB.

### TM-04 — Anonymous spam в обход приложения

1. Bot использует опубликованный anon key.
2. Вызывает Data API INSERT напрямую либо simple cross-origin POST.
3. Заполняет feedback tables PII/links/protected metadata, обходит route schema.

**Текущий результат:** anon INSERT подтверждён live. **Требование:** revoke и controlled abuse-resistant gateway.

### TM-05 — Race workflow

- Параллельные application submits создают дубли до записи local Map.
- Параллельные approve/reject читают один prior state и завершаются несовместимым application/profile state.

**Текущий результат:** code/schema invariant отсутствует; dynamic production test намеренно не запускался. **Требование:** unique/idempotency + locked transactional state machine.

### TM-06 — Destructive cleanup после частичного сбоя

1. Reference query ошибается или revision имеет `changes_requested`.
2. Ошибка преобразуется в «нет ссылок».
3. Service role удаляет объект, обходя RLS.

**Текущий результат:** подтверждено чтением code/tests. **Требование:** fail closed, tombstone, delayed recheck, recoverable storage backup.

### TM-07 — Refresh-token race

1. Expired session попадает в несколько Server Components/вкладок.
2. Нет Proxy, который единожды refresh и синхронно пишет request/response cookies.
3. Возможны конкурентные single-use refresh attempts и invalidated family.

**Текущий результат:** missing control подтверждён; связь с историческими 75 events — гипотеза, current 24h чисты. **Требование:** staging reproduction с коротким JWT и documented Proxy.

### TM-08 — Insecure rebuild или случайный remote test

- Оператор следует stale README/schema или broken migration order.
- QA script читает production `.env.local` и создаёт remote users/data.
- Отсутствие Git/CI provenance не даёт доказать, что deployed artefact прошёл gates.

**Текущий результат:** все preconditions подтверждены локально. **Требование:** canonical baseline, environment allowlist, approval, signed CI artefact.

### TM-09 — Потеря данных без восстановимой копии

Media cleanup, operator error, compromise или provider failure повреждает DB/Storage. Policy text существует, но restore evidence и Storage copy отсутствуют.

**Текущий результат:** capability не доказана. **Требование:** isolated restore rehearsal с DB + objects + config reconciliation.

## 9. AL-AMIN-specific invariants

Эти инварианты должны быть машино-проверяемыми и одинаковыми в UI/server/DB:

1. Один owner имеет не более одной активной заявки.
2. `owner_id`, moderator/admin attribution и protected status fields не принимаются от клиента.
3. Только допустимая state transition может завершиться; transition, publication, audit и email — одна транзакция/идемпотентный event.
4. Moderator не может выполнять admin-only membership/archive/block/ownership operations.
5. Published profile всегда ссылается на immutable approved snapshot/media bytes.
6. User A не читает/меняет data или Storage user B даже при известном UUID/path.
7. Owner-safe application response никогда не содержит internal moderation fields.
8. Public views содержат только versioned explicit column contract и только eligible records.
9. Anonymous feedback возможен только через abuse-resistant gateway; base tables закрыты.
10. Privileged mutation требует valid, fresh AAL2 session.
11. Service backend mutation всегда имеет проверенный actor/reason/request ID и atomic audit.
12. Любое destructive cleanup действие fail closed, delayed и восстановимо.

## 10. Существующие меры

- RLS на всех обнаруженных live public/storage tables.
- Owner predicates и private `profile-media` path isolation.
- Target migration закрывает owner/anon application/revision `INSERT/UPDATE/DELETE` и ставит contract v2 guards; `SELECT` этим утверждением не охватывается.
- Server-side `getUser()` и отдельный server-only service client.
- Narrow current public views; unpublished/blocked filters.
- Media decode, pixel limit, rotation и WebP re-encode; SVG не принимается.
- React output escaping, email text escaping, no `dangerouslySetInnerHTML`/eval/найденный SSRF sink.
- Open-redirect validation и baseline browser headers/no-store.
- Email outbox/retry state и hardened high-risk email RPC ACL.
- Lockfile integrity и локальные tests/typecheck/build.

## 11. Отсутствующие или недостаточные меры

- column-level/safe-view boundary для owner application;
- immutable server-only Storage publication path;
- moderator/admin transition и protected-field boundary;
- public feedback gateway, CAPTCHA, durable rate/idempotency/body limits;
- database-enforced uniqueness и transactional moderation state machine;
- fail-closed recoverable media GC;
- privileged MFA/AAL2 и verified Auth/session settings;
- documented SSR Proxy/session refresh;
- opt-in grants/default privileges и minimal RPC execution;
- resolved security-definer views/advisor errors;
- canonical clean-room database provisioning;
- passing dependency security gate и pinned runtime/install policy;
- Git/CI/provenance/secret scanning/SBOM/deploy controls;
- verified HTTPS/cookies/actual edge headers/WAF;
- structured monitoring/alerting, retention и incident response;
- DB+Storage+config backup и restore evidence.

## 12. Residual risks после P0/P1

Даже после закрытия текущих blockers останутся:

- malicious content, который технические validators не распознают;
- compromised moderator/admin при корректном AAL2;
- provider/region outage и supply-chain zero-day;
- traffic/DoS сверх закупленной edge/database capacity;
- privacy risk от законно собранных контактов и evidence;
- stale cache после экстренного takedown;
- human error при moderation и recovery;
- будущий schema drift, если contract tests/advisors не являются release gates.

Эти риски требуют ongoing monitoring, least-privilege review, tabletop/restore exercises, dependency/RLS regression и periodic threat-model updates.

## 13. Изменения модели при расширении продукта

Перед платежами, документами, чатами или масштабированием модель должна быть пересмотрена:

- **платежи:** Stripe/webhook signature, idempotency, ledger, refunds, PCI scope;
- **документы:** malware scanning, encryption, short-lived signed URLs, data classification, legal retention;
- **чаты:** abuse/reporting, E2EE decision, attachment controls, notification privacy;
- **multi-tenant/scale:** tenant key in every invariant, partition/queue isolation, DDoS/cost caps, regional DR;
- **mobile/native:** secure token storage, deep links, device binding и remote session control.
