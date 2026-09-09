# AL-AMIN — статический каталог рекомендаций

AL-AMIN — публичный каталог специалистов, которых отбирает и рекомендует владелец проекта. Посетитель открывает Home, находит специалиста в каталоге, изучает профиль и связывается напрямую.

## Архитектура

- Next.js App Router с output: export.
- Контент сайта: content/site.json.
- Специалисты: content/specialists.json.
- Фотографии: public/images/specialists/<slug>/.
- Поиск и фильтры работают в браузере.
- Production backend, Auth, Supabase runtime, SMTP, API routes и server actions отсутствуют.
- Результат сборки — переносимая папка out/.

Старая platform-версия сохранена веткой archive/platform-before-static-2026-09-09 и тегом platform-before-static-2026-09-09.

## Локальная работа

1. Установить зависимости: pnpm install.
2. Проверить контент: pnpm validate:content.
3. Запустить сайт: pnpm dev.
4. В отдельном окне запустить editor: pnpm owner:editor.
5. Собрать переносимый artifact: pnpm build.
6. Проверить именно out/: pnpm preview.

Owner editor слушает только 127.0.0.1, не входит в публичную сборку, сохраняет JSON атомарно и создаёт gitignored backup. Commit и push выполняются владельцем вручную.

## Качество

- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm build

GitHub Actions только проверяет проект и сохраняет out/ как artifact. Автоматического production deployment нет.

## Hosting

Один и тот же исходный код собирается для корня домена или опционального STATIC_BASE_PATH. Репозиторий и GitHub Pages URL нигде не захардкожены. См. deploy/README.md.
