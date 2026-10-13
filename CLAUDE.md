# «Соберёмся» — инструкции для Claude

Telegram Mini App для организации встреч (бот `@soberemsyabelarusbot`, short name `soberemsya`).
Владелец — Александр (Telegram ID 1979217645, администратор). Общение с владельцем — на русском.

## С чего начинать каждую сессию

1. Прочитать `docs/TZ.md` — план этапов, решения владельца и **раздел «Статус»** (что сделано, что в процессе, следующий шаг).
2. Прочитать `docs/PROJECT_NOTES.md` — правила, анализ, монетизация, мобильные приложения.
3. Сверить состояние: `git fetch origin main`, ветка, открытые PR, версии Edge Functions и миграции в Supabase
   (коннектор: `list_edge_functions`, `list_migrations` для проекта `qesuhhhiswwrfvfisfkp`).
4. Продолжить с «Следующий шаг» из раздела «Статус».

Если владелец пишет «продолжим в новом чате» (или похожее): обновить раздел «Статус» в `docs/TZ.md`
(сделано / в процессе / следующий шаг / известные проблемы), закоммитить и запушить, коротко подтвердить.
Если пишет «продолжай работу» в новом чате — выполнить шаги выше и продолжить без лишних вопросов.

## Архитектура

- Фронтенд: React + Vite + TypeScript (`src/`), GitHub Pages, деплой при мерже в `main` (`deploy-pages.yml`).
- Бэкенд: Supabase Edge Functions (`supabase/functions/`): `telegram-api` (всё API, проверка подписи
  Telegram initData на каждом запросе), `telegram-bot` (вебхук бота), `notifications-worker` (рассылка очереди
  уведомлений). Общий код — `supabase/functions/_shared/`. Деплой функций — `deploy-functions.yml` при мерже в `main`.
- База: Supabase PostgreSQL. Браузер в таблицы не ходит; все таблицы с RLS и без прав у anon/authenticated;
  изменения — атомарными RPC `security definer` с `set search_path = pg_catalog, public`, доступ только `service_role`.
- Фоновые задачи — pg_cron; вызов воркера — pg_net с секретом из Vault (`notifications_worker_secret`).

## Неизменные правила

- Не переписывать архитектуру без явной причины (владелец разрешает, если оправдано).
- Никогда не запрашивать и не выводить секреты: токен бота, вебхук-секрет, `TELEGRAM_DB_SECRET_KEY`,
  `TELEGRAM_CALENDAR_SIGNING_SECRET`, service-role/`sb_secret_*` ключи, access-токены, пароли БД, `.env`, реальные initData.
- Миграции продакшена — только через Supabase-коннектор (`apply_migration`). Запрещены `supabase db push/reset`,
  `migration repair/pull/list`, `--include-all`, прямые подключения к PostgreSQL.
- После `apply_migration` переименовать файл миграции в репозитории под версию, присвоенную Supabase,
  и проверить, что текст совпадает с `supabase_migrations.schema_migrations.statements`.
- **Баг коннектора:** `apply_migration`/`execute_sql` зависают (таймаут 60 с, ничего не применяется), если в теле
  одной PL/pgSQL-функции есть и `raise`, и `delete from`. Выносить `delete` в отдельную функцию. Тест в
  `tests/notifications.test.ts` проверяет это для новых миграций.
- Порядок релиза: миграции → Edge Functions → фронтенд; каждый шаг обратно совместим.
- Никакого фиктивного exactly-once для сообщений Telegram: доставка at-least-once, это документируется.
- Тексты для пользователей — нейтрально, на «вы».

## Процесс

- Работа в ветке сессии → PR в `main` → CI зелёный → мерж (владелец разрешил Claude мержить сам).
- Перед PR: `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e`, `git diff --check`,
  `deno check --node-modules-dir=none supabase/functions/<fn>/index.ts` для каждой функции,
  `/code-review`, для бэкенда/БД — `/security-review`.
- Локальная проверка SQL: Postgres 16 с заглушками Supabase (`auth`, `vault`, `cron`, `extensions`) —
  применить все миграции по порядку и прогнать сценарии, включая параллельные запросы.
- Mock-режим фронтенда: `VITE_USE_MOCK_TELEGRAM=true VITE_USE_MOCK_API=true npx vite`.
- Не коммитить `deno.lock` и временные файлы.
