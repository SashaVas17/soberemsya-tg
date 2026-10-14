# Этап 2.4 — черновик архитектуры B (устойчивость к злоупотреблениям)

> Сгенерировано агентом проектирования 2026-10-14, не согласовано. Сверять с кодом перед реализацией.

## title
Stage 2.4 «Безопасность встреч с незнакомыми»: жалобы, блокировки, модерация и лимиты, проверяемые в БД

## dataModel
Limits are the ones already agreed in docs/TZ.md (commit 51f1170). All new objects come from migrations applied through the connector. There are no DROPs anywhere: every table, column, index and lookup row is additive. Every new table gets `alter table ... enable row level security;` and `revoke all privileges on table ... from public, anon, authenticated;`. **None of them gets a service_role grant.** Edge Functions reach them only through RPCs, so tests/service-role-grants.test.ts needs no new lines. A new test asserts there is no db.from() on these tables.

**M1 `<ts>_moderation_schema.sql` (no functions)**

1. **public.user_action_limits** (rate-limit config; changed only by an UPDATE in a later migration)
   - Columns: action text PK; hourly_limit int NOT NULL CHECK > 0; daily_limit int NOT NULL; description text; CHECK (daily_limit >= hourly_limit).
   - Seed: meeting_create 10/30; open_meeting_create 2/5; join_request 10/30; option_proposal 20/50; complaint 5/10.
2. **public.user_action_log** (the rate-limit ledger, also an audit trail)
   - Columns: id bigint identity PK; user_id uuid NOT NULL FK users ON DELETE CASCADE; action text NOT NULL FK user_action_limits(action); event_id text NULL (subject id, no FK, so it survives purges); created_at timestamptz NOT NULL default now().
   - Indexes: user_action_log_user_action_created_idx (user_id, action, created_at desc); user_action_log_created_idx (created_at) for the purge.
   - Retention: 30 days (windows need only 24 h).
3. **public.user_restrictions** (admin block)
   - Columns: user_id uuid PK FK users CASCADE; restricted_at timestamptz NOT NULL; restricted_by_user_id uuid FK users SET NULL; reason text CHECK (char_length <= 500); source_complaint_id uuid (FK added after complaints); lifted_at timestamptz; lifted_by_user_id uuid FK users SET NULL; CHECK (lifted_at is null or lifted_at >= restricted_at).
   - Active means lifted_at IS NULL. Unrestrict is an UPDATE, never a DELETE. Re-restrict is an upsert that clears lifted_at.
4. **public.user_blocks** (one user blocks another)
   - Columns: id uuid PK default gen_random_uuid(); blocker_user_id uuid NOT NULL FK users CASCADE; blocked_user_id uuid NOT NULL FK users CASCADE; source text NOT NULL CHECK in ('organizer','participant','join_request'); source_event_id text FK events ON DELETE SET NULL; created_at; revoked_at timestamptz.
   - Constraints: user_blocks_pair_key UNIQUE (blocker_user_id, blocked_user_id) (this also serves the forward lookup); user_blocks_not_self CHECK (blocker_user_id <> blocked_user_id).
   - Index for the reverse direction: user_blocks_blocked_active_idx (blocked_user_id, blocker_user_id) WHERE revoked_at IS NULL.
   - Unblock sets revoked_at; re-block clears it.
5. **public.complaint_reasons** (lookup; adding a reason is an INSERT, following the meeting_categories precedent)
   - Columns: id text PK; label text NOT NULL; sort_order int; is_active boolean default true.
   - Seed:
     - spam: «Спам или реклама»
     - fraud: «Мошенничество или просьбы перевести деньги»
     - offensive: «Оскорбления, угрозы или дискриминация»
     - unsafe: «Опасная или незаконная встреча»
     - misleading: «Встреча не соответствует описанию»
     - other: «Другое» (a comment is required)
6. **public.complaints**
   - Columns: id uuid PK default gen_random_uuid(); reporter_user_id uuid FK users ON DELETE SET NULL; target_type text NOT NULL CHECK in ('event','user'); target_key text NOT NULL ('event:<id>' or 'user:<uuid>'); target_event_id text FK events SET NULL (the meeting itself, or the meeting where the user was met); target_user_id uuid FK users SET NULL (the reported user, or for an event complaint a snapshot of the organizer); reason_id text NOT NULL FK complaint_reasons; comment text CHECK (char_length <= 500); target_snapshot jsonb NOT NULL default '{}' (title, names and usernames at filing time, kept for audit); status text NOT NULL default 'open' CHECK in ('open','actioned','dismissed'); resolution text CHECK in ('event_hidden','user_restricted','event_hidden_and_user_restricted','no_violation'); resolution_note text CHECK (<= 500); resolved_at; resolved_by_user_id uuid FK users SET NULL; created_at.
   - complaints_reporter_target_key UNIQUE (reporter_user_id, target_key) enforces "one complaint per reporter per target". NULL reporters do not collide.
   - Indexes: complaints_open_created_idx (created_at desc, id desc) WHERE status='open'; complaints_status_created_idx (status, created_at desc, id desc); complaints_open_target_idx (target_key) WHERE status='open'; complaints_target_user_idx (target_user_id); complaints_reporter_created_idx (reporter_user_id, created_at desc).
   - There are no cross-column CHECKs on the FK columns, so an ON DELETE SET NULL cannot violate a check.
7. **public.moderation_actions** (append-only audit; only RPCs insert)
   - Columns: id bigint identity PK; actor_user_id uuid FK users SET NULL; action text NOT NULL CHECK in ('event_hidden','event_unhidden','user_restricted','user_unrestricted','complaint_dismissed','complaint_actioned'); target_event_id text FK events SET NULL; target_user_id uuid FK users SET NULL; complaint_id uuid FK complaints SET NULL; reason text CHECK (<= 500); created_at.
   - Indexes: (created_at desc), (target_user_id), (target_event_id).
8. **public.community_rules_acceptances**
   - Columns: user_id uuid PK FK users CASCADE; version int NOT NULL CHECK > 0; first_accepted_at; accepted_at.
   - The table is versioned, so a new rules text can be shown again by raising COMMUNITY_RULES_VERSION.
9. **public.moderation_outbox_kinds** (lookup)
   - Seed: complaint_new (to admins), event_hidden (to the organizer), account_restricted (to the restricted user).
   - It is a lookup table rather than a CHECK, so a new kind never needs a constraint drop.
10. **public.moderation_outbox** (chat-id addressed, modelled on group_message_outbox)
    - Columns: id bigint identity PK; kind text NOT NULL FK moderation_outbox_kinds; chat_id bigint NOT NULL CHECK (chat_id > 0); complaint_id uuid FK complaints SET NULL; event_id text FK events SET NULL; target_user_id uuid FK users SET NULL (for the stale check); dedupe_key text NOT NULL UNIQUE; payload jsonb NOT NULL default '{}'; status text default 'pending' CHECK in ('pending','sending','sent','failed','skipped'); attempts int default 0; next_attempt_at default now(); locked_at; sent_at; last_error; created_at.
    - Indexes: moderation_outbox_due_idx (next_attempt_at, id) WHERE status in ('pending','sending'); moderation_outbox_created_idx (created_at).
11. **public.events**: add moderation_hidden_at timestamptz and moderation_hidden_by_user_id uuid FK users SET NULL (`alter table ... add column if not exists`).
    - No new index: hidden rows are rare and are filtered on top of the existing partial feed indexes.
    - service_role's table-level SELECT and UPDATE already cover new columns.
    - The column is not in the events_notify_changes column list, so hiding fires no participant notifications.
    - Why not deleted_at: it is irreversible for the owner, frees the idempotency key, makes the worker drop all notifications and hides the meeting from its own members.
12. Late FKs:
    - user_restrictions.source_complaint_id → complaints(id) ON DELETE SET NULL. Added with `alter table ... add constraint`, which is not a drop.

