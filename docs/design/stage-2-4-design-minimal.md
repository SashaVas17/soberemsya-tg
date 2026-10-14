# Этап 2.4 — черновик архитектуры A (минимальная поверхность)

> Сгенерировано агентом проектирования 2026-10-14, не согласовано. Сверять с кодом перед реализацией.

## title
Stage 2.4: open-meeting safety (complaints, admin hide/ban, user blocks, DB rate limits, community rules)

## dataModel
Two additive migrations: `<v>_stage_2_4_moderation.sql` and `<v>_stage_2_4_moderation_cron.sql`.
- No DROP statements.
- No changes to existing constraints.
- No new kinds in `notification_outbox` or `analytics_events`.
- Names must not contain strings that older tests filter on, such as "participant_option_proposals" or "atomic_event_creation".

New columns on existing tables (nullable, add column if not exists):
1. `users.banned_at timestamptz` — admin ban. It is called "ban" in code so it is not confused with user-to-user blocks; the UI says «заблокирован администратором». No index; lookups are by primary key.
2. `events.hidden_at timestamptz` — marker for a moderation hide.
   - Hiding sets `deleted_at = hidden_at = now()` in one UPDATE. Every read path and RPC already filters `deleted_at is null`: feed, preview, my meetings, organizer join requests, the payload, create_join_request and the response/proposal RPCs. So the meeting disappears everywhere with zero filter changes, and the worker skips its pending notifications (`isNotificationStale`).
   - Restoring clears both columns, but only where `hidden_at is not null`.
   - Invariant: `hidden_at` is set only when moderation set `deleted_at`. It holds because owner delete and `archive_completed_events` touch only rows with `deleted_at is null`. A SQL scenario covers it; no new CHECK constraint, to keep the connector surface minimal.
   - Neither column is in any trigger's column list (`events_notify_changes`, `events_notify_group_chats`), so no notification fires.

New tables. All get `enable row level security` and `revoke all privileges on table ... from public, anon, authenticated`.
3. `rate_limit_rules`
   - Columns: `action text primary key check (action ~ '^[a-z_]{2,40}$')`, `per_hour integer not null check (per_hour > 0)`, `per_day integer not null check (per_day >= per_hour)`.
   - Seeded with `on conflict do nothing`: event_create 10/30, event_create_public 2/5, join_request 10/30, option_proposal 20/50, report 5/10.
   - It is a lookup table, following the meeting_categories precedent: a new action is an INSERT, and a limit change is an UPDATE migration.
4. `user_action_log`
   - Columns: `id bigint generated always as identity pk`, `user_id uuid not null references users(id) on delete cascade`, `action text not null references rate_limit_rules(action)`, `created_at timestamptz not null default now()`.
   - Indexes: `user_action_log_user_action_created_idx (user_id, action, created_at desc)`; `user_action_log_created_idx (created_at)` for purge.
   - Written only inside RPCs, in the same transaction as the business write. Existing tables can't be used for counting: join_requests rows are deleted when a user leaves, options have no author, and analytics are written outside the transaction.
5. `user_blocks`
   - Columns: `id bigint identity pk`, `blocker_user_id uuid not null references users on delete cascade`, `blocked_user_id uuid not null references users on delete cascade`, `created_at`.
   - Constraints: `user_blocks_pair_key unique (blocker_user_id, blocked_user_id)`; `user_blocks_not_self_check check (blocker_user_id <> blocked_user_id)`.
   - `grant select on table public.user_blocks to service_role;` — telegram-api reads it directly for the feed filter and the blocks list (`tests/service-role-grants.test.ts` requires the grant). Writes go through RPCs only.
6. `reports`
   - Columns:
     - `id bigint identity pk`
     - `reporter_user_id uuid not null references users on delete cascade`
     - `event_id text not null references events on delete cascade` — the meeting reported, or the meeting where the person was met
     - `reported_user_id uuid null references users on delete cascade` — null means a complaint about the meeting; its organizer is resolved through `events.owner_user_id`
     - `reason text not null check (reason ~ '^[a-z_]{2,32}$')` — values are validated in Edge (spam, scam, offensive, unsafe, other); a regex instead of a list means reasons can change without a constraint drop
     - `comment text not null default '' check (char_length(comment) <= 500)`
     - `created_at`
     - `resolved_at timestamptz null`
     - `resolution text null check (resolution ~ '^[a-z_]{2,32}$')` — dismissed, event_hidden or user_banned
   - "One complaint per reporter per meeting or person" (the person rule spans meetings):
     - `reports_reporter_event_key unique (reporter_user_id, event_id) where reported_user_id is null`
     - `reports_reporter_user_key unique (reporter_user_id, reported_user_id) where reported_user_id is not null`
   - Indexes: `reports_open_idx (created_at desc) where resolved_at is null`; `reports_event_idx (event_id)`; `reports_reported_user_idx (reported_user_id) where reported_user_id is not null`.
   - No service_role table grants; access is RPC only. Rows are kept as moderation history, with no purge in 2.4.
7. `admin_message_outbox`
   - A copy of `group_message_outbox`, addressed by a raw Telegram chat id.
   - Columns: `id bigint identity pk`, `report_id bigint not null references reports on delete cascade`, `chat_id bigint not null`, `kind text not null check (kind ~ '^[a-z_]{2,32}$')` (only 'report_new' today; the regex avoids a future drop), `dedupe_key text not null unique` ('report:<id>:<chat>'), `payload jsonb not null default '{}'`, `status` check (pending | sending | sent | failed | skipped), `attempts`, `next_attempt_at default now()`, `locked_at`, `sent_at`, `last_error`, `created_at`.
   - Index: `admin_message_outbox_due_idx (next_attempt_at, id) where status in ('pending','sending')`.
   - No grants. Rows cascade with their report. Volume is at most 10 per user per day times the number of admins, so there is no purge job in 2.4.

