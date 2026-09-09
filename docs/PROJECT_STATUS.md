# AL-AMIN — статус проекта

Обновлено: 9 сентября 2026 года.

## Текущее решение

Проект переведён в ветке static-directory на модель публичного каталога одного редактора. Пользовательские аккаунты, заявки специалистов, кабинет, модерационная админка, SMTP и внутренние обращения не входят в текущий продукт.

## Готово

- recovery branch и annotated tag старой платформы;
- hosting-agnostic Next.js static export;
- локальный валидируемый контракт специалистов;
- Civic Precision Home, Cover Flow, client-side Catalog и Public Profile;
- прямые контакты без внутренней формы;
- локальный owner editor с оптимизацией фото;
- пустые состояния без вымышленных публичных людей;
- SEO metadata и статические профили;
- validation, typecheck, tests, artifact verification;
- GitHub Actions для validation/build artifact без deployment;
- локальная проверка out/ через обычный static HTTP server.

## Важно

content/specialists.json пока не содержит опубликованных записей. Это сознательно: существующие реальные профили и контакты нельзя автоматически перенести и опубликовать без owner review, подтверждения разрешения на публичные контакты и копирования фотографий в static assets.

Read-only migration helper доступен в scripts/migrate-supabase-readonly.mjs. Count-only режим не читает payload. Режим --stage формирует только неопубликованный gitignored preview без контактов и не меняет облачные данные.

## Следующий owner step

1. Подтвердить список реальных специалистов и публичные контакты.
2. Перенести/оптимизировать фотографии.
3. Проверить каждый профиль локально.
4. Включить published и featured только после согласования.
5. Выбрать production static host.

GitHub Pages не считается гарантированным production-хостингом и не подключён автоматически.