**Semantics**
- **Hidden meeting.**
  - Gone from the feed and from previews for non-members. New join requests are refused (JOIN_REQUEST_NOT_ALLOWED).
  - The organizer and existing participants keep full access. The organizer payload gets moderationHidden: true, which shows a banner.
  - Reversible: unhide sets the column to NULL.
- **Restricted user.**
  - Cannot create open meetings or send join requests (ACCOUNT_RESTRICTED). Private meetings, answers, votes and complaints still work.
  - Their open meetings drop out of the feed and previews at read time (anti-join, no mass UPDATE), and join requests to them are refused.
  - Their pending join requests disappear from organizers' lists. Unrestricting brings everything back with no data repair.
- **User block (A blocks B).** Applies in both directions for discovery:
  - neither sees the other's open meetings in the feed or preview;
  - neither can send a join request to the other's meetings;
  - A does not see B's pending join requests.
  - Existing memberships are untouched; the organizer can still use «Исключить из встречи».

**Grants**
- Tables: none for service_role.
- Lookup seeds use plain INSERTs in the migration.

## rpcs
All functions:
- are written with `create or replace function public.X(` and the one-line `security definer set search_path = pg_catalog, public`;
- are followed by `revoke all on function public.X(<types>) from public, anon, authenticated;`.

Public RPCs also get `grant execute ... to service_role`. **Internal helpers additionally get `revoke all ... from service_role;`.** The connector failed to connect in this session, so I could not check whether Supabase's default privileges grant EXECUTE to service_role on new functions. Before applying, check with `has_function_privilege` via execute_sql.

**Global lock order for 2.4** (prevents deadlocks):
1. complaint row (admin RPCs only);
2. events row: FOR UPDATE in the existing join and proposal RPCs, FOR KEY SHARE in complaint and block, FOR NO KEY UPDATE in admin hide;
3. at most one per-user advisory lock `pg_advisory_xact_lock(24001, hashtext(user_id::text))`;
4. moderation rows.

Why this order: without step 2 before step 3, a user who joins meeting E while complaining about E in parallel would deadlock, because the complaint's FK key-share on E would wait behind the join's FOR UPDATE.

**M2 `<ts>_rate_limits.sql`**

1. **INTERNAL `consume_user_action_quota(p_user_id uuid, p_actions text[], p_require_unrestricted boolean, p_event_id text default null) returns void`**, VOLATILE plpgsql.
   - A NULL user raises RATE_LIMIT_ACTOR_INVALID.
   - It takes the per-user advisory lock.
   - If p_require_unrestricted is true and an active user_restrictions row exists, it raises ACCOUNT_RESTRICTED.
   - For each action it reads the limits (a missing row raises RATE_LIMIT_CONFIG_MISSING, which maps to 500). It then runs one count: hour = `count(*) filter (where created_at > now() - interval '1 hour')`, and day = count over the last 1 day.
   - When a window is full it computes retry = (the (count-limit)-th oldest row in the window) + window − now(), at least 1 s. It then raises `errcode 'P0001', message 'RATE_LIMIT_EXCEEDED', detail '<action>:<hour|day>:<limit>:<retry_seconds>'`.
   - Only after every action passes does it insert one log row per action.
   - It has no DELETE.
2. **`create_event_categorized(...)`**, identical 11-arg signature. After `perform create_event_atomic(...)` and the category update it calls `consume_user_action_quota(p_actor_user_id, case when p_visibility='public' then array['meeting_create','open_meeting_create'] else array['meeting_create'] end, p_visibility='public', p_event_id)`.
3. **`create_event_idempotent_categorized(...)`**, identical 13-arg signature. The same call runs only inside `if not v_replayed`, so a replay never consumes quota and is never rejected. The existing comment about clients dropping their key still holds. A raise rolls back the meeting and the key claim.
4. **`create_join_request(text, uuid)`**, same signature and return type. The body is copied with the one-line definer. The event FOR UPDATE stays first. Only in the `not v_request_found` branch:
   - (a) raise JOIN_REQUEST_NOT_ALLOWED when moderation_hidden_at is not null, the owner has an active restriction, or an active user_blocks row exists in either direction between requester and owner;
   - (b) call `consume_user_action_quota(requester, '{join_request}', true, p_event_id)`;
   - (c) insert.
   - existing_pending and already_participant stay free no-ops.
5. **`propose_event_time_option(text, uuid, text, timestamptz)` and `propose_event_place_option(text, uuid, text, text, text, integer)`**, same signatures. After the 50-per-meeting cap check and before the INSERT they call `consume_user_action_quota(actor, '{option_proposal}', false, p_event_id)`. Time and place proposals share one bucket.
   - The organizer's add_event_time_option and add_event_place_option are not limited.
6. **`purge_user_action_log() returns integer`**, `language sql`: `with d as (delete from public.user_action_log where created_at < now() - interval '30 days' returning 1) select count(*)::int from d`. One DELETE, no RAISE. Scheduled with `cron.schedule('purge-user-action-log-daily', '47 3 * * *', ...)`.

**M3 `<ts>_moderation_rpc.sql`**

7. **INTERNAL `resolve_moderation_target(p_actor_user_id uuid, p_event_id text, p_target text, p_target_id uuid) returns table(target_type text, target_key text, target_user_id uuid, event_owner_user_id uuid, event_title text, snapshot jsonb)`**, STABLE. It holds the one rule set that decides who may name whom. Complaints and blocks share it.
   - 'event' and 'organizer': the event exists, deleted_at is null and visibility is 'public'. The actor must not be the owner (otherwise MODERATION_TARGET_SELF). The target user is owner_user_id; a NULL owner is allowed for 'event' and gives MODERATION_TARGET_UNAVAILABLE for 'organizer'.
   - 'participant': the event is public; the actor is the owner (otherwise NOT_EVENT_OWNER); a participants row with id = p_target_id belongs to the event; user_id is not null and is not the actor.
   - 'join_request': the actor is the owner; the request id belongs to the event.
   - Anything else raises MODERATION_TARGET_UNAVAILABLE, MODERATION_INPUT_INVALID or MODERATION_TARGET_SELF.
8. **`create_complaint(p_reporter_user_id uuid, p_event_id text, p_target text, p_target_id uuid, p_reason text, p_comment text, p_alert_chat_ids bigint[]) returns table(complaint_id uuid, outcome text)`**, where outcome is created or existing.
   - Validation: the reason must be active in complaint_reasons; the comment is trimmed and at most 500 characters; 'other' needs a comment (COMPLAINT_INPUT_INVALID). At most 10 alert chat ids, each > 0.
   - Order:
     - `perform 1 from events where id = p_event_id for key share` (event first);
     - resolve the target;
     - take the reporter's advisory lock;
     - if a complaint with the same (reporter, target_key) exists, return (id, 'existing'), which spends no quota and sends no alert;
     - `consume_user_action_quota(reporter, '{complaint}', false, p_event_id)`;
     - INSERT ... ON CONFLICT ON CONSTRAINT complaints_reporter_target_key DO NOTHING RETURNING id as a backstop;
     - insert one moderation_outbox row per distinct chat id: kind complaint_new, dedupe 'complaint:<id>:<chat>', next_attempt_at = now(), payload = {targetType, eventTitle, targetName, targetUsername, reporterName, reporterUsername, reasonLabel, comment, openOnTarget}.
9. **`block_user(p_actor_user_id uuid, p_event_id text, p_target text, p_target_id uuid) returns table(block_id uuid, outcome text)`**, where outcome is blocked or already_blocked. p_target is organizer, participant or join_request.
   - It takes the event key share, resolves the target, and inserts with ON CONFLICT (pair) DO UPDATE SET revoked_at=null, source=..., source_event_id=... WHERE revoked_at is not null.
   - It then marks the blocker's pending join_request_new outbox rows from the blocked user as skipped, matching on dedupe_key = 'joinreq:'||jr.id. This is an UPDATE, not a DELETE.
