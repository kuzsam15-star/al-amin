# Архитектура AL-AMIN

## Действующая модель

AL-AMIN — hosting-agnostic статический каталог:

Browser → static HTML/CSS/JS → local content JSON → direct specialist contacts.

Production не использует Node server, API routes, server actions, Auth, Supabase runtime, Storage runtime, SMTP, cookies, analytics или пользовательские формы.

## Публичные маршруты

- /
- /specialists/
- /specialists/<slug>/
- /about/
- /verification/
- /privacy/
- /rules/

Каждый опубликованный профиль генерируется во время build через generateStaticParams. Каталог целиком присутствует в исходном HTML, а поиск и фильтры уточняют его client-side.

## Источники истины

- content/site.json — публичные тексты.
- content/specialists.json — валидируемый каталог.
- public/images/specialists/ — статические изображения.
- src/lib/static-content-contract.mjs — общий контракт build и owner editor.
- out/ — полностью переносимый deployment artifact.

## Owner workflow

Локальный editor работает только на 127.0.0.1. Он не является route приложения, не публикуется в out/ и не имеет Git credentials. Сохранение создаёт локальную резервную копию, затем владелец просматривает diff и самостоятельно делает commit/push.

## Hosting adapters

STATIC_BASE_PATH задаётся только при build и не содержит имени репозитория по умолчанию. SITE_URL опционально задаёт canonical origin. out/ можно разместить на Cloudflare Pages, Netlify, GitHub Pages или другом static host. GitHub Pages deployment не включён.

## Прежняя платформа

Исходная Auth/Supabase/Admin/Cabinet архитектура восстановима из branch/tag archive/platform-before-static-2026-09-09. Облачный Supabase-проект и данные этой миграцией не изменяются.