The existing `notification_outbox` and `group_message_outbox` are deliberately left unchanged:
- Adding a kind to `notification_outbox` would mean dropping its constraint, and it needs the admin's users row.
- `group_message_outbox` has the same kind-check problem.

## rpcs
Rules for every function:
- Signature written as `create or replace function public.X(`.
- `security definer set search_path = pg_catalog, public` on one line.
- `revoke all on function public.X(<types>) from public, anon, authenticated;`.
- `grant execute ... to service_role` only where Edge calls the function.
- Error tokens use `errcode 'P0001'` with the token as the message.

There are 15 functions:
- 15 definer strings and 15 revokes.
- DELETE appears only in `unblock_user` and `purge_user_action_log`. Each has one DELETE and no RAISE.
- The test splits on `$$;`, so comments in those two segments must not contain the words raise or "delete from".

Lock order everywhere:
1. events rows FOR UPDATE, ordered by id.
2. The per-user advisory lock.
3. users rows.

No path holds the advisory lock while waiting for an events row. Event creation only inserts new rows before taking it. So there is no deadlock cycle with approve, leave, remove, respond or the worker.

**Internal helpers (no service_role grant)**

A. `consume_action_quota(p_user_id uuid, p_action text) returns void` (plpgsql)
1. Read the rule; if it is missing, raise `RATE_LIMIT_RULE_MISSING`.
2. `perform pg_advisory_xact_lock(hashtextextended('quota:' || p_user_id::text, 0));`
3. `select count(*) filter (where created_at > now() - interval '1 hour'), count(*) from user_action_log where user_id = p_user_id and action = p_action and created_at > now() - interval '1 day';`
4. If either count is at its limit, raise `RATE_LIMITED`.
5. Otherwise `insert into user_action_log (user_id, action)`.

B. `moderation_target(p_actor_user_id uuid, p_event_id text, p_participant_id uuid, p_request_id uuid) returns table(owner_user_id uuid, target_user_id uuid)`
- Errors:
  - `MODERATION_ACTOR_UNAVAILABLE`: the actor has no row.
  - `EVENT_UNAVAILABLE`: the meeting is missing or deleted.
  - `MODERATION_NOT_ALLOWED`: the meeting is not public, its owner is null, or the owner targets their own meeting by event id alone.
  - `MODERATION_TARGET_INVALID`: both a participant id and a request id were sent.
  - `NOT_EVENT_OWNER`: a non-owner used a participant or request id.
  - `MODERATION_TARGET_UNAVAILABLE`: the participant or request is not in this meeting, the participant is a legacy guest with a null user_id, or the target is the owner.
- Returns `target_user_id` null when the target is the meeting itself.

**Guarded wrappers (service_role)**

These follow the 2.2 precedent: the old RPCs stay unchanged for older Edge versions, and telegram-api switches to the new names.

C. `create_event_guarded(p_event_id text, p_actor_user_id uuid, p_admin_token text, p_title text, p_description text, p_budget_limit integer, p_visibility text, p_max_participants integer, p_time_options jsonb, p_place_options jsonb, p_category_id text) returns table(event_id text)`
1. If visibility is public and the actor is banned, raise `USER_BANNED`.
2. Consume 'event_create'.
3. If the meeting is public, also consume 'event_create_public'.
4. `perform 1 from create_event_categorized(...)`.

D. `create_event_idempotent_guarded(p_client_request_id uuid, p_request_hash text, p_event_id text, p_actor_user_id uuid, p_admin_token text, p_title text, p_description text, p_budget_limit integer, p_visibility text, p_max_participants integer, p_time_options jsonb, p_place_options jsonb, p_category_id text) returns table(event_id text, replayed boolean)`
1. Call `create_event_idempotent_categorized` first.
2. Only if it was not a replay: run the ban check and consume both quotas. A RAISE here rolls back the meeting and the key claim, exactly like the existing category check.
- A replay never hits limits or the ban check, which keeps the contract that a replay must succeed.

E. `create_join_request_guarded(p_event_id text, p_requester_user_id uuid) returns table(request_id uuid, status text, outcome text)`
1. If the requester is banned, raise `USER_BANNED`.
2. Call `create_join_request`, which locks the event FOR UPDATE.
3. Only when the outcome is 'created_pending':
   - If a block exists with blocker = the event owner and blocked = the requester, raise `JOIN_REQUEST_NOT_ALLOWED`. This is the existing token with the neutral 409 text, so the block is not revealed.
   - Consume 'join_request'.
- A RAISE rolls back the insert and the `join_request_new` outbox row the trigger wrote in the same transaction.
- existing_pending, already_participant and errors consume nothing.

F. `propose_event_time_option_guarded(p_event_id text, p_actor_user_id uuid, p_option_id text, p_starts_at timestamptz) returns table(option_id text)` and `propose_event_place_option_guarded(p_event_id text, p_actor_user_id uuid, p_option_id text, p_title text, p_area text, p_estimated_budget integer) returns table(option_id text)`
- Call the inner function (event lock, validation, 50-per-meeting cap), then consume 'option_proposal'. Time and place proposals share one counter.
- The organizer's add_time and add_place are not limited: it is their own meeting and it already has the 50-per-meeting cap.