10. **`unblock_user(p_actor_user_id uuid, p_block_id uuid) returns table(block_id uuid, outcome text)`** sets revoked_at. A block that is not the caller's raises BLOCK_NOT_FOUND. It is idempotent.
11. **`list_user_blocks(p_actor_user_id uuid) returns table(block_id uuid, source text, event_title text, first_name text, last_name text, username text, created_at timestamptz)`**, STABLE, at most 200 rows, active only.
    - For source='organizer' the name fields are returned as NULL. The organizer's identity is never shown in the feed or preview, so the block list must not leak it either.
12. **`accept_community_rules(p_user_id uuid, p_version int) returns table(version int, accepted_at timestamptz)`** upserts with greatest(version).
13. **`viewer_moderation_state(p_user_id uuid) returns table(account_restricted boolean, community_rules_version int)`**, STABLE.
14. **`list_public_feed(p_viewer_user_id uuid, p_city_id text, p_category_id text, p_title_pattern text, p_cursor_created_at timestamptz, p_cursor_id text, p_limit int) returns table(id text, owner_user_id uuid, title text, description text, budget_limit int, max_participants int, status text, created_at timestamptz, category_id text)`**, STABLE.
    - Same filters and keyset as today: city, public, deleted_at null, collecting, optional category, `title ilike p_title_pattern` where the pattern is already escaped by titleSearchPattern, and order (created_at desc, id desc). The limit is clamped to 1..51.
    - Added: moderation_hidden_at is null; NOT EXISTS an active restriction on the owner; NOT EXISTS an active block in either direction between viewer and owner.
    - The filter runs inside the DB before LIMIT, so page sizes stay correct.
15. **`public_event_discoverable(p_event_id text, p_viewer_user_id uuid) returns boolean`**, STABLE, with the same predicate for a single event. The preview uses it.
16. **`list_pending_join_requests(p_event_id text, p_actor_user_id uuid) returns table(request_id uuid, created_at timestamptz, first_name text, last_name text, username text)`**.
    - Same errors as today's direct read: EVENT_UNAVAILABLE, NOT_EVENT_OWNER, JOIN_REQUEST_NOT_ALLOWED for a non-public meeting.
    - Excludes requesters with an active restriction and requesters with a block in either direction.
17. **INTERNAL `apply_event_hidden(p_admin uuid, p_event_id text, p_hidden boolean, p_reason text, p_complaint_id uuid) returns boolean`** (whether anything changed).
    - Locks the event `for no key update` where deleted_at is null, otherwise MODERATION_TARGET_UNAVAILABLE. Sets or clears moderation_hidden_*.
    - Inserts a moderation_actions row.
    - When newly hidden: marks open complaints with target_key 'event:<id>' as actioned, and enqueues event_hidden to the owner's telegram_user_id (dedupe 'event_hidden:<id>:<hidden_at epoch>').
18. **INTERNAL `apply_user_restriction(p_admin uuid, p_target uuid, p_restricted boolean, p_reason text, p_complaint_id uuid, p_protected_telegram_ids bigint[]) returns boolean`**.
    - Raises MODERATION_TARGET_SELF when target = admin, and MODERATION_TARGET_PROTECTED when the target's telegram_user_id is in p_protected_telegram_ids.
    - Takes the target's advisory lock, which serialises it with that user's in-flight create and join, then upserts or lifts the restriction and writes an audit row.
    - When restricting it also:
      - marks open complaints with target_user_id = target as actioned;
      - skips the target's pending join_request_new outbox rows;
      - enqueues account_restricted.
19. **`admin_resolve_complaint(p_admin_user_id uuid, p_complaint_id uuid, p_action text, p_note text, p_protected_telegram_ids bigint[]) returns table(complaint_id uuid, status text, event_hidden boolean, user_restricted boolean)`**.
    - p_action is dismiss, hide_event, restrict_user or hide_event_and_restrict_user.
    - Locks the complaint row FOR UPDATE. A complaint that is no longer open returns its current state (idempotent for double taps and two admins).
    - Then calls the helpers in lock order (event, then advisory) and writes the resolution, the note and the audit row.
20. **`admin_set_event_hidden(p_admin_user_id uuid, p_event_id text, p_hidden boolean, p_reason text) returns table(event_id text, hidden boolean, changed boolean)`** and **`admin_set_user_restricted(p_admin_user_id uuid, p_target_user_id uuid, p_restricted boolean, p_reason text, p_protected_telegram_ids bigint[]) returns table(user_id uuid, restricted boolean, changed boolean)`** are thin wrappers, used for unhide, unrestrict and direct actions.
21. **`admin_list_complaints(p_status text, p_cursor_created_at timestamptz, p_cursor_id uuid, p_limit int) returns table(id, created_at, status, reason_id, reason_label, comment, target_type, event_id, event_title, event_description, event_hidden, event_deleted, target_user_id, target_name, target_username, target_restricted, reporter_user_id, reporter_name, reporter_username, open_on_target int, resolution, resolution_note, resolved_at)`**, STABLE. p_status is open or closed. Keyset (created_at desc, id desc); limit 1..51.
22. **`admin_moderation_measures() returns jsonb`**, STABLE: {hiddenEvents: [≤100 {eventId, title, hiddenAt}], restrictedUsers: [≤100 {userId, name, username, restrictedAt, reason}]}.
23. **`claim_moderation_messages(p_limit int) returns table(id bigint, chat_id bigint, kind text, event_id text, payload jsonb, attempts int, stale boolean)`**.
    - A copy of claim_group_message_batch: due pending rows, or sending rows locked for more than 5 minutes, FOR UPDATE SKIP LOCKED, limit 1..100.
    - stale is computed in SQL:
      - complaint_new: the complaint is no longer open;
      - event_hidden: the event is unhidden or deleted;
      - account_restricted: the restriction has been lifted.
24. **`complete_moderation_message(p_id bigint, p_outcome text, p_error text default null, p_retry_after_seconds int default null) returns void`**.
    - Same outcomes as complete_group_message, without migrated: sent; retry (backoff 30·2^attempts capped at 3600, failed after 5 attempts); defer; blocked → skipped; skip; anything else → failed.
25. **`purge_moderation_outbox() returns integer`** (SQL, one DELETE of sent, skipped and failed rows older than 30 days), scheduled as `cron.schedule('purge-moderation-outbox-daily','53 3 * * *', ...)`.
26. **`admin_stats()`**, same signature. Adds the keys complaintsOpen, complaints7d, restrictedUsers, hiddenMeetings and moderationAlertsUndelivered7d.

**M4 `<ts>_revoke_legacy_creation_rpcs.sql`** (applied after the new telegram-api is confirmed deployed)
- `revoke execute on function public.create_event_atomic(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb) from service_role;`
- The same for `create_event_idempotent(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb)`.
- This closes the unlimited bypass. The categorized wrappers are definer-owned and keep working.

**How the DELETE and RAISE rules hold**
- The only DELETEs are the two purge SQL functions, one DELETE each and no RAISE.
- Unblock, unrestrict, unhide and resolve are UPDATEs.
- New notification kinds go into a new outbox with a lookup table, so notification_outbox_kind_check is never touched.
- Every replaced function keeps its exact signature. A changed signature would leave the old unlimited overload callable, because it cannot be dropped.
- Comments must not contain the words "raise" or "delete from": the test splits on `$$;`, so a comment counts toward the next function's body.

## rateLimits
**Mechanism**
- An exact sliding window over the ledger public.user_action_log.
- Checked and written inside the same transaction as the business insert, by the internal helper consume_user_action_quota, which the browser and the Edge Function cannot call.

