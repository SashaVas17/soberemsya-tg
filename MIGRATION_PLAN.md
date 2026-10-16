# Migration plan: Telegram Mini App

## Audit summary

The current application is a Next.js 16 project. UI and domain behavior are concentrated in `app/AppClient.tsx`; server access is implemented with Next route handlers and a Supabase service-role client. Supabase already stores events, time and place options, participants, availability votes, and final decisions.

The current organizer identity is Supabase email auth plus `owner_id`. Guest participants are identified by browser-local edit tokens. The production database is not modified by this migration; only additive SQL migrations and deployable Edge Function source are prepared.

## Target architecture

```text
Telegram Bot -> Telegram Mini App (React/Vite static SPA)
             -> Supabase Edge Functions
             -> Supabase PostgreSQL
```

The browser never receives the bot token or service-role key and never writes directly to application tables. Every operation authenticates `Telegram.WebApp.initData` in a server function.

## Components retained

- Mobile-first visual language: light background, dark green panels, teal actions, yellow accents.
- Event creation with multiple native date/time combinations.
- Place, area, budget, preference, and restriction fields.
- Availability voting and best-time calculation (maximum availability, earliest slot on ties).
- Explicit area ties and organizer-confirmed final time/place.
- Organizer editing, participant details, close/reopen, delete, refresh, calendar, and sharing flows.

## Components replaced or removed

- Next.js SSR, route handlers, standalone output, and Next-specific configuration.
- Supabase Magic Link, email login, `/login`, and `/auth/callback`.
- Browser edit tokens as the primary participant identity.
- `admin_token` in shared links and as the primary organizer authorization mechanism.

Legacy columns remain available for existing records and emergency compatibility. New Telegram-created records use verified user ownership.

## Database migration

1. Add `public.users` with unique `telegram_user_id`.
2. Add nullable `events.owner_user_id` and `participants.user_id` to preserve existing rows.
3. Add `UNIQUE (event_id, user_id)`; PostgreSQL permits legacy rows with null `user_id`.
4. Add indexes and `deleted_at` for reversible soft deletion.
5. Enable RLS on all public tables and revoke direct browser table access. Edge Functions use server-only credentials after Telegram verification.

## Delivery stages

1. Audit and this migration plan.
2. Static React/Vite shell, Telegram SDK bridge, themes, navigation, and optional local mock mode.
3. Telegram signature validation, user upsert, event APIs, and participant upsert.
4. Organizer management, final decision, sharing, bot commands, and personal event lists.
5. Additive migration, RLS, automated tests, production build, deployment/BotFather docs, and portable ZIP.

## Acceptance gates

- `npm ci`, `npm test`, and `npm run build` pass; static output is written to `dist/`.
- Telegram validation rejects expired or forged `initData`.
- Repeated answers update only `(event_id, user_id)` and cannot replace another user.
- Organizer mutations require verified ownership.
- Closed/decided events reject new answers.
- No `.env`, bot token, service-role key, `node_modules`, or build cache is included in delivery.
