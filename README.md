# AL-AMIN — статический каталог рекомендаций

AL-AMIN — статический публичный каталог специалистов, которых вручную проверяет и добавляет владелец проекта. Публичный сайт не требует аккаунтов и не отправляет анкеты в облачный backend.

## Действующая архитектура

- Next.js App Router с `output: "export"`.
- Публичные тексты: `content/site.json`.
- Специалисты: `content/specialists.json`.
- Одобренные изображения: `public/images/specialists/<slug>/`.
- Приватные импортированные заявки и оригиналы: `.local-editor/submissions/` (Git ignored).
- Кандидат заполняет `/apply` и скачивает один самодостаточный `.alamin` файл.
- Владелец получает файл вручную, импортирует его в локальный Owner Editor и только после проверки добавляет профиль в статический каталог.
- Supabase, Auth, Storage runtime, SMTP, Turnstile и облачный inbox в этом сценарии не используются.

Старая platform-версия сохранена веткой `archive/platform-before-static-2026-09-09` и тегом `platform-before-static-2026-09-09`. Отклонённый cloud-inbox прототип описан только как история в `docs/archive/cloud-inbox-prototype/README.md`.

## Локальная работа

1. `pnpm install`
2. `pnpm dev` — публичный сайт.
3. `pnpm owner:editor` — локальный редактор только на `127.0.0.1`.
4. `pnpm test && pnpm typecheck && pnpm lint`
5. `pnpm build` — создаёт переносимую папку `out/` и проверяет, что туда не попали заявки или оригиналы.
6. `pnpm preview` — проверка собранного `out/`.

Owner Editor проверяет Host/Origin, сохраняет JSON атомарно и создаёт локальные резервные копии. Commit, push и публикацию владелец выполняет отдельно вручную.

## Формат заявки

`.alamin` — UTF-8 JSON-контейнер v1 с маркером формата, UUID пакета, анкетой, согласием, одной исходной фотографией в base64 и независимыми настройками кадра профиля/аватара. Импортёр также принимает `.alamin.json`; старые v1-файлы без кадра профиля остаются совместимыми.

- фотография: JPEG/PNG/WebP, максимум 8 МиБ;
- все изображения: максимум 16 МиБ;
- файл заявки: максимум 24 МиБ;
- SVG, HTML, анимация, удалённые изображения и владелец-управляемые поля запрещены.

Полная инструкция: `docs/OWNER_FILE_SUBMISSIONS.md`.

## Проверки

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm qa:catalog-submissions`
- `pnpm qa:owner-editor`
- `pnpm build`

`pnpm release:check` запускает проверки, собирает `out/` и показывает локальные изменения. Команда ничего не публикует и не выполняет `git push`.

## Публикация

- GitHub repository: `https://github.com/kuzsam15-star/al-amin`
- Production: `https://kuzsam15-star.github.io/al-amin/`
- Production branch: `main`
- Workflow: `.github/workflows/static-artifact.yml`

Push в `main` запускает официальный GitHub Pages Actions workflow: frozen install → content validation → tests → typecheck → lint → static build → artifact verification → Pages deployment. Project base path вычисляется из имени репозитория через `STATIC_BASE_PATH`; локальная разработка по-прежнему работает от корня.

### Как добавить специалиста и обновить интернет-сайт

1. Получить `.alamin` от кандидата.
2. Открыть `pnpm owner:editor` и импортировать файл.
3. Проверить и исправить данные в Owner Editor.
4. Добавить специалиста в каталог.
5. Просмотреть локальный сайт и выполнить `pnpm release:check`.
6. После просмотра изменений создать commit и выполнить `git push origin main`. GitHub Actions обновит сайт автоматически.

Статус публикации виден во вкладке **Actions** репозитория. Owner Editor, `.local-editor/`, оригиналы и заявки не входят в Pages artifact.

### Rollback

Для отката создать обычный `git revert` ошибочного commit и отправить новый commit в `main`. Не переписывать историю и не использовать force push. GitHub Pages автоматически развернёт восстановленное состояние после успешных проверок.