**Why it holds under parallel requests**
- Each call takes `pg_advisory_xact_lock(24001, hashtext(user_id::text))` before counting. The lock is per user and lasts for the transaction.
- Supabase runs at READ COMMITTED and the RPCs are VOLATILE, so the count statement that runs after the lock is granted takes a fresh snapshot. It therefore sees the rows committed by the transaction that held the lock before.
- So for N parallel requests from one user exactly `limit − used` succeed, and the rest get RATE_LIMIT_EXCEEDED.
- A rejected or failed action raises, which rolls back the whole transaction including its log rows. Failed attempts never consume quota.
- Only successful actions are counted.
- The same advisory lock is taken by admin restriction (apply_user_restriction). A restriction and an in-flight open-meeting creation or join request therefore serialise: no open meeting can be created after a restriction commits.
- Lock order: the event row first (join and proposal already lock it FOR UPDATE), then the advisory lock. There is at most one advisory lock per transaction, so there are no deadlocks.
- Hash collisions only add a little serialisation.

**Configuration**
- The table public.user_action_limits is seeded in M1 with the agreed values:

| action | per hour | per day |
|---|---|---|
| open_meeting_create | 2 | 5 |
| meeting_create (any meeting, open ones included) | 10 | 30 |
| join_request | 10 | 30 |
| option_proposal (time and place combined) | 20 | 50 |
| complaint | 5 | 10 |

- Complaints are also capped at one per reporter per target, enforced by UNIQUE (reporter_user_id, target_key).
- Answers and votes are not limited. Neither are the organizer's own option additions, which keep the existing 50-per-meeting cap. Blocks and unblocks, rules acceptance and admin actions are not limited either.
- Changing a limit means an `update public.user_action_limits ...` migration (no drop). A vitest test pins the seeded numbers to the TZ values, so a change must be deliberate.
- Admins are not exempt. Adding an exemption would need new RPC signatures; the owner can raise limits through a migration.

**What consumes quota**
- Creating a private meeting writes one meeting_create row. Creating an open meeting writes meeting_create and open_meeting_create; both are checked before either is inserted.
- An idempotent replay consumes nothing and is never rejected.
- A join request consumes quota only on created_pending. existing_pending and already_participant are free. Because leaving or removal deletes the join_requests row, the ledger, not the request rows, is what stops leave-and-rejoin loops.
- A proposal consumes quota only after it passes every validity check, just before its INSERT.
- A complaint consumes quota only when it is new. A duplicate returns 'existing' for free.

**Error contract**
- `RAISE ... errcode 'P0001', message 'RATE_LIMIT_EXCEEDED', detail '<action>:<hour|day>:<limit>:<retry_seconds>'`.
- The retry time is (the (count−limit)-th oldest row in the window) + window − now(), at least 1 s. It stays correct even if a limit is lowered below the current usage.
- `_shared/rate-limits.ts` parses details with `^(meeting_create|open_meeting_create|join_request|option_proposal|complaint):(hour|day):(\d{1,6}):(\d{1,6})$` and returns `applicationError('RATE_LIMIT_EXCEEDED', 429, message)`.
- Message: «Можно {создать|отправить|предложить} не больше {limit} {открытых встреч|встреч|заявок|вариантов|жалоб} {в час|в сутки}. Попробуйте {через минуту|через N мин.|через N ч.}».
  - Example: «Можно создать не больше 2 открытых встреч в час. Попробуйте через 25 мин.»
- Malformed details still produce 429 with a generic «Слишком много действий за короткое время. Попробуйте позже.»
- ACCOUNT_RESTRICTED gives 403 «Для вашего аккаунта ограничены создание открытых встреч и отправка заявок.»
- Both tokens are handled first by the shared rpcGuardHttpError(), which eventCreationHttpError, createJoinRequestHttpError, participantOptionProposalHttpError and the complaint mapper all call. Without it they would map to 500.
- The client's create wizard already drops its idempotency key on 4xx. That is correct for 429 and 403, because the rollback also undid the key claim.

**Purge and timestamps**
- The ledger keeps 30 days and is purged daily by purge_user_action_log, which is a single DELETE. It also serves as an audit of who created, joined, proposed and complained, and when.
- created_at is now(), the transaction start. The window boundary can drift by the length of a transaction (milliseconds), which is acceptable and documented.

**How it is tested**
- SQL scenarios with backdated ledger rows check the window boundaries.
- Gated parallel runs check exact counts.
- Vitest checks the message and detail parsing and that the seeded numbers match the TZ (see tests).

## api
All routes are in supabase/functions/telegram-api/index.ts. Each must be added to both allowedMethods(path) and handleApiRequest; otherwise the route returns 404. Each is authenticated.

Bodies are read with readJsonObject and a 4 KB limit. Validation lives in `_shared/moderation.ts`:
- parseComplaintRequest:
  - target is 'event', 'participant' or 'join_request';
  - targetId is a uuid, required for participant and join_request and forbidden for event;
  - reason must be in COMPLAINT_REASON_IDS, which a test keeps in sync with the M1 seed;
  - the comment is trimmed, control characters other than \n are removed, and it is at most 500 characters.
- parseBlockRequest: target is 'organizer', 'participant' or 'join_request'.

**User endpoints**
1. `POST /events/:id/complaints` with {target, targetId?, reason, comment?}.
   - Calls create_complaint with p_alert_chat_ids = [...adminIds].map(Number) from TELEGRAM_ADMIN_IDS (default 1979217645).
   - Returns 201 {complaint: {status: 'received'}} or 200 {complaint: {status: 'already_received'}}.
2. `POST /events/:id/blocks` with {target, targetId?}. Calls block_user and returns 201 or 200 {block: {id, status: 'blocked'}}.
3. `GET /me/blocks` returns {blocks: [{id, label, createdAt}]}. label is built from the list_user_blocks row: «Имя Фамилия (@username)», or «Организатор встречи «Название»» for organizer blocks.
4. `DELETE /me/blocks/:blockId` (the id must be a uuid, otherwise 404) calls unblock_user and returns {unblocked: true}.
5. `PUT /me/community-rules` with {version: 1}. Calls accept_community_rules and returns {communityRulesVersion}.
6. `POST /telegram/auth` additionally returns `moderation: {accountRestricted, communityRulesVersion | null}` from viewer_moderation_state. If that call fails, moderation is null; auth itself never fails because of it.

**Changed reads** (response shapes unchanged)
- `GET /public/events` uses db.rpc('list_public_feed', {..., p_title_pattern: search ? titleSearchPattern(search) : null}) instead of db.from('events'). The time_options and participants lookups per page stay as they are.
- publicEventPreview first calls public_event_discoverable(eventId, userId). false returns the existing 404 «Встреча не найдена или удалена.»
- organizerJoinRequests uses list_pending_join_requests and keeps the {requests: [{requestId, status: 'pending', createdAt, requester: {displayName, username}}]} shape. No user ids are exposed.
- The organizer event payload adds moderationHidden: boolean, read from events.moderation_hidden_at in loadFullEventRow's select.

**Admin endpoints**
- Every admin route returns a plain 404 {error: 'Маршрут не найден.'} unless isAdminTelegramId(auth.user.telegram_user_id, adminIds) is true, the same pattern as /admin/stats.
- The admin's users.id is passed as p_admin_user_id for the audit trail.
- p_protected_telegram_ids = adminIds, so an admin cannot be restricted (409 MODERATION_TARGET_PROTECTED, with no code exposed).

Routes:
1. `GET /admin/complaints?status=open|closed&cursor=` returns {items: [{id, createdAt, status, reason: {id, label}, comment, target: {type, eventId, eventTitle, eventDescription, eventHidden, eventDeleted, userId, name, username, restricted}, reporter: {userId, name, username}, openOnTarget, resolution, resolutionNote, resolvedAt}], nextCursor}.
2. `POST /admin/complaints/:id/resolve` with {action: 'dismiss'|'hide_event'|'restrict_user'|'hide_event_and_restrict_user', note?} returns {complaint: {id, status}, eventHidden, userRestricted}.
3. `GET /admin/moderation/measures` returns {hiddenEvents, restrictedUsers}.
4. `PUT /admin/events/:id/hidden` with {hidden: boolean, reason?} returns {eventId, hidden, changed}.
5. `PUT /admin/users/:userId/restriction` with {restricted: boolean, reason?} returns {userId, restricted, changed}.

