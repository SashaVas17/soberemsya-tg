---
tags: [flockly, бэкенд, api]
---

# API — Edge Function `telegram-api`

Каждый запрос браузера несёт Telegram `initData`; функция проверяет подпись. Таблицы напрямую не
читаются браузером — только через эту функцию и RPC в [базе](База-данных.md).

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/health` | Проверка живости |
| POST | `/telegram/auth` | Вход по `initData` |
| POST | `/events` | Создать встречу (необязательные `clientRequestId` — идемпотентность, `category` — id категории) |
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
| GET | `/me/meetings`, `/me/meetings/page` | Мои встречи |
| GET, PUT | `/me/notification-settings` | Настройки уведомлений |
| GET, PUT | `/me/city` | Город пользователя и список доступных (`{ city, cities }`); PUT `{ cityId }` — только активный город |
| POST | `/me/analytics` | Событие аналитики с клиента |
| GET | `/public/events` | Лента открытых встреч города пользователя; `?category=<id>` и `?q=<текст>` (поиск по названию, до 80 символов); в ответе также `city`, `cities`, `categories`, у карточек — `category` |
| GET | `/categories` | Активные категории встреч (для мастера создания) |
| GET | `/admin/stats` | Статистика (только администратор) |

Источник: `allowedMethods()` в `supabase/functions/telegram-api/index.ts`; логика — в `_shared/`.
