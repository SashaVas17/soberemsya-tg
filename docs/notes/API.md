---
tags: [flockly, бэкенд, api]
---

# API — Edge Function `telegram-api`

Каждый запрос браузера несёт Telegram `initData`; функция проверяет подпись. Таблицы напрямую не
читаются браузером — только через эту функцию и RPC в [базе](База-данных.md).

Язык ответа: заголовок `x-flockly-language` (`ru`/`en`, приложение шлёт его всегда), без него — язык Telegram
из подписанных данных. По нему пишутся даты в списках и превью, карточки «Поделиться»; ошибки по-прежнему
приходят по-русски и переводятся на клиенте.

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/health` | Проверка живости |
| POST | `/telegram/auth` | Вход по `initData`; `cityChoice` — открытые города, если человек ещё не выбрал город и открыто больше одного (приложение спросит город) |
| POST | `/events` | Создать встречу (необязательные `clientRequestId` — идемпотентность, `category` — id категории, у вариантов места `venueId` — место из каталога) |
| GET | `/events/:id` | Встреча для участника |
| GET | `/events/:id/preview` | Предпросмотр открытой встречи |
| PATCH, DELETE | `/events/:id/manage` | Изменить / удалить (организатор); действия: `update_details`, `set_category`, `add_time`, `remove_time`, `add_place`, `remove_place`, `close`, `reopen`, `cancel`, `decide` |
| POST | `/events/:id/response` | Сохранить ответ участника |
| POST | `/events/:id/time-options/proposals`, `/place-options/proposals` | Участник предлагает вариант |
| DELETE | `/events/:id/participation` | Выйти из встречи |
| DELETE | `/events/:id/participants/:pid` | Организатор удаляет участника |
| POST | `/events/:id/join-request` | Заявка в открытую встречу |
| GET | `/events/:id/join-requests` | Заявки (организатор) |
| POST | `/events/:id/join-requests/:rid/approve` или `/reject` | Решение по заявке |
| POST | `/events/:id/calendar-link` | Подписанная ссылка на календарь |
| GET | `/calendar/:token` | Файл календаря (без `initData`) |
| POST | `/events/:id/share-message` | Подготовить карточку для `shareMessage` (`invite` / `result`) |
| GET | `/group-links/:token` | Ссылка `/new` из группы |
| GET | `/me/meetings`, `/me/meetings/page` | Мои встречи; у карточки `bestTime` (популярное время) и с 2026-10-22 `finalTime` (выбранное время решённой встречи, иначе `null`), `initials` — первые буквы имён до трёх ответивших (только буквы, а не имена; пустая строка — у имени без букв) |
| GET, PUT | `/me/notification-settings` | Настройки уведомлений |
| GET, PUT | `/me/city` | Город пользователя и список доступных (`{ city, cities }`); PUT `{ cityId }` — только активный город |
| PUT | `/me/language` | `{ language: "ru" \| "en" \| null }` — язык бота и уведомлений (`null` — как в Telegram); `/telegram/auth` возвращает сохранённый `language` |
| POST | `/me/analytics` | Событие аналитики с клиента |
| GET | `/public/events` | Лента открытых встреч города пользователя; `?category=<id>` и `?q=<текст>` (поиск по названию, до 80 символов); в ответе также `city`, `cities`, `categories`, у карточек — `category` |
| GET | `/categories` | Активные категории встреч (для мастера создания) |
| GET | `/admin/stats` | Статистика (только администратор) |
| GET | `/venues` | Каталог мест города пользователя (только опубликованные): `?category=<id>`, `?q=<текст>`, `?budget=<BYN>` (уровни цен, которые начинаются не дороже бюджета; места без уровня подходят всегда), `?offset=` (по 30, до 1000). Порядок: «Рекомендуем», затем по названию. В ответе — `items`, `nextOffset`, `city`, `categories` |
| GET | `/venues/:id` | Одно опубликованное место (карточка на карте) |
| GET | `/map` | Точки карты города пользователя: `venues` — `[id, широта, долгота, категория, «Рекомендуем»]` (опубликованные места с координатами, до 3000), `meetings` — открытые встречи, у которых вариант места выбран из каталога (те же правила видимости, что у ленты, до 500), `bounds` — рамка города, `city`, `categories`; `?category=<id>` |
| GET, POST | `/admin/venues` | Места на курации `?status=pending\|published\|hidden&cityId=<город>` с теми же фильтрами; `cityId` — любой город, в том числе закрытый, без него — город администратора (в ответе ещё `city` и `cities` с `isActive`, `importCategories` и `overpass: { urls, queries }` — серверы и запрос по каждой категории для импорта из приложения); POST `{ categoryId, name, address?, priceLevel?, website?, cityId? }` — добавить место вручную (сразу опубликовано) |
| PATCH | `/admin/venues/:id` | `{ status, categoryId, priceLevel, featured }` — все поля курации сразу |
| POST | `/admin/venues/publish` | `{ ids }` (до 200) — опубликовать новые места |
| POST | `/admin/cities/active` | `{ cityId, isActive }` — открыть или закрыть город (Минск закрыть нельзя — 400); ответ `{ cities }` |
| POST | `/admin/venues/import` | `{ categoryId, elements?, cityId? }` — загрузить категорию из OpenStreetMap для выбранного города (без `cityId` — города администратора): новые — в «Новые», известные — обновляются OSM-поля. `elements` — ответ Overpass, который приложение получило само (до 5000, тело до 8 МБ, читается только после проверки админа; каждый элемент проверяется как раньше); без него сервер спрашивает Overpass сам. Ответ `{ found, inserted, updated, truncated }`; OSM недоступен — 503 |
| POST | `/events/:id/report` | Жалоба `{ reason, comment?, participantId?, requestId? }`: без id — на встречу и её организатора, с `participantId`/`requestId` — на участника/автора заявки (только организатор). Повтор — 200 `alreadyReported` |
| POST | `/events/:id/block` | Заблокировать организатора (без id) или участника/автора заявки (`participantId`/`requestId`, только организатор) |
| GET | `/me/blocks` | Кого заблокировал пользователь |
| DELETE | `/me/blocks/:userId` | Разблокировать |
| POST | `/me/community-rules` | Пользователь прочитал правила открытых встреч (в ленте — `communityRulesAccepted`) |
| GET | `/admin/reports?status=open\|resolved\|dismissed` | Жалобы (только администратор, остальным 404) |
| POST | `/admin/reports/:id/resolve` или `/dismiss` | Закрыть жалобу |
| POST | `/admin/events/:id/hide` или `/unhide` | Скрыть встречу из ленты / вернуть |
| POST | `/admin/users/:id/ban` или `/unban` | Ограничить пользователя / снять ограничение |

Лимиты: при превышении — 429 с кодом `RATE_LIMITED` (создание встреч, заявки, предложения вариантов, жалобы);
ограниченному администратором пользователю открытые встречи и заявки — 403 `USER_RESTRICTED`. Скрытая
встреча и встреча человека, с которым есть блокировка (в любую сторону), не видны в ленте и превью
(для посторонних — 404), заявка на неё отклоняется как на недоступную.

Маршруты `/admin/venues*` — только администратору, остальным 404 (как и прочие `/admin/*`).

Источник: `allowedMethods()` в `supabase/functions/telegram-api/index.ts`; логика — в `_shared/`.
