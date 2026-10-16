# Соберёмся — Telegram Mini App

Статическое React/Vite-приложение для организации встреч в Telegram. Telegram `initData` проверяется в Supabase Edge Functions; frontend не обращается к прикладным таблицам напрямую.

## Локальный запуск

```bash
npm ci
npm run dev
```

Для UI без Telegram и базы создайте локальный `.env.local`:

```env
VITE_USE_MOCK_TELEGRAM=true
VITE_USE_MOCK_API=true
```

Production-проверка:

```bash
npm test
npm run build
```

Статический результат находится в `dist/`. Миграционный план — `MIGRATION_PLAN.md`, Telegram/BotFather — `README_TELEGRAM.md`, деплой — `README_DEPLOY.md`.