**Error mapping** (`_shared/moderation.ts` moderationHttpError plus the shared rpcGuardHttpError). Only `code === 'P0001'` with a known message is mapped; anything else is a 500.
- RATE_LIMIT_EXCEEDED → 429, code RATE_LIMIT_EXCEEDED.
- ACCOUNT_RESTRICTED → 403, code ACCOUNT_RESTRICTED.
- MODERATION_TARGET_UNAVAILABLE, BLOCK_NOT_FOUND and COMPLAINT_UNAVAILABLE → 404 «Не удалось найти…», no code.
- NOT_EVENT_OWNER → 403, existing code.
- MODERATION_TARGET_SELF → 400 «Нельзя пожаловаться на себя или заблокировать себя.»
- COMPLAINT_INPUT_INVALID and MODERATION_INPUT_INVALID → 400.
- MODERATION_TARGET_PROTECTED → 409.
- Join requests from a blocked direction, to a hidden meeting or to a restricted owner deliberately reuse JOIN_REQUEST_NOT_ALLOWED (409 «Сейчас к этой встрече нельзя присоединиться.») so the response does not reveal a block.

**Whitelists**
- Add RATE_LIMIT_EXCEEDED and ACCOUNT_RESTRICTED to SAFE_APPLICATION_ERROR_CODES (`_shared/errors.ts`) and to SAFE_API_ERROR_CODES (`src/api-error.ts`).
- No Retry-After header is added. The wait time is in the message.

**Start parameter**
- parseStartParam (`_shared/domain.ts`) accepts 'mod' → {type: 'moderation'}. Without this, /telegram/auth would return 400 for the admin's deep link.
- startParamSource maps 'mod' to 'moderation'.

**Bot**
- telegram-bot needs no route changes. Optionally, /stats text gains «Жалобы: открытых N» from the extended admin_stats.

## notifications
**Admin complaint alert** (the acceptance criterion: it reaches the admin within a minute)
- **Outbox.** A new public.moderation_outbox, addressed by Telegram chat_id like group_message_outbox. notification_outbox and its kind CHECK are not touched, so there is no constraint drop and no connector hang. Kinds come from the moderation_outbox_kinds lookup: complaint_new, event_hidden, account_restricted.
- **Recipients.**
  - The admin list exists only in the Edge Function env (TELEGRAM_ADMIN_IDS, parsed by parseAdminIds, default 1979217645). telegram-api therefore passes the admin chat ids into create_complaint as p_alert_chat_ids bigint[].
  - The complaint and one outbox row per admin are inserted in the same transaction: dedupe 'complaint:<complaintId>:<chatId>', next_attempt_at = now().
  - This needs no users row for the admin and no copy of the admin list in the DB.
  - The DB trusts the list because only service_role can execute the RPC.
  - If the env list is empty, the default owner id still applies.
- **Delivery.**
  - The pg_cron job notifications-worker runs every minute. The worker gets a new processModerationBatch(), run first in each pass, before the personal and group batches, for up to MAX_BATCHES × 25 rows.
  - It claims with claim_moderation_messages(25). A row with stale=true is completed as 'skip'; otherwise it sends via sendMessage(chat_id, renderModerationMessage(kind, payload, link)).
  - It completes with complete_moderation_message, reusing classifyTelegramResult and the existing throttled → defer logic.
  - Worst-case latency is one cron interval plus the run, which is ≤ ~60–70 s and meets the criterion.
  - Delivery is at least once: a crash between the Telegram send and complete re-sends after the 5-minute lock expiry. This is documented in PROJECT_NOTES, with no fake exactly-once.
- **Rendering.** `_shared/moderation-messages.ts` sends plain text with no parse_mode, so user text cannot inject markup. It has one inline URL button.
  - complaint_new:
    > Новая жалоба: {reasonLabel}
    > Встреча: «{title}» (or: Пользователь: {name} (@{username}), встреча «{title}»)
    > Комментарий: {comment, ≤500}
    > От кого: {reporterName} (@{username})
    > Открытых жалоб на этот объект: {openOnTarget}
  - Button «Открыть жалобы» → `https://t.me/<bot>/<app>?startapp=mod`, built by moderationDeepLink(bot, app).
  - The frontend routes startParam 'mod' to /admin/moderation only when auth.isAdmin is true; anyone else lands on Home.
  - The text stays far below Telegram's 4096-character limit: title ≤200, comment ≤500.
- **Stale check (SQL).** A complaint_new is skipped if the complaint was resolved before sending, so a quick dismissal in the app stops the alert.
- **Bot not started.** If the admin never started @flocklyappbot, Telegram returns 403 and the row becomes skipped with last_error 'blocked'.
  - The counter moderationAlertsUndelivered7d in admin_stats (/stats and the admin stats screen) makes this visible.
  - The release checklist includes a test complaint.

**Messages to users** (same outbox; can be cut from scope without schema changes)
- event_hidden goes to the organizer's users.telegram_user_id:
  > Встреча «{title}» скрыта из открытых встреч: она не соответствует правилам сообщества. Участники по-прежнему видят её.
  - Button «Открыть встречу» → eventDeepLink.
  - Stale if the meeting was unhidden or deleted.
- account_restricted:
  > Для вашего аккаунта ограничены создание открытых встреч и отправка заявок из-за нарушения правил сообщества.
  - Button «Открыть Flockly».
  - Stale if the restriction was lifted.
- No message on unhide, unrestrict or dismissal. Reporters see an in-app confirmation only.

**Blocks and restrictions in existing notifications**
- join_request_new can no longer be produced by a blocked or restricted requester, because create_join_request refuses the request.
- block_user and apply_user_restriction mark already-queued pending join_request_new rows from that requester as skipped, matched by dedupe 'joinreq:<request id>'. This is an UPDATE, not a DELETE.
- Remaining race: a block that commits while the requester's insert is still in flight can let one notification through. The list is filtered at read time, so the request itself is never shown. This is documented.
- Membership notifications (decided, updated, reminders) are unchanged: blocks do not remove anyone from a meeting.

**Maintenance**
- purge_moderation_outbox runs daily at 03:53 (single DELETE, 30-day retention).
- No new analytics names. analytics_events_name_check would need a drop, so the counts come from admin_stats over the moderation tables instead.

## frontend
**Shared**

1. **`src/moderation.ts`** (new)
   - COMPLAINT_REASONS (id and label, matching the seed), COMMUNITY_RULES_VERSION = 1, and the COMMUNITY_RULES text drafted by Claude, which the owner approves. Shown with the title «Правила открытых встреч»:
     > 1. Относитесь к людям с уважением: без оскорблений, давления и дискриминации.
     > 2. Без рекламы, спама и продаж под видом встречи.
     > 3. Описание встречи должно соответствовать тому, что будет на самом деле.
     > 4. Встречайтесь в общественных местах и не переводите деньги незнакомым заранее.
     > 5. Если что-то не так, нажмите «Пожаловаться». За нарушения доступ к открытым встречам ограничивается.
   - Helpers: fixed-text moderationActionErrorMessage(error), which never uses error.message where tests forbid it; rulesAcceptedLocally and markRulesAcceptedLocally on the localStorage key 'soberemsya-community-rules-version', with every access in try/catch.
2. **`src/api.ts` and `src/mock-api.ts`**: reportComplaint(eventId, body), blockUser(eventId, body), blocks(), unblock(id), acceptCommunityRules(version), adminComplaints(status, cursor), adminResolveComplaint(id, action, note?), adminModerationMeasures(), adminSetEventHidden(eventId, hidden), adminSetUserRestricted(userId, restricted).
   - The mock keeps state in module variables. It throws ApiError(…, 429, 'RATE_LIMIT_EXCEEDED') on the 11th mock join request and returns 'already_received' for a duplicate complaint.
   - The mock auth result gets moderation {accountRestricted: false, communityRulesVersion: null}.