**Complaints and blocks (service_role)**

G. `create_report(p_reporter_user_id uuid, p_event_id text, p_participant_id uuid, p_request_id uuid, p_reason text, p_comment text, p_admin_chat_ids bigint[]) returns table(report_id bigint, created boolean)`
1. Resolve the target with `moderation_target`.
2. Validate the reason and comment; on failure raise `REPORT_INVALID`.
3. `insert ... on conflict do nothing returning id`.
4. If nothing was inserted, return (existing id, false). No quota is used and no message is sent. Parallel duplicates serialize on the partial unique index.
5. Consume 'report'.
6. Build the payload snapshot: eventTitle, reason, comment, target 'event' or 'user', reporter {name, username, telegramUserId}, subject {name, username, telegramUserId, role 'organizer' or 'participant'}, and targetReports (the number of reports on the same target).
7. Insert one `admin_message_outbox` row per distinct chat id > 0 from `p_admin_chat_ids`, with dedupe key 'report:'||id||':'||chat and `on conflict do nothing`.
8. Return (id, true).

H. `block_user(p_blocker_user_id uuid, p_event_id text, p_participant_id uuid, p_request_id uuid) returns table(block_id bigint, created boolean)`
1. The blocked user is `coalesce(target_user_id, owner_user_id)`. With an event id alone, the blocker blocks the organizer.
2. `perform 1 from events where owner_user_id = blocker and visibility = 'public' and deleted_at is null order by id for update`. Locking events first closes the race with a concurrent join request: whichever transaction commits second sees the other's row.
3. Take the per-user advisory lock. If the blocker already has 100 blocks, raise `USER_BLOCK_LIMIT_REACHED`.
4. `insert on conflict (blocker, blocked) do nothing`.
5. `update join_requests set status = 'rejected', decided_at = now(), decided_by_user_id = blocker` for that user's pending requests to the blocker's meetings. The existing trigger then sends the neutral join_request_rejected message.

I. `unblock_user(p_user_id uuid, p_block_id bigint) returns boolean`
- `language sql`.
- Body: `with removed as (delete from public.user_blocks b where b.id = p_block_id and b.blocker_user_id = p_user_id returning 1) select exists (select 1 from removed)`.
- Idempotent, no RAISE.

**Admin (service_role)**

Edge checks `isAdminTelegramId` first and returns 404 otherwise.

J. `admin_reports(p_resolved boolean, p_limit integer) returns jsonb` (stable)
- Returns newest first, limit clamped to 1..100.
- Each item: {id, createdAt, reason, comment, target, resolution, resolvedAt, event{id, title, status, hidden, deleted}, subject{name, username, telegramUserId, banned, role}, reporter{name, username, telegramUserId}, targetReports}.

K. `admin_moderate(p_report_id bigint, p_action text) returns text` (the new state)
- **hide_event:** `update events set deleted_at = now(), hidden_at = now() where id = <report event> and deleted_at is null`. Resolve the open meeting reports for that event as 'event_hidden'.
- **restore_event:** clear both columns where `hidden_at is not null`.
- **ban_user** (the subject is reported_user_id, or the owner):
  1. Lock, FOR UPDATE ordered by id, the subject's public non-deleted events plus the events where the subject has pending requests.
  2. `update users set banned_at = now() where banned_at is null`.
  3. Hide the subject's public non-deleted meetings, setting `hidden_at` to the same `now()`.
  4. Reject the subject's pending join requests.
  5. Resolve the open reports whose subject is this user as 'user_banned'.
- **unban_user:**
  1. Read the old `banned_at`.
  2. Restore the meetings where `owner = subject and hidden_at = old banned_at`. These are exactly the ones the ban hid; meetings hidden separately stay hidden.
  3. Set `banned_at = null`.
- **dismiss:** resolve this report as 'dismissed'.
- Errors: `REPORT_UNAVAILABLE`, `MODERATION_ACTION_INVALID`, `MODERATION_TARGET_UNAVAILABLE`.
- No DELETE.

**Worker (service_role)**

L. `claim_admin_message_batch(p_limit integer) returns table(id bigint, chat_id bigint, kind text, report_id bigint, payload jsonb, attempts integer)`
- A copy of `claim_group_message_batch`: pending rows that are due, or 'sending' rows locked for over 5 minutes, `for update skip locked`, limit clamped to 1..100.

M. `complete_admin_message(p_id bigint, p_outcome text, p_error text default null, p_retry_after_seconds integer default null) returns void`
- sent: mark sent.
- retry: backoff 30·2^attempts, capped at 3600; failed after 5 attempts.
- defer: back to pending without spending an attempt.
- blocked or skip: skipped.
- anything else: failed.
- No `users.can_message` update.

**Maintenance (no grants; cron runs as postgres)**

N. `purge_user_action_log() returns integer`
- `language sql`, one DELETE of rows older than 2 days.
- The cron migration runs `select cron.schedule('purge-user-action-log-daily', '51 3 * * *', 'SELECT public.purge_user_action_log();');`.

## rateLimits
**Mechanism**
- A sliding-window log per user and action, checked and recorded by `consume_action_quota` inside the business transaction.
- Windows are rolling: the last 60 minutes and the last 24 hours, measured on `created_at`. That is the transaction start time `now()`.

