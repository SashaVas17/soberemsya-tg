# Deployment: Соберёмся Telegram Mini App

Ни одна команда из этой инструкции не выполнялась против production автоматически.

## Требования и сборка

- Node.js 22.13+
- npm 11+
- Supabase CLI актуальной стабильной версии

```bash
npm ci
npm test
npm run build
```

Публикуемый каталог: `dist`.

## Cloudflare Pages

1. Подключите Git-репозиторий.
2. Framework preset: `Vite`.
3. Build command: `npm run build`.
4. Build output directory: `dist`.
5. Node version: `22`.
6. Добавьте публичные переменные `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TELEGRAM_BOT_USERNAME`, `VITE_TELEGRAM_APP_SHORT_NAME`.
7. Не добавляйте `TELEGRAM_BOT_TOKEN` и `TELEGRAM_DB_SECRET_KEY` в Cloudflare Pages frontend variables.

`public/_redirects` обеспечивает SPA fallback для внутренних экранов.

## Supabase migration

Проверьте локальный список и SQL до применения:

```bash
npx supabase migration list --local
npx supabase db diff --local
```

Telegram identity добавляется миграцией `supabase/migrations/20260805171807_telegram_mini_app_identity.sql`. Она сохраняет существующие строки и добавляет nullable-поля.

Миграция `supabase/migrations/20260806081500_security_hardening.sql` отзывает публичный вызов служебной `SECURITY DEFINER`-функции и добавляет индекс внешнего ключа. Обе миграции применяйте к production только после проверки и отдельного подтверждения.

## Edge Functions

Server functions находятся в `supabase/functions/telegram-api` и `supabase/functions/telegram-bot`.

Задайте секреты только через защищённые поля Supabase Dashboard:

1. Откройте `Project Settings` -> `Edge Functions` -> `Secrets`.
2. Добавьте `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DB_SECRET_KEY`,
   `TELEGRAM_MINI_APP_URL` и `TELEGRAM_WEBHOOK_SECRET`.
3. Вводите значения самостоятельно и не вставляйте их в команды, чат,
   issue, логи или файлы проекта.

Не передавайте значения через аргументы `supabase secrets set NAME=value`:
такая команда может сохраниться в истории shell. Для автоматизированного CI
используйте секретное хранилище платформы и защищённый stdin.

Затем, после review:

```bash
npx supabase functions deploy telegram-api --no-verify-jwt
npx supabase functions deploy telegram-bot --no-verify-jwt
```

Frontend вызывает `https://PROJECT_REF.supabase.co/functions/v1/telegram-api`. `VITE_SERVER_FUNCTION_URL` нужен только при custom domain/proxy.

## Security checks

- Telegram HMAC и `auth_date` проверяются до запросов к базе.
- Service-role key доступен только Edge Functions.
- Все organizer mutations сверяют `events.owner_user_id`.
- Participant update ищется только по `(event_id, user_id)`.
- Прикладные таблицы закрыты от `anon` и `authenticated`; RLS включён.
- Для production настройте CORS на точный Mini App domain вместо `*`, если не нужны preview URLs.