3. **`src/api-error.ts`**: add RATE_LIMIT_EXCEEDED and ACCOUNT_RESTRICTED. AuthResult gets an optional `moderation`, so an older backend response still parses.
4. **Dialogs.** There is no shared dialog component, so two follow the participant-remove-dialog markup (role=dialog, aria-modal, backdrop with safe-area padding):
   - `src/ui/ReportDialog.tsx` (classes report-backdrop and report-dialog):
     - title «Пожаловаться на встречу» or «Пожаловаться на участника»;
     - radio list of reasons;
     - textarea «Комментарий (необязательно)», required for «Другое», maxLength 500 with a counter;
     - buttons secondary «Отмена» and primary «Отправить», with a lock ref against double submit;
     - success state «Жалоба отправлена. Спасибо, мы её рассмотрим.», or «Вы уже отправляли жалобу на это.» for already_received;
     - errors are shown via ErrorNote using the server message, so the rate-limit text appears verbatim.
   - `src/ui/CommunityRulesDialog.tsx` (classes community-rules-backdrop and community-rules-dialog), with one primary button «Понятно».
   - Add both dialog classes to the opaque-dialog rule in src/theme-sunset.css (~107–112), with styles in styles.css next to .participant-remove-dialog.

**Screens**

5. **PublicMeetings (`/open`)**
   - Receives `rulesAccepted` and `onRulesAccepted` from App. On mount, it opens CommunityRulesDialog if neither the server version nor the local flag is ≥ COMMUNITY_RULES_VERSION.
   - «Понятно» marks the rules accepted locally right away, closes the dialog and fires api.acceptCommunityRules(1). If that call fails, the next session silently re-sends it when the server value is null but the local flag is set.
   - Feed cards stay single buttons; nothing is nested inside them.
6. **PublicPreviewScreen** (also reached by deep link, so it gates rules too)
   - «Хочу присоединиться» first opens CommunityRulesDialog if the rules are not yet accepted, then submits.
   - With accountRestricted, or after an ACCOUNT_RESTRICTED error, the button is disabled and the note reads «Отправка заявок для вашего аккаунта ограничена.»
   - Below section.public-preview-request comes a div.public-preview-safety with quiet actions:
     - «Пожаловаться на встречу» opens ReportDialog with target 'event';
     - «Не показывать встречи организатора» is a quiet-danger-action. window.confirm asks «Вы больше не увидите открытые встречи этого организатора, а он — ваши. Продолжить?» It then calls POST /events/:id/blocks {target: 'organizer'} and navigate('/open', true).
7. **ParticipantEvent** (approved participant of a public meeting, `event.visibility === 'public' && !event.canManage`): a quiet «Пожаловаться на встречу» next to LeaveMeetingAction. No participant-level actions here, because participants deliberately receive no ids (event-payload-privacy test).
8. **Manage**
   - If event.moderationHidden, a notice panel: «Встреча скрыта из открытых встреч модератором. Участники по-прежнему её видят.»
   - For public meetings, inside each `<details className="participant-answer">` for anyone but the organizer, a div.participant-moderation-actions next to «Исключить из встречи»:
     - «Пожаловаться» opens ReportDialog with target 'participant' and targetId person.id;
     - «Заблокировать» (quiet-danger-action) confirms with «Заблокировать {name}? Вы не будете видеть его заявки и встречи, а он — ваши. Из этой встречи он не исключается.»
   - These texts and class names must not appear in the ParticipantEvent source.
9. **OrganizerJoinRequests**
   - In each article.join-request-card, a row .join-request-moderation with quiet buttons «Пожаловаться» and «Заблокировать». They use requestId only (target 'join_request'), never a user id.
   - After a successful block the card is removed locally.
   - Errors go through fixed texts. The component still contains no 'error.message', 'requesterUserId' or 'telegramUserId'.
10. **CreateEvent**
    - If auth.moderation.accountRestricted, the «Открытая встреча» option is disabled with the note «Создание открытых встреч для вашего аккаунта ограничено.»
    - On submit, RATE_LIMIT_EXCEEDED and ACCOUNT_RESTRICTED messages appear through the existing ErrorNote (createEventErrorMessage already passes ApiError messages through), and the form data is kept.
    - Proposal and join errors already show reason.message, so limit texts appear unchanged.
11. **BlockedUsersScreen** (`/blocked`, new file `src/screens/BlockedUsersScreen.tsx`)
    - Layout: settings-screen / settings-page with Header «Заблокированные».
    - A list of {label, «с {date}»} with a secondary «Разблокировать» button each.
    - Empty state: «Вы никого не блокировали.»
    - Entry: a home-settings-link «Заблокированные» (lucide UserX) on Home, under «Уведомления от бота».
12. **AdminModerationScreen** (`/admin/moderation`, route `if (path === '/admin/moderation' && auth.isAdmin)` before the Home fallback)
    - Built on the AdminStatsScreen layout, with a segmented switch «Новые / Решённые / Меры».
    - Complaint cards show:
      - reason badge, time, comment;
      - target: the meeting title and description excerpt with a «скрыта» or «удалена» badge, or the user's name, @username and a «ограничен» badge;
      - «От: name (@username)»;
      - «Ещё жалоб на этот объект: N».
    - Actions use window.confirm and a per-card lock:
      - «Скрыть встречу» (danger-button);
      - «Ограничить пользователя» (danger-button);
      - «Скрыть и ограничить»;
      - «Нарушений нет» (secondary-action).
    - The «Меры» tab lists hidden meetings with «Вернуть в ленту» and restricted users with «Снять ограничение».
    - Home gets an `isAdmin && home-settings-link «Модерация»` entry (lucide ShieldAlert) next to «Статистика». In mock mode the user is an admin, so it is visible for e2e.
13. **App.tsx**
    - Keeps a moderation state built from the auth result, updated after rules acceptance.
    - `result.startParam === 'mod' && result.isAdmin` → navigate('/admin/moderation', true).
    - Passes accountRestricted and rules props down.
    - New screen files are picked up by tests/app-source.ts; new declarations go to the end of the legacyOrder list.

**Constraints respected**
- No organizer identity in the feed or preview; the block list labels organizer blocks by meeting title.
- No participant ids for non-organizers.
- Destructive actions use .danger-button or .quiet-danger-action (action-styles test).
- All texts are neutral and use «вы».

## rollout
The order is migrations → Edge Functions → frontend, and each step is backward compatible. deploy-pages.yml and deploy-functions.yml both run in parallel on every push to main, so a single merge cannot guarantee that functions deploy before the frontend. Stage 2.4 is therefore built on one branch and released through **two PRs on the same day**:
- PR-1: backend, migration files and tests;
- PR-2: frontend, e2e and docs.

Between them users see no new UI, only stricter server enforcement. That is the safe direction: no UI ever ships without enforcement. User-facing 2.4 launches as a whole with PR-2.

**Step 0: preparation**
- The owner approves the community rules text and the complaint reasons.
- Check production state with the connector, which failed to connect in this session:
  - list_edge_functions: the deployed telegram-api must already call only the *_categorized creation RPCs (Stage 2.2);
  - list_migrations;
  - via execute_sql: whether new public functions get EXECUTE for service_role by default (has_function_privilege). This decides the internal-helper revokes.
- Local Postgres 16 with Supabase stubs: apply all migrations and run the SQL scenarios, including the parallel ones.

**Step 1: migrations, applied via apply_migration one at a time**
Each file is renamed to its Supabase version afterwards, and its text is compared with supabase_migrations.schema_migrations.statements.
1. **M1 moderation_schema**: tables, the events columns, lookups and seeds. Purely additive; the old Edge code is unaffected (it selects explicit columns).
2. **M2 rate_limits**:
   - the helper;
   - the replaced bodies of create_event_categorized, create_event_idempotent_categorized, create_join_request and propose_event_time_option / propose_event_place_option, with identical signatures and result shapes;
   - the purge and its cron job.
   - Compatible with the deployed Edge code: the shapes are unchanged, and new tokens only appear when a limit is hit. The old Edge code maps those to a generic 500 for the minutes until PR-1 deploys. No restrictions exist yet, so ACCOUNT_RESTRICTED cannot occur.
   - Apply it right before merging PR-1 to keep that window short.