**Why it is race-safe**
- `pg_advisory_xact_lock(hashtextextended('quota:' || user_id, 0))` serializes all of one user's limited actions.
- The lock is transaction-scoped, so it is safe with Supavisor transaction pooling and is released on commit or rollback.
- Under READ COMMITTED, the count statement that runs after the lock sees the committed log rows of the previous holder. N parallel requests therefore never exceed the limit.
- A RAISE anywhere later in the transaction also rolls back the log row, so failed or rejected attempts never use quota.
- Locking the users row was rejected: `ensure_telegram_user` locks that row on every request, so the user's other requests would queue behind business transactions.

**Configuration**
| action | per hour | per day |
|---|---|---|
| event_create (any meeting, including group-link creations) | 10 | 30 |
| event_create_public | 2 | 5 |
| join_request | 10 | 30 |
| option_proposal (participant time + place) | 20 | 50 |
| report | 5 | 10 |

- One complaint per reporter per meeting or per person is enforced by the unique indexes, not by quota.
- A limit change is a small migration, `update public.rate_limit_rules set per_hour = ..., per_day = ... where action = ...;`, applied via apply_migration. No code change is needed, because user-facing texts don't contain numbers.

**What uses quota**
- A real meeting creation: both counters for a public meeting, only event_create for a private one. Idempotent replays use nothing.
- A join request only on the 'created_pending' outcome.
- A participant proposal only after a successful insert.
- A report only when a new row is inserted. Duplicates return created=false.

**Not limited**
- Answers and votes (agreed).
- Organizer approve and reject, leave and remove.
- The organizer's own add_time and add_place (the 50-per-meeting cap remains).
- User blocks, which have a hard cap of 100 per user instead. The cap keeps the feed's `not in` list under 4 KB.

**Error**
- P0001 'RATE_LIMITED' becomes HTTP 429 with code RATE_LIMITED.
- The message depends on the endpoint (see api). There is no Retry-After header.

**Retention**
- The daily cron `purge-user-action-log-daily` ('51 3 * * *') deletes rows older than 2 days, which is more than the 24-hour window.

**Tests**
- A vitest check confirms the seeds equal the agreed numbers and that each wrapper calls `consume_action_quota` only on its creating branch.
- SQL scenarios cover each boundary, backdating log rows by 61 minutes and 25 hours, and parallel runs (see tests).

## api
All changes are in `supabase/functions/telegram-api/index.ts`. Each new route is added to `allowedMethods(path)` and `handleApiRequest`. The `/events/:id/*` regexes go before the `/events/:id` catch-all. All routes authenticate as today.

**New endpoints**
1. `POST /events/:id/reports`
   - Body: {reason: 'spam' | 'scam' | 'offensive' | 'unsafe' | 'other', comment?: string (trimmed, ≤500), participantId?: uuid, requestId?: uuid}. At most one target id; none means the meeting itself.
   - Calls `create_report` with `p_admin_chat_ids = [...adminIds].map(Number)`, built from `parseAdminIds(TELEGRAM_ADMIN_IDS)`.
   - Returns 201 {report: {created: true}}, or 200 {report: {created: false}} for an earlier complaint.
2. `POST /events/:id/blocks`
   - Body: {participantId?, requestId?}. None means block the organizer.
   - Calls `block_user` and returns 200 {blocked: true}.
3. `GET /me/blocks`
   - Returns {blocks: [{id, displayName, username, createdAt}]}.
   - Direct reads of `user_blocks` and `users`, at most 100 rows.
4. `DELETE /me/blocks/:id`
   - Validates that the id is numeric, calls `unblock_user` and returns {unblocked: boolean}.
5. `GET /admin/reports?resolved=1`
   - Returns {reports: AdminReport[]} from `admin_reports`.
   - Non-admins get 404 {error: "Маршрут не найден."}, exactly like `/admin/stats`.
6. `POST /admin/reports/:id`
   - Body: {action: 'hide_event' | 'restore_event' | 'ban_user' | 'unban_user' | 'dismiss'}.
   - Calls `admin_moderate` and returns {state}. Non-admins get 404.

**Changed behavior**
- `POST /events`: `rpcName = clientRequestId ? "create_event_idempotent_guarded" : "create_event_guarded"`, with the same arguments. A 4xx is only returned for a real (non-replayed) creation, so the client's forget-the-key-on-4xx logic stays correct.
- `POST /events/:id/join-request` calls `create_join_request_guarded`.
- The two `/proposals` routes call `propose_event_*_option_guarded`.
- `GET /public/events` adds one query to the existing Promise.all: `db.from("user_blocks").select("blocked_user_id").eq("blocker_user_id", auth.user.id)`. When that list is non-empty, it adds `.not("owner_user_id", "in", "(<uuids>)")`.
- `/telegram/auth`: `parseStartParam` in `_shared/domain.ts` accepts 'mod' and returns {type: 'home'}. Without this, the admin deep link would get a 400.

