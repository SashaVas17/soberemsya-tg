---
tags: [flockly, фронтенд]
---

# Mini App

React + Vite + TypeScript. Открывается как `https://t.me/flocklyappbot/app`.

## Структура `src/`
- `App.tsx` — маршрутизация и каркас; экраны — `src/screens/`:
  `Home`, `CreateEvent`, `Created`, `ParticipantEvent` (голосование), `Result`, `Manage`, `MyEvents`,
  `PublicMeetings` (открытые встречи), `PublicPreviewScreen`, `NotificationSettingsScreen`,
  `AdminStatsScreen` (только администратор), `SystemScreens` (ошибки, «сессия устарела», вне Telegram).
- `src/ui/` — общие компоненты; `src/app-hooks.ts` — хуки; `src/share.ts` — отправка карточки в чат;
  `src/api.ts` — клиент [API](API.md); `src/meeting-links.ts` — ссылки на встречу.
- Стили — `design-tokens.css` и `theme-sunset.css`, см. [Дизайн «Закат»](Дизайн-Закат.md).

## Ссылки и параметры запуска
- Встреча: `https://t.me/<bot>/<app>?startapp=event_<id>`.
- Кнопки бота открывают экраны через `?screen=create` и `?screen=my-events`.
- Переходы из уведомлений помечаются источником `ntf_<id>` (для аналитики).

## Поведение
- `initData` живёт 1 час; при 401 показывается экран «Сессия Telegram устарела → Открыть заново».
- Создание встречи идемпотентно: ключ `clientRequestId` хранится на черновик и переживает перезагрузку.
- Первое действие, которому нужны уведомления, запрашивает `requestWriteAccess()`.

## Локальный запуск без Telegram
```bash
VITE_USE_MOCK_TELEGRAM=true VITE_USE_MOCK_API=true npx vite
```
Проверки: `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e` — см. [Релизы и деплой](Релизы-и-деплой.md).