3. **M3 moderation_rpc**: new functions only, plus admin_stats replaced with the same signature and additive keys (the old formatStatsText ignores extra keys). Fully additive.
4. Small migrations reduce connector risk. If any apply_migration hangs (60 s), stop: per the known connector bug nothing is applied. Find the offending statement (a drop, raise plus delete, or two deletes), split it out and retry.

**Step 2: PR-1, Edge Functions**
- Contents: telegram-api (new routes, feed and preview and join-list via RPC, error mapping, auth.moderation, the 'mod' start parameter), notifications-worker (moderation batch first), and the `_shared` modules.
- Before the PR: npm test, lint, build, test:e2e, git diff --check, deno check for each of the three functions, /code-review and /security-review.
- After CI is green, merge. deploy-functions runs; Pages redeploys the unchanged frontend.
- Compatible with the old frontend: every response shape is unchanged or additive.
- Post-deploy checks via logs, requesting only the needed fields:
  - the feed, preview, organizer join list, create, join and propose all work;
  - no 500 errors;
  - the worker's moderation batch runs every minute.

**Step 3: M4, revoke the legacy creation RPCs from service_role**
- Applied only after Step 2 is confirmed live. It closes the unlimited bypass through create_event_atomic and create_event_idempotent.

**Step 4: PR-2, frontend**
- Contents: screens, dialogs, the API client, the mock, e2e, and docs (TZ.md «Статус», PROJECT_NOTES: moderation rules and at-least-once alerts).
- After CI is green, merge, and deploy-pages runs.
- Telegram webviews may keep an old cached bundle. An old bundle still works: the server enforces everything and the new error messages are shown through the existing ErrorNote paths.

**Step 5: production acceptance** (owner plus a second test account)
1. Complaint latency: the second account files a complaint on the owner's test open meeting. The owner receives «Новая жалоба» in @flocklyappbot within 60 s, and «Открыть жалобы» opens /admin/moderation.
2. Restriction: «Ограничить пользователя», then the second account tries «Открытая встреча» and gets ACCOUNT_RESTRICTED; a private meeting still works; a join request also returns ACCOUNT_RESTRICTED.
3. Unrestrict and hide/unhide round-trips.
4. The third open meeting within an hour returns 429 with the limit text.
5. Clean up the test data through the admin UI: unhide and unrestrict. No manual deletes.

**Rollback**
- The Edge Functions can be rolled back alone; the new DB stays compatible, and only token mapping degrades to 500.
- The frontend can be rolled back alone.
- In the DB, `create or replace` the previous bodies (kept in git) or set the limits very high with an UPDATE migration. Nothing is ever dropped.

## tests
**Vitest (CI frontend job)**

1. **`tests/moderation-migrations.test.ts`**
   - Every new table has `enable row level security` and `revoke all privileges ... from public, anon, authenticated`.
   - No `grant ... to service_role` on the moderation tables, and no db.from('complaints' | 'user_blocks' | 'user_restrictions' | 'user_action_log' | 'moderation_outbox' | 'moderation_actions' | 'community_rules_acceptances') in supabase/functions. Access is RPC-only.
   - The user_action_limits seed equals the TZ values exactly (2/5, 10/30, 10/30, 20/50, 5/10).
   - The complaint_reasons seed matches COMPLAINT_REASONS in the frontend and in `_shared/moderation.ts`.
   - Internal helpers (consume_user_action_quota, resolve_moderation_target, apply_event_hidden, apply_user_restriction) have `revoke ... from service_role` and no `grant execute ... to service_role`. Every public RPC has the grant.
   - Replaced functions keep their exact signatures; revoke lines match the old argument lists.
   - In create_join_request and the two propose functions, `consume_user_action_quota` appears after `for update`.
   - In create_event_idempotent_categorized, the quota call is inside `if not v_replayed`.
   - list_public_feed and public_event_discoverable contain `moderation_hidden_at is null`, `user_restrictions` and `user_blocks` (in both directions).
   - user_restrictions, user_blocks and complaints have no DELETE anywhere.
   - The existing notifications.test.ts rules (no drop, no raise+delete, at most one delete per body, definer count) apply automatically because the files are named ≥ 2026101313.
2. **`tests/rate-limits.test.ts`**
   - parseRateLimitDetail: valid input, malformed input and unknown actions.
   - rateLimitMessage for each action and window: «через минуту» for ≤60 s, `ceil` minutes below 1 h, hours above.
   - eventCreationHttpError, createJoinRequestHttpError, participantOptionProposalHttpError and moderationHttpError each map RATE_LIMIT_EXCEEDED to 429 with its code and ACCOUNT_RESTRICTED to 403 with its code, never to 500.
   - The code appears in both SAFE_APPLICATION_ERROR_CODES and SAFE_API_ERROR_CODES.
3. **`tests/moderation-api.test.ts`**
   - parseComplaintRequest and parseBlockRequest: target, targetId rules, reason whitelist, comment trimming and 500-character limit, 'other' needs a comment.
   - Source checks on telegram-api:
     - allowedMethods lists every new route;
     - admin routes gate on isAdminTelegramId and return 'Маршрут не найден.' 404;
     - the feed uses rpc('list_public_feed') and no longer uses db.from('events') with visibility 'public';
     - the preview calls public_event_discoverable;
     - organizerJoinRequests calls list_pending_join_requests;
     - createComplaint passes p_alert_chat_ids from adminIds;
     - admin RPCs pass p_protected_telegram_ids.
   - The block-list label never uses the name fields for the 'organizer' source.
4. **`tests/moderation-messages.test.ts`**
   - renderModerationMessage for each of the three kinds: neutral text, «title», the comment included and cut to length, no parse_mode in the worker's sendMessage.
   - moderationDeepLink ends with ?startapp=mod. parseStartParam('mod') returns {type: 'moderation'}, while 'mod_x' still throws. startParamSource('mod') returns 'moderation'.
   - The worker calls processModerationBatch before processPersonalBatch, and a stale row completes with 'skip'.
   - The existing NotificationKind list and test are unchanged.
5. **Frontend source and UI tests** (through tests/app-source.ts and readFileSync)
   - PublicMeetings contains CommunityRulesDialog and «Понятно».
   - PublicPreviewScreen contains «Пожаловаться на встречу» and «Не показывать встречи организатора».
   - Manage contains participant-moderation-actions only in the Manage slice, not in ParticipantEvent.
   - OrganizerJoinRequests has .join-request-moderation and still no error.message, requesterUserId or telegramUserId.
   - theme-sunset's opaque rule lists report-dialog and community-rules-dialog.
   - Block buttons use quiet-danger-action (action-styles test).
   - App routes /admin/moderation only with auth.isAdmin.
   - The public-feed-ui test still forbids owner fields.
   - The event-payload-privacy test is unchanged.
   - organizer-join-request-mock and api tests are updated for the RPC-based list.

**SQL scenarios** (new `tests/sql/stage-2-4.sql` and `scripts/sql-scenarios.sh`)
Postgres 16 with Supabase stubs (auth, vault, cron.schedule, net.http_post, the roles anon, authenticated and service_role). All migrations are applied in order. Proposed as a new CI job `sql` with `services: postgres:16`, so "limits covered by tests" is enforced on every PR.

1. **Windows.**
   - Public create ×2 succeeds; the 3rd fails with detail 'open_meeting_create:hour:2:N'.
   - Backdating the rows 61 minutes allows another; backdated rows also reach the daily 5 → 'open_meeting_create:day:5:N'.
   - The any-meeting limit at 10/hour includes open meetings; a private create after the open limit still succeeds.
