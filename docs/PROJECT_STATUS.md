# AL-AMIN — статус проекта

Обновлено: 27 сентября 2026 года.

## Текущее решение

AL-AMIN работает как статический каталог одного редактора. Production-ветка — `main`, GitHub repository — `https://github.com/kuzsam15-star/al-amin`, GitHub Pages URL — `https://kuzsam15-star.github.io/al-amin/`. На сайте опубликован существующий профиль Виктора Кузнецова; Home, Cover Flow, каталог, профиль и прямые контакты сохранены.

Заявки передаются файлами, а не через облачный inbox:

`/apply` → `.alamin` → ручная отправка владельцу → локальный Owner Editor → проверка и правка → статический каталог.

## Готово

- hosting-agnostic Next.js static export;
- Civic Precision Home, Cover Flow, Catalog и Public Profile;
- локальный Owner Editor: «Специалисты», «Заявки», «Главная страница»;
- публичная форма `/apply` без Auth и сетевой отправки анкеты;
- самодостаточный формат заявки AL-AMIN v1;
- серверная локальная проверка недоверенного файла и изображения;
- защита от повторного импорта, конфликтов ID и повторного одобрения;
- отдельные оптимизированные WebP: профиль до 1200×1440 и аватар до 480×480;
- приватное хранение исходников в `.local-editor/submissions/`;
- откат каталога и изображений при ошибке сборки;
- проверка отсутствия заявок и оригиналов в `out/`;
- тесты и изолированный end-to-end QA файлового потока.

## Не используется

- Supabase для заявок;
- Edge Function и облачный inbox;
- Turnstile и облачный rate limiter;
- SMTP/email для передачи заявок;
- автоматический git push из Owner Editor.

Подготовленный ранее cloud-inbox не применялся и не разворачивался. Его активные файлы удалены из путей Supabase; историческая запись находится в `docs/archive/cloud-inbox-prototype/README.md`.

## Публикация

`.github/workflows/static-artifact.yml` проверяет контент, тесты, TypeScript, lint и production static export, затем публикует только `out/` через официальный GitHub Pages Actions flow. `STATIC_BASE_PATH` формируется централизованно из имени репозитория.

После локального добавления специалиста владелец запускает `pnpm release:check`, просматривает diff, создаёт commit и отправляет его в `main`. Owner Editor не публикуется и не выполняет Git-команды.

Rollback выполняется новым `git revert` commit без переписывания истории; успешный push повторно запускает Pages deployment.