**Error mapping**
| Token | HTTP | Code sent to client | Message |
|---|---|---|---|
| RATE_LIMITED (create) | 429 | RATE_LIMITED | «Вы создали много встреч за последнее время. Попробуйте позже.» |
| RATE_LIMITED (join) | 429 | RATE_LIMITED | «Вы отправили много заявок за последнее время. Попробуйте позже.» |
| RATE_LIMITED (proposals) | 429 | RATE_LIMITED | «Вы предложили много вариантов за последнее время. Попробуйте позже.» |
| RATE_LIMITED (report) | 429 | RATE_LIMITED | «Вы отправили много жалоб за последнее время. Попробуйте позже.» |
| USER_BANNED (create) | 403 | USER_BANNED | «Создание открытых встреч для вас ограничено администратором.» |
| USER_BANNED (join) | 403 | USER_BANNED | «Отправка заявок для вас ограничена администратором.» |
| JOIN_REQUEST_NOT_ALLOWED (blocked by the organizer) | 409 (existing) | JOIN_REQUEST_NOT_ALLOWED | existing text |
| EVENT_UNAVAILABLE | 404 | — | existing text |
| MODERATION_TARGET_UNAVAILABLE | 404 | — | «Пользователь не найден.» |
| NOT_EVENT_OWNER | 403 | NOT_EVENT_OWNER (existing) | existing text |
| MODERATION_NOT_ALLOWED | 409 | — | «Пожаловаться или заблокировать можно только в открытой встрече другого организатора.» |
| MODERATION_TARGET_INVALID, REPORT_INVALID | 400 | — | — |
| USER_BLOCK_LIMIT_REACHED | 409 | — | «Можно заблокировать не больше 100 пользователей.» |
| MODERATION_ACTOR_UNAVAILABLE | 403 | — | — |
| REPORT_UNAVAILABLE | 404 | — | — |
| MODERATION_ACTION_INVALID | 400 | — | — |

Unknown tokens still become a 500.

**Where the code goes**
- Add RATE_LIMITED and USER_BANNED to `SAFE_APPLICATION_ERROR_CODES` (`_shared/errors.ts`) and to `SAFE_API_ERROR_CODES` (`src/api-error.ts`).
- Extend the token sets and switches in `_shared/event-creation.ts`, `_shared/join-request.ts` and `_shared/participant-option-proposal.ts`.
- New `_shared/moderation.ts`:
  - parseReportRequest, parseModerationTarget, parseModerationAction
  - moderationHttpError
  - adminChatIds
  - REPORT_REASON_LABELS
  - renderAdminReportMessage
  - moderationLink(bot, app)
- No analytics events are added, because a new name would need a constraint drop.

## notifications
**Admin complaint delivery** (at-least-once, no fake exactly-once)

**Enqueue**
- `create_report` inserts the rows in the same transaction as the report: one `admin_message_outbox` row per admin chat id.
- telegram-api passes those ids from `TELEGRAM_ADMIN_IDS` (`parseAdminIds`, default 1979217645). The private chat id equals the Telegram user id.
- Consequences:
  - The admin needs no users row.
  - The database keeps no admin list.
  - The env variable stays the single source of truth at the moment of enqueue.
- Rejected alternatives:
  - `notification_outbox`: its kind CHECK would have to be dropped (the connector hangs on DROP), and `user_id NOT NULL` requires the admin's users row.
  - `group_message_outbox`: same kind-check problem.

**Worker** (`notifications-worker/index.ts`)
- New `processAdminBatch`:
  1. `claim_admin_message_batch({p_limit: 25})`
  2. `renderAdminReportMessage(payload, moderationLink(bot, app))`
  3. The existing `sendMessage(chat_id, ...)`
  4. `complete_admin_message`
- It uses the same throttle/defer handling as the other batches and has no staleness skip: a complaint is still delivered if the meeting was hidden meanwhile.
- It runs first in the loop, `[["admin", ...], ["personal", ...], ["group", ...]]`, so a personal backlog (up to 4×25 sends) cannot delay complaints.
- pg_cron calls the worker every minute ('* * * * *'), so a complaint arrives within about 60 s plus send time. That meets "за минуту".

**Message** (plain text, no parse_mode, so a user comment cannot inject markup; title ≤200 and comment ≤500, far below 4096)
```
Жалоба на встречу «{title}»
Причина: {label}
Комментарий: {comment}   ← line omitted when empty
Организатор: {name} (@{username}), id {telegramId}
Отправитель: {name} (@{username}), id {telegramId}
Жалоб на эту встречу: {n}
```
- For a person complaint, the first line is «Жалоба на участника встречи «{title}»» and the subject line is «Участник: …».
- Reason labels: spam «Спам или реклама», scam «Мошенничество или предоплата», offensive «Оскорбления или давление», unsafe «Опасное поведение», other «Другое».

**Button**
- «Открыть жалобы» links to `https://t.me/<bot>/<app>?startapp=mod`.
- `parseStartParam('mod')` returns {type: 'home'}. App.tsx navigates to `/admin/moderation` when `result.startParam === 'mod' && result.isAdmin`; anyone else lands on Home.

**Telegram outcomes**
- 403 (the admin never started the bot or blocked it): the row becomes skipped. The report is still visible on the admin screen.
- 429 and 5xx: retry with backoff.

**Side notifications**
- Block and ban reject pending join requests through the existing trigger, which sends the existing neutral join_request_rejected message to the requester.
- Nothing is sent to the owner of a hidden meeting. This is deliberate; see risks.

## frontend
**New components and screens**

1. `src/ui/ReportDialog.tsx`
   - A dialog: role=dialog, aria-modal, classes `app-dialog-backdrop` / `app-dialog`. Add `.app-dialog` to the opaque rule in `theme-sunset.css`, next to `participant-remove-dialog` and `time-picker-dialog`.
   - Title «Пожаловаться». Reasons as a radio list with the five labels above. Optional textarea «Что произошло» (maxLength 500). Buttons «Отмена» (secondary-action) and «Отправить» (primary-action).
   - Results: success «Жалоба отправлена. Администратор её проверит.»; created:false «Вы уже отправляли жалобу.»; errors show ApiError.message (includes the 429 text).
   - Props: {eventId, target?: {participantId} | {requestId}, onClose}.
   - Double-submit lock, like `createJoinRequestOnce`.