2. **Idempotency.**
   - The same key twice gives one ledger row and a replay. After the limit is reached, a replay of an old key still returns replayed=true.
   - Invalid input or category, and a hash conflict, consume nothing and leave no key.
3. **Join requests.**
   - created_pending consumes; existing_pending and already_participant do not.
   - The 11th distinct request in an hour fails.
   - Leaving and re-requesting is counted.
4. **Proposals.** Time and place share 20/50. The organizer's add_event_time_option is not limited.
5. **Complaints.**
   - 5/hour and 10/day.
   - A duplicate target returns 'existing' with no new ledger row and no new outbox row.
   - Complaints about the same user from two meetings collapse to one.
   - The resolver rules hold: a non-owner targeting a participant gets NOT_EVENT_OWNER; self gets MODERATION_TARGET_SELF; a private meeting gets MODERATION_TARGET_UNAVAILABLE.
6. **Parallel runs**, made deterministic with a gate: the main session holds pg_advisory_lock(4242) while N `psql` workers each run `begin; set role service_role; select pg_advisory_xact_lock_shared(4242); select <rpc>; commit;`; the main session then releases the lock.
   - 20 public creates from one user: exactly 2 succeed and 18 fail with RATE_LIMIT_EXCEEDED. The ledger has 2+2 rows and there are 2 events.
   - 20 identical complaints: 1 complaint, 1 ledger row, 1 outbox row per admin.
   - 15 join requests to 15 meetings: exactly 10 succeed.
   - 30 proposals in one meeting: exactly 20 succeed.
   - Restriction racing a public create: never a public event whose creation commits after the restriction commits.
   - Joining and complaining on the same event from one user in parallel: no deadlock (40P01 never appears).
7. **Restriction.**
   - A public create and a join request fail with ACCOUNT_RESTRICTED; a private create succeeds.
   - The user's meetings disappear from list_public_feed and public_event_discoverable; their pending requests disappear from list_pending_join_requests; their queued join_request_new rows become skipped.
   - Unrestricting restores everything.
   - A protected telegram id gives MODERATION_TARGET_PROTECTED.
8. **Blocks.**
   - Both directions are hidden in the feed and preview, and join requests are refused with JOIN_REQUEST_NOT_ALLOWED.
   - A pending request is hidden from the blocker.
   - Unblock restores everything; re-blocking reuses the same row.
   - list_user_blocks returns NULL names for organizer blocks.
9. **Hide.**
   - Excluded from the feed and preview; joins are refused.
   - A participant can still save a response and propose; the owner payload carries moderationHidden.
   - Open complaints on the event become actioned; event_hidden is queued; after unhide the claim marks it stale.
10. **Outbox.**
    - next_attempt_at ≤ now() at insert; claim returns the rows.
    - A resolved complaint yields stale=true.
    - complete handles sent, retry (backoff), blocked (skipped) and the fail-after-5 case.
    - The purges delete only old rows.
11. **Privileges.**
    - As anon or authenticated, every new table and function returns permission denied.
    - As service_role, there is no SELECT on the new tables and no EXECUTE on the internal helpers; the public RPCs are allowed.
    - After M4, service_role cannot execute create_event_atomic or create_event_idempotent.
12. **Audit.** Every admin action writes a moderation_actions row with the actor.

**E2E** (Playwright, mock mode)
- Update the two existing tests that visit '#/open' so they click «Понятно» first.
- New tests:
  - Rules: shown once on /open, not shown again after a reload, and also shown on the preview before a join request.
  - Complaint from the preview: report a meeting, see the success text; a second attempt shows «Вы уже отправляли жалобу на это.»
  - Organizer in '#/manage/evt_demo': blocks a join requester, the card disappears; Home → «Заблокированные» lists them; «Разблокировать» removes them.
  - Admin: Home → «Модерация» → complaint card → «Скрыть встречу» → «Меры» lists it → «Вернуть в ленту».
  - Rate limit: the mocked 11th join request shows the 429 message.

## risks
1. **Connector hangs.**
   - Risk: any DROP; a body with RAISE and DELETE; a body with two DELETEs.
   - Mitigation:
     - a new chat-id outbox and lookup tables instead of altering notification_outbox_kind_check or analytics_events_name_check;
     - soft states (revoked_at, lifted_at, moderation_hidden_at, status) instead of deletes;
     - only two single-DELETE SQL purge functions;
     - small migrations;
     - no "raise" or "delete from" in comments, because the test splits on `$$;` and comments count toward the next body.
   - `alter table ... add constraint` was never confirmed safe or unsafe on the connector; only the late FK uses it, and it can be folded into the CREATE TABLE if it hangs.
2. **Signature drift.**
   - Risk: if a replaced RPC (create_join_request, propose_*, *_categorized) changes even one argument type, Postgres creates a new overload. The old unlimited overload then stays callable and cannot be dropped.
   - Mitigation: a test compares the signatures, and M4 revokes the legacy creation RPCs.
3. **Default EXECUTE privileges.**
   - Risk: Supabase may grant EXECUTE on new functions to service_role by default. Internal helpers then need an explicit revoke from service_role, and without it the Edge Function could write ledger rows or skip checks.
   - Mitigation: verify production with has_function_privilege; the connector failed to connect in this session, so production state, function versions and migrations are unverified.
4. **Deploy ordering.**
   - Risk: Pages and functions deploy in parallel on merge.
   - Mitigation: the two-PR release. In the minutes between M2 and the PR-1 deploy, hitting a limit shows a generic 500 instead of the limit text.
5. **Admin alerts depend on the bot and env.**
   - Risk: the admin must have started @flocklyappbot, and TELEGRAM_ADMIN_IDS must hold the right ids. A 403 is skipped silently.
   - Mitigation: the moderationAlertsUndelivered7d counter and a test complaint at acceptance.
   - Delivery is at least once, so duplicate alerts are possible.
   - Many accounts complaining could flood the sole moderator. Per-reporter limits cap each account; a per-target digest can be added later as a new lookup kind.
6. **Trust boundary.**
   - Admin identity is checked only in the Edge Function, as admin_stats does today. The DB trusts service_role for p_admin_user_id, p_alert_chat_ids and p_protected_telegram_ids.
   - A leaked service key would bypass moderation. That is already true for all data.
7. **Block race.** A block committing concurrently with the blocked user's join request can let through one join_request_new notification. The request itself is hidden at read time. Documented, not serialised.
8. **Feed moved to an RPC.**
   - Risks: regressions in keyset pagination, ilike escaping (the default backslash escape must match titleSearchPattern) and query plans.
   - Mitigation: reuse the same partial indexes, add indexed anti-joins, and mirror the existing public-feed tests.
   - Page sizes stay correct because filtering happens before LIMIT.
9. **Privacy.**
   - The organizer's identity is hidden in the feed and preview, so the block list labels organizer blocks by meeting title, enforced in SQL.
   - Complaint alerts and the admin screen expose reporter identities to the admin only.
   - Comments are plain text: no parse_mode, at most 500 characters, control characters stripped.
10. **Abuse of complaints.** Nothing happens automatically on a complaint; only the admin acts. Restricting someone who keeps creating new Telegram accounts is out of scope; the limits slow it down.
11. **Window semantics.** now() is the transaction start, and the per-user advisory lock serialises one user's limited actions (negligible at this scale). Hash collisions only add serialisation. A limit lowered below current usage is handled by the retry calculation.
12. **Rules acceptance is a UX gate, not a security boundary.** Enforcement relies on limits, blocks and restrictions. Stale cached bundles never see the dialog but are still fully enforced server-side.
13. **Hidden and restricted meetings stay usable by members.** Existing pending requests to a restricted owner's meeting can still be approved by that owner. The admin can additionally hide the meeting.
14. **Scope and context size.** This is a large multi-file stage. Recommended model: Opus/high. Use a new chat at about 50–60% context, with the «Статус» section in TZ.md updated between PR-1 and PR-2.