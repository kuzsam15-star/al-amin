# AL-AMIN Security Change Template

> Один заполненный документ — один finding и один security-инвариант. Не начинать реализацию, пока threat model, before-state, tests, dependencies и rollback не прошли review. Mutating tests и любые remote changes разрешены только для явно allowlisted disposable staging; production остаётся запрещённым до соответствующего release gate и отдельного approval.

## Security issue

- **Finding ID:**
- **Название:**
- **Severity / launch blocker:**
- **Roadmap task / workflow priority:**
- **Security-инвариант этого change:**
- **Owner:**
- **Reviewer(s):**
- **Dependencies / prerequisites:**
- **Status:** Draft

## Threat model

- **Actor:**
- **Prerequisites / attacker access:**
- **Asset / trust boundary:**
- **Attack path:**
- **Impact:**
- **Expected secure behavior:**
- **Confirmed facts:**
- **Unverified hypotheses:**
- **Out of scope:**

## Affected files

Перечислить точные paths, callers, configuration и tests. Объяснить необходимость каждого файла; не добавлять несвязанный refactor.

- **Production files:**
- **Configuration files:**
- **Test files:**
- **Documentation/evidence files:**
- **Explicitly unaffected files/components:**

## Database changes

Если database change отсутствует, написать `None`. Если он нужен, использовать только новую forward migration; уже применённую production migration history не переписывать.

- **Migration path:**
- **Exact objects/signatures:**
- **Before grants/policies/ACL:**
- **After grants/policies/ACL:**
- **Views/functions/search_path changes:**
- **Clean-room replay result:**
- **Catalog diff result:**
- **Full role-matrix result:**
- **Seed/data reconciliation:**
- **Production application approval:** Not granted

## Before state

- **Test matrix ID(s):**
- **Environment (must not be production):**
- **Roles/accounts/fixtures:**
- **Safe reproduction steps:**
- **Expected failing security invariant:**
- **Actual result:**
- **Evidence artifact/hash:**
- **Secrets/PII handling:**

## After state

- **Secure contract:**
- **Allowed positive paths:**
- **Denied direct/bypass paths:**
- **Concurrency/idempotency contract:**
- **Failure-mode/fail-closed contract:**
- **Residual risk:**
- **Out-of-scope follow-ups:**

## Tests

Для access-control change обязательны как positive allowlisted, так и negative bypass cases. Для race — synchronized barrier, cardinality и проверка всех зависимых состояний. Для DDL — clean-room replay, catalog diff, все роли и rollback/forward-fix rehearsal. `PASS (static)` не заменяет runtime test; `NOT RUN` не является `PASS`.

| Test ID / case | Environment | Role | Fixture | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  | NOT RUN |

- **Targeted security tests:**
- **Negative bypass tests:**
- **Positive allowlisted tests:**
- **Concurrency/fault-injection tests:**
- **Migration replay/catalog tests:**
- **Relevant regression suite:**
- **Cleanup verification:**

## Security verification

- [ ] Before-state безопасно воспроизведён вне production и зафиксирован как FAIL.
- [ ] После change targeted security tests имеют PASS.
- [ ] Все релевантные роли (`anon`, user A, user B, owner, moderator AAL2, admin AAL2, service backend) проверены либо обоснованно отмечены N/A.
- [ ] Direct REST/RPC/Storage bypass проверен там, где применимо.
- [ ] Positive business path остаётся работоспособным.
- [ ] Relevant regression suite имеет PASS.
- [ ] Database change прошёл clean-room replay, повторный replay, catalog diff и role matrix.
- [ ] Advisors/ACL/function/view inventory повторно проверены там, где применимо.
- [ ] Secret/PII scan source, staged content, logs и evidence artifacts имеет PASS.
- [ ] Ни один test или change не был выполнен против production.
- [ ] Independent reviewer подтвердил threat, tests, rollback и evidence.

## Rollback

Rollback не должен возвращать уязвимый broad path. Если безопасный rollback невозможен, описать forward-fix и способ временно fail closed.

- **Rollback trigger:**
- **Decision owner:**
- **Exact reversible scope:**
- **Safe fallback / feature disable:**
- **Forward-fix path:**
- **Data reconciliation:**
- **Backup/restore prerequisite:**
- **Rollback verification tests:**
- **Forbidden rollback actions:** broad DML/`GRANT ALL`, открытие private base table, переписывание applied migration history, непроверенный production restore.

## Commit

Commit создаётся только после targeted tests и relevant regression. В commit должен быть один security-инвариант.

- **Planned commit message:**
- **Commit SHA:** Not created
- **Branch:** `security/hardening`
- **Files included:**
- **Evidence linked to commit:**
- **Review approval:**
- **Finding status after independent verification:** Open
- **Production release status:** BLOCKED
