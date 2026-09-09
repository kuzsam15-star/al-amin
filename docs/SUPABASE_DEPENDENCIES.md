# Supabase: архивная зависимость

Production static-directory не импортирует Supabase SDK и не обращается к Supabase во время просмотра сайта.

Старая база, Storage и Auth не удалены и не изменены. Их схема/миграции сохранены в репозитории как архивный материал, а полная platform-версия доступна через recovery branch/tag.

Единственный migration helper выполняется владельцем локально и строго read-only. Автоматическая публикация контактов запрещена: profile payload сначала попадает в gitignored staging, остаётся unpublished и требует owner review.