2. A shared quiet action pair:
   - «Пожаловаться» opens the dialog.
   - «Заблокировать» uses quiet-danger-action, `window.confirm('Заблокировать пользователя? Вы перестанете видеть его открытые встречи и заявки.')`, then `api.blockUser`.
3. `src/ui/CommunityRules.tsx`, a `CommunityRulesGate` component
   - Shown once per device. The localStorage key is 'soberemsya-community-rules-seen'; every access is wrapped in try/catch, following `askWriteAccessOnce`.
   - Button «Понятно».
   - Rendered in three places:
     - PublicMeetings, on mount (the TZ's "first entry").
     - PublicPreviewScreen, because deep-link visitors skip /open.
     - CreateEvent, when «Открытая встреча» is selected.
   - Draft text for the owner to approve:
     > «Правила открытых встреч
     > • Встречайтесь в людных местах и предупреждайте близких, куда идёте.
     > • Уважайте участников: без оскорблений, давления и дискриминации.
     > • Без предоплат, продаж и рекламы — встречи не для заработка.
     > • Не публикуйте чужие личные данные.
     > • Если что-то не так, нажмите «Пожаловаться» — администратор проверит. Нарушителей блокируем.»
4. `src/screens/AdminModerationScreen.tsx`, route `/admin/moderation`
   - App.tsx: `if (path === "/admin/moderation" && auth.isAdmin)`, placed before the Home fallback.
   - Layout copied from AdminStatsScreen: settings-screen / settings-page, nested Header titled «Жалобы».
   - Toggle «Открытые» / «Закрытые».
   - Each card shows:
     - target type, reason label, comment
     - meeting title and its state (активна / скрыта / удалена организатором)
     - subject: name, @username, Telegram id, «заблокирован»
     - reporter and time
     - «Жалоб на эту цель: n»
   - Actions depend on state: «Скрыть встречу» / «Вернуть встречу», «Заблокировать пользователя» / «Разблокировать», «Закрыть жалобу».
   - Hide and ban ask for confirmation. The ban text: «Пользователь не сможет создавать открытые встречи и отправлять заявки. Его открытые встречи будут скрыты.»
   - The list reloads after each action.
   - Home: a second `home-settings-link` «Жалобы» (lucide Flag) inside the existing isAdmin block.
5. Blocked-users section on `/settings` (NotificationSettingsScreen)
   - h2 «Заблокированные пользователи», a list of name and @username with «Разблокировать».
   - Empty state: «Вы никого не блокировали.»

**Where the actions go**
- **PublicPreviewScreen:** after section.public-preview-request, «Пожаловаться на встречу» and «Заблокировать организатора». After a block, `navigate('/open', true)`. On USER_BANNED, hide the join button and show the message.
- **ParticipantEvent and Result** (public meeting, viewer is not the organizer): «Пожаловаться на встречу» next to LeaveMeetingAction.
- **Manage participant details** (public meeting, person.userId not null, not the organizer): «Пожаловаться» and «Заблокировать» next to «Исключить из встречи». They use participant.id, which only the organizer already has.
- **OrganizerJoinRequests:** «Пожаловаться» and «Заблокировать» in .join-request-actions, by requestId.
  - Errors use fixed texts, because the tests forbid error.message and requesterUserId in this component.
  - After a block, the list reloads and the request disappears (it was rejected).
- **Feed cards stay unchanged:** each card is one `<button>`.
- **Privacy:** no user ids are added to participant payloads, so event-payload-privacy and public-feed-ui stay green.

**API client and mock**
- `api.reportEvent`, `api.blockUser`, `api.blocks`, `api.unblock`, `api.adminReports`, `api.moderateReport`, each in the `useMock ? mockApi.x : request` pattern.
- `mockApi` gets module-level reports and blocks state. The mock user is an admin, so the admin screen works in mock mode.
- Types go in `src/types.ts`: ReportReason, AdminReport, UserBlock.

## rollout
0. **Before the task.** Tell the owner the model: Opus/high for the migration and Edge (PR A), Sonnet/medium for the frontend (PR B).
   - Get the owner's approval on:
     - the rules text and the reason list
     - hide = full soft delete
     - ban hides the user's open meetings and rejects their pending requests
     - participants report the meeting (not another participant)
     - blocks act only on the feed and on join requests
     - the 100-block cap
   - Record these in TZ «Решения по 2.4».
1. **Local verification.** Postgres 16 with Supabase stubs: apply all migrations in order plus the two new ones, then run the SQL scenarios, including the parallel ones (see tests).
2. **Migrations via the connector.**
   - `apply_migration` 'stage_2_4_moderation', then 'stage_2_4_moderation_cron'.
   - Rename the files to the versions Supabase assigns and compare the text with `supabase_migrations.schema_migrations.statements`. Run `get_advisors` (RLS on the new tables).
   - This is backward compatible: everything is additive, the old RPCs are unchanged, `hidden_at` and `banned_at` are all null, and `user_blocks` is empty, so the current Edge and frontend behave exactly as before.
   - If apply_migration hangs: split it into tables and columns first, then functions.
3. **PR A: Edge Functions and backend tests.**
   - Contents:
     - telegram-api: guarded RPC names, the 6 routes, error mapping, the feed block filter, the 'mod' start param
     - notifications-worker: the admin batch, run first
     - `_shared/moderation.ts`
     - updated pinned tests
     - the optional SQL CI job
   - CI green, then merge; deploy-functions runs.
   - Compatible with the current frontend: response shapes are unchanged, and new 4xx texts appear through the existing ErrorNote.
   - Smoke test on prod: create a private and a public meeting, a join request, a proposal, load the feed.
   - Why a separate PR: deploy-functions and deploy-pages both trigger on a merge to main and run in parallel, so the frontend must not land in the same merge.
4. **PR B: frontend and e2e.**
   - Merge right after PR A is live, so users get all of 2.4 at once. Between steps 3 and 4 the backend is dark: nobody can report or block without the UI, and the limits are generous.
5. **Acceptance on prod with the owner:**
   - A second account reports a meeting. The bot message reaches the owner within 1 minute; check `sent_at - created_at` in `admin_message_outbox` with a read-only `execute_sql` that selects only those two fields.
   - Admin hides the meeting: it disappears from the feed.
   - Admin bans the second account: creating an open meeting and sending a join request both return the USER_BANNED text; a private meeting still works.
   - Unban and restore.
   - The second account blocks an organizer: that organizer's meetings disappear from its feed.
6. **Optional hardening, after a stable week.** A migration with `revoke execute on function public.create_event_categorized(...), public.create_event_idempotent_categorized(...), public.create_join_request(text, uuid), public.propose_event_time_option(...), public.propose_event_place_option(...) from service_role;`.
   - The definer wrappers are unaffected.
   - Only after stability, because it breaks a rollback to an older Edge version.
7. **Docs.** Update the TZ «Статус» and PROJECT_NOTES: the moderation model, the limits table and how to change it, and at-least-once delivery of admin messages. Commit and push.

## tests
**Vitest**

New `tests/moderation.test.ts`, plus updates to existing tests.

Migration contract:
- Every new table has RLS and the revoke. Extend the list in notifications.test.ts 'locks every new table'.
- Only `user_blocks` is granted to service_role.
- `rate_limit_rules` seeds equal the agreed numbers (parse the insert).
- `consume_action_quota` uses `pg_advisory_xact_lock` and raises RATE_LIMITED.
- `create_join_request_guarded` consumes only inside the 'created_pending' branch.
- The idempotent wrapper consumes only under `if not v_replayed`.
- Proposal wrappers consume 'option_proposal'.
- `create_report` consumes 'report' only after a successful insert.
- `unblock_user` and `purge_user_action_log` each contain exactly one "delete from" and no raise. The global drop/raise/delete and definer/revoke tests already apply to migrations ≥2026101313.

Edge helpers:
- parseReportRequest: reasons, comment trimming and ≤500, a single target, uuid validation.
- Token→HTTP mapping: RATE_LIMITED 429 with code, USER_BANNED 403 with code, unknown token → 500.
- adminChatIds.
- renderAdminReportMessage: «title» in quotes, reason label, comment optional, both target types, button url `startapp=mod`, plain text.
- `parseStartParam('mod')`.

telegram-api source:
- New routes appear in both allowedMethods and the handler.
- Creation, join and proposals use the `*_guarded` names.
- The feed applies the user_blocks filter.
- Admin routes check isAdminTelegramId before the RPC.
- create_report receives p_admin_chat_ids.

Worker source: 'admin' is first in the batch loop.

Frontend source:
- The rules gate: unseen, seen, and storage that throws.
- Dialog strings and the opaque rule in theme-sunset.css.
- The /admin/moderation route is guarded by auth.isAdmin, and the Home entry is inside isAdmin.
- OrganizerJoinRequests still has no error.message and no requesterUserId.
- event-payload-privacy is unchanged.
- action-styles: danger tokens on block and ban.

Pinned tests to update:
- tests/create-event-idempotency.test.ts:162
- tests/final-option-referential-integrity.test.ts:120
- tests/leave-participation.test.ts:162
- tests/public-join-request.test.ts:55 (`db.rpc("create_join_request"` becomes `_guarded`)
- tests/participant-option-proposals.test.ts (API source)

**SQL scenarios**

Commit `tests/sql/supabase-stubs.sql` (auth, vault.decrypted_secrets, cron.schedule, net.http_post, extensions), `tests/sql/stage-2-4.sql` and a runner script. Proposed CI job: `services: postgres:16`, apply all migrations in order, then the scenario with ON_ERROR_STOP. This makes «лимиты покрыты тестами» hold in CI rather than only locally.

1. **Each action.** per_hour calls succeed and the next raises RATE_LIMITED. Backdate the log rows by 61 minutes: allowed again until per_day. Backdate by 25 hours: reset.
2. **Open vs any.** Two public creations succeed and the third public one raises RATE_LIMITED, while a private one still succeeds. The failed attempt leaves no event and no log row.
3. **Replays and bans.**
   - An idempotent replay after the limit returns (id, true) and writes no log row.
   - A replay of a public meeting created before a ban still succeeds.
   - A banned user gets USER_BANNED on public creation and on join requests, while private creation works.
4. **Join outcomes.** existing_pending, already_participant and JOIN_REQUEST_REJECTED consume nothing. A RATE_LIMITED rollback leaves no join_requests row and no join_request_new outbox row.
5. **Parallel** (N psql sessions released together by a barrier advisory lock held by a controller session):
   - 8 join requests to 8 events with 6 of 10 already used: exactly 4 succeed.
   - 5 public creations: exactly 2 succeed.
   - 3 identical reports: 1 report, 1 log row, 1 outbox row per admin.
   - 6 different reports: exactly 5 succeed.
6. **Ban and hide.**
   - Ban hides the user's public meetings (`deleted_at = hidden_at = banned_at`), rejects their pending requests (adding join_request_rejected outbox rows) and resolves the related reports.
   - Unban restores only those meetings.
   - hide and restore toggle correctly, and the feed query excludes hidden meetings.
   - Invariant: `hidden_at` is never set while `deleted_at` is null.
7. **User block.**
   - Blocking from a join request rejects the pending request.
   - A new request from the blocked user raises JOIN_REQUEST_NOT_ALLOWED and uses no quota.
   - Two sessions (BEGIN and hold) interleave block and join, in both orders. The end state never has a pending request from the blocked user.
   - The cap of 100 holds.
   - unblock is idempotent.
8. **Report targets.**
   - The owner cannot report their own meeting.
   - A non-owner using participantId gets NOT_EVENT_OWNER.
   - A participant from another meeting gives TARGET_UNAVAILABLE.
   - A private meeting gives NOT_ALLOWED.
   - A duplicate returns created=false.
9. **Admin outbox.** Parallel claims get disjoint rows (skip locked). Retry backoff works, blocked becomes skipped, and a stale 'sending' row is reclaimed after 5 minutes.
10. **Grants.**
    - anon and authenticated: nothing.
    - service_role: cannot read reports, user_action_log or admin_message_outbox; can read user_blocks; cannot execute consume_action_quota or moderation_target.
11. **Deadlock soak.** 200 iterations of concurrent ban, approve, join and block on shared events produce no 40P01.
12. **Purge.** It deletes only rows older than 2 days.

**E2E** (mock mode, e2e/smoke.spec.ts)
- The existing tests 'visitor filters open meetings…' and 'organizer chooses a category…' must preset 'soberemsya-community-rules-seen' via `page.addInitScript`, or the dialog blocks them.
- New tests:
  - The rules show once on /open, and not again after a reload.
  - A participant reports a meeting on /#/event/evt_demo.
  - An organizer blocks a requester and reports a participant on /#/manage/evt_demo.
  - The admin opens /#/admin/moderation, hides a meeting (the button changes to «Вернуть встречу»), then bans and unbans.
  - A user unblocks someone on /#/settings.

**Before each PR:** `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e`, `git diff --check`, `deno check --node-modules-dir=none` for all three functions, `/code-review`, and `/security-review` for PR A.

## risks
1. **Connector hang.**
   - The migration is purely additive: no DROP, no ALTER of existing constraints, no new outbox or analytics kinds.
   - DELETE appears only in unblock_user and purge_user_action_log, each alone and without RAISE.
   - Because the test splits on `$$;`, comments in those two segments must not contain the words raise or "delete from".
   - Fallback: split the migration into a tables/columns part and a functions part.
2. **Hide reuses deleted_at.**
   - The owner and participants lose the meeting and see «Встреча не найдена или удалена»; the owner is not notified.
   - Pending reminders are skipped and are not re-sent after a restore.
   - The meeting's creation idempotency key may be released.
   - This is safe for scams, but it is an owner decision.
3. **Ban side effects.**
   - It hides all of the user's public meetings, including decided ones that have participants, and rejects their pending requests.
   - Unban restores only the meetings that this ban hid. Rejected requests stay rejected, so a retry gets JOIN_REQUEST_REJECTED.
   - Private meetings and existing participations are untouched, matching the TZ scope.
4. **Participant-to-participant complaints are not possible.** Participants have no ids for each other (the privacy tests forbid them), so they report the meeting and describe the person in the comment. Organizer→participant, organizer→requester and anyone→meeting/organizer are covered.
5. **User blocks are one-directional and feed-only.**
   - A blocked organizer's meeting still opens through a direct link.
   - The blocked user still sees the blocker's meetings.
   - The block rejects pending requests, so the requester sees «отклонена». That reveals a rejection, not the block.
   - The feed's `not in` filter also hides ownerless public meetings from viewers who have blocks; those can't be joined anyway.
6. **Rate-limit details.**
   - The advisory lock serializes one user's limited actions. That is negligible, and a hash collision only adds a brief wait.
   - Windows use the transaction start time.
   - Changing a limit needs a migration.
   - There is no Retry-After header.
   - Abuse spread across many accounts is limited only per account.
7. **Admin delivery.**
   - The owner must have started @flocklyappbot; otherwise Telegram returns 403, the row becomes skipped silently, and the report is still visible on the admin screen.
   - Chat ids are fixed at enqueue, so changing TELEGRAM_ADMIN_IDS does not redirect messages already queued.
   - The one-minute delivery depends on pg_cron and pg_net being healthy.
   - Delivery is at-least-once, so a rare duplicate message is possible.
8. **Release.** Deploy-functions and deploy-pages run in parallel on the same merge, so the frontend must ship in a separate PR B. Between PR A and PR B, limits and bans are active but unreachable without the UI. Keep that window short.
9. **Old RPCs stay open.** The unguarded RPCs remain executable by service_role until the optional revoke. Only Edge code calls them.
10. **False reports.** Brigading is limited only by per-reporter uniqueness and the quota. The admin card shows how many complaints the target has; nothing happens automatically.
11. **Personal data.** Reports and outbox payloads store names, usernames and Telegram ids, and 2.4 has no purge for them. Add a retention policy later.
12. **Pinned tests.** The source tests that name the current RPCs, and the e2e tests on /open, must be updated, or CI goes red.
13. **Rules shown once per device.** The «seen» flag lives in localStorage, so it can't be checked on the server and the rules show again on a new device.
14. **Production state not checked.** The Supabase connector failed to connect in this session, so the production migration and function versions were not compared with the repo. Check them before applying.