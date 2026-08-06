# Telegram и BotFather

## Создание бота и Mini App

1. Откройте `@BotFather`, выполните `/newbot`, задайте имя и username. Токен сохраните только в Supabase Edge Function secrets.
2. Выполните `/newapp`, выберите бота, задайте название, описание, изображение и HTTPS URL Cloudflare Pages.
3. Задайте короткое имя Mini App. Оно используется в ссылке `https://t.me/BOT_USERNAME/APP_SHORT_NAME?startapp=event_EVENT_ID`.
4. Выполните `/setmenubutton`, выберите бота, укажите кнопку `Открыть «Соберёмся»` и тот же HTTPS URL.
5. Выполните `/setcommands` и добавьте:

```text
start - открыть Mini App
new - создать встречу
my - открыть мои встречи
help - краткая инструкция
```

## Webhook бота

После деплоя `telegram-bot` создайте длинный случайный `TELEGRAM_WEBHOOK_SECRET` и установите webhook запросом к Bot API со следующими параметрами:

```text
url=https://PROJECT_REF.supabase.co/functions/v1/telegram-bot
secret_token=TELEGRAM_WEBHOOK_SECRET
allowed_updates=["message"]
```

Не вставляйте bot token в issue, чат, Git или frontend-переменные.

## Deep links

Встреча отправляется как:

```text
https://t.me/BOT_USERNAME/APP_SHORT_NAME?startapp=event_EVENT_ID
```

После запуска frontend отправляет полный `Telegram.WebApp.initData` в `/telegram/auth`. Сервер проверяет подпись и возвращает серверно подтверждённый `start_param`; `initDataUnsafe` не используется для авторизации.

## Проверка

1. Откройте Mini App кнопкой меню в личном чате.
2. Создайте встречу и нажмите «Отправить в чат».
3. Выберите тестовую группу и откройте ссылку тремя разными Telegram-аккаунтами.
4. Проверьте три строки `participants` с одним `event_id` и разными `user_id`.
5. Измените ответ одного аккаунта: количество строк не должно увеличиться.
6. Проверьте запрет управления для чужого аккаунта.
7. Закройте сбор, примите решение и повторно откройте ссылку: должна отображаться итоговая страница.
8. Закройте и снова откройте Telegram: встреча должна остаться в «Мои встречи» владельца.

Тестируйте и личный, и групповой чат. Массовые уведомления в этой версии не включены; `users.telegram_user_id` и bot function позволяют добавить их позднее.
