-- Stage 2.4: safety of open meetings. Administrator bans and hidden meetings,
-- per-user rate limits, user-to-user blocks, reports that reach the
-- administrator through the notification outbox, and acceptance of the
-- community rules. Shipped as one release; the Edge Function checks that the
-- caller is an administrator (TELEGRAM_ADMIN_IDS) before the admin RPCs.

alter table public.users
  add column if not exists banned_at timestamptz,
  add column if not exists community_rules_accepted_at timestamptz;

-- A hidden meeting leaves the open feed and takes no join requests; its
-- organizer and participants still see it.
alter table public.events
  add column if not exists hidden_at timestamptz;

-- Rate limits ------------------------------------------------------------

-- Limits live in a table so the owner can change them without a release.
create table if not exists public.action_rate_limits (
  action text primary key check (action in (
    'event_create', 'open_event_create', 'join_request', 'option_proposal', 'report'
  )),
  per_hour integer not null check (per_hour > 0),
  per_day integer not null check (per_day > 0),
  updated_at timestamptz not null default now()
);

insert into public.action_rate_limits (action, per_hour, per_day) values
  ('event_create', 10, 30),
  ('open_event_create', 2, 5),
  ('join_request', 10, 30),
  ('option_proposal', 20, 50),
  ('report', 5, 10)
on conflict (action) do nothing;

create table if not exists public.action_rate_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null references public.action_rate_limits(action),
  created_at timestamptz not null default now()
);

create index if not exists action_rate_log_user_action_idx
  on public.action_rate_log (user_id, action, created_at);
create index if not exists action_rate_log_created_idx
  on public.action_rate_log (created_at);

alter table public.action_rate_limits enable row level security;
alter table public.action_rate_log enable row level security;
revoke all privileges on table public.action_rate_limits from public, anon, authenticated;
revoke all privileges on table public.action_rate_log from public, anon, authenticated;

-- Counts the user's actions over the last hour and day and records this one.
-- The advisory lock serializes concurrent calls of one user and action, so
-- parallel requests cannot pass the limit together. Called after the action
-- itself: raising rolls the action back, and failed actions are not counted.
create or replace function public.consume_action_rate_limit(p_user_id uuid, p_action text)
returns void
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_limit public.action_rate_limits%rowtype;
  v_hour integer;
  v_day integer;
begin
  select * into v_limit from public.action_rate_limits l where l.action = p_action;
  if not found or p_user_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rate:' || p_user_id::text || ':' || p_action, 0));
  select count(*) filter (where log.created_at > now() - interval '1 hour'), count(*)
  into v_hour, v_day
  from public.action_rate_log log
  where log.user_id = p_user_id
    and log.action = p_action
    and log.created_at > now() - interval '1 day';
  if v_hour >= v_limit.per_hour or v_day >= v_limit.per_day then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED:' || p_action;
  end if;
  insert into public.action_rate_log (user_id, action) values (p_user_id, p_action);
end;
$$;

-- The log only needs the last day.
create or replace function public.purge_action_rate_log()
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  delete from public.action_rate_log where created_at < now() - interval '2 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Blocks and reports -----------------------------------------------------

create table if not exists public.user_blocks (
  blocker_user_id uuid not null references public.users(id) on delete cascade,
  blocked_user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The open meeting preview hides its organizer, so a block made from it
  -- must not reveal who that is: the list then shows only this label.
  reveal_identity boolean not null default false,
  label text not null default '' check (char_length(label) <= 240),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);

create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_user_id);

alter table public.user_blocks enable row level security;
revoke all privileges on table public.user_blocks from public, anon, authenticated;
-- The open meeting preview checks a block between two people directly.
grant select on table public.user_blocks to service_role;

-- A report is about a meeting (target_user_id is then its organizer) or about
-- a person met through a meeting (event_id is that meeting).
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.users(id) on delete cascade,
  target_type text not null check (target_type in ('event', 'user')),
  event_id text references public.events(id) on delete cascade,
  target_user_id uuid references public.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'fraud', 'offensive', 'dangerous', 'fake', 'other')),
  comment text not null default '' check (char_length(comment) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.users(id) on delete set null,
  check (
    (target_type = 'event' and event_id is not null)
    or (target_type = 'user' and target_user_id is not null)
  )
);

-- One open report per reporter and meeting or person; after the
-- administrator closes it, the same person can report again.
create unique index if not exists reports_reporter_event_open_unique
  on public.reports (reporter_user_id, event_id) where target_type = 'event' and status = 'open';
create unique index if not exists reports_reporter_user_open_unique
  on public.reports (reporter_user_id, target_user_id) where target_type = 'user' and status = 'open';
create index if not exists reports_status_created_idx on public.reports (status, created_at desc);
create index if not exists reports_target_user_idx on public.reports (target_user_id) where status = 'open';
create index if not exists reports_event_idx on public.reports (event_id) where status = 'open';

alter table public.reports enable row level security;
revoke all privileges on table public.reports from public, anon, authenticated;

create or replace function public.users_blocked_between(p_first uuid, p_second uuid)
returns boolean
language sql stable
security definer set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_user_id = p_first and b.blocked_user_id = p_second)
       or (b.blocker_user_id = p_second and b.blocked_user_id = p_first)
  );
$$;

-- Whom a report or block from a meeting is about: the organizer by default,
-- or a participant or join requester, whose identifiers only the organizer
-- sees. The organizer can be targeted by anyone who sees the meeting.
create or replace function public.moderation_target_user(
  p_event_id text, p_actor_user_id uuid, p_participant_id uuid, p_request_id uuid
)
returns uuid
language plpgsql stable
security definer set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_target uuid;
begin
  select * into v_event from public.events e where e.id = p_event_id and e.deleted_at is null;
  if not found or p_actor_user_id is null then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;
  if p_participant_id is not null and p_request_id is not null then
    raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_INVALID';
  end if;
  if p_participant_id is not null or p_request_id is not null then
    if v_event.owner_user_id is distinct from p_actor_user_id then
      raise exception using errcode = 'P0001', message = 'MODERATION_NOT_ALLOWED';
    end if;
    if p_participant_id is not null then
      select p.user_id into v_target from public.participants p
      where p.id = p_participant_id and p.event_id = p_event_id;
    else
      select r.requester_user_id into v_target from public.join_requests r
      where r.id = p_request_id and r.event_id = p_event_id;
    end if;
  else
    if v_event.visibility <> 'public' and not exists (
      select 1 from public.participants p
      where p.event_id = p_event_id and p.user_id = p_actor_user_id
    ) then
      raise exception using errcode = 'P0001', message = 'MODERATION_NOT_ALLOWED';
    end if;
    v_target := v_event.owner_user_id;
  end if;
  if v_target is null then
    raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_UNAVAILABLE';
  end if;
  if v_target = p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_SELF';
  end if;
  return v_target;
end;
$$;

-- Reports a meeting (no participant or request) or a person. A repeated
-- report returns the first one and does not count against the limit. The
-- administrators (telegram ids from TELEGRAM_ADMIN_IDS) get a bot message.
create or replace function public.create_report(
  p_actor_user_id uuid, p_event_id text, p_participant_id uuid, p_request_id uuid,
  p_reason text, p_comment text, p_admin_telegram_ids bigint[]
)
returns table (report_id uuid, outcome text)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_target uuid;
  v_type text;
  v_report_id uuid;
  v_created boolean;
  v_comment text := btrim(coalesce(p_comment, ''));
  v_title text;
  v_target_name text;
begin
  if p_reason is null or p_reason not in ('spam', 'fraud', 'offensive', 'dangerous', 'fake', 'other')
    or char_length(v_comment) > 500 then
    raise exception using errcode = 'P0001', message = 'REPORT_INVALID';
  end if;
  v_target := public.moderation_target_user(p_event_id, p_actor_user_id, p_participant_id, p_request_id);
  v_type := case when p_participant_id is null and p_request_id is null then 'event' else 'user' end;

  if v_type = 'event' then
    insert into public.reports (reporter_user_id, target_type, event_id, target_user_id, reason, comment)
    values (p_actor_user_id, 'event', p_event_id, v_target, p_reason, v_comment)
    on conflict (reporter_user_id, event_id) where target_type = 'event' and status = 'open' do nothing
    returning id into v_report_id;
    v_created := v_report_id is not null;
    if not v_created then
      select r.id into v_report_id from public.reports r
      where r.reporter_user_id = p_actor_user_id and r.target_type = 'event' and r.event_id = p_event_id
        and r.status = 'open';
    end if;
  else
    insert into public.reports (reporter_user_id, target_type, event_id, target_user_id, reason, comment)
    values (p_actor_user_id, 'user', p_event_id, v_target, p_reason, v_comment)
    on conflict (reporter_user_id, target_user_id) where target_type = 'user' and status = 'open' do nothing
    returning id into v_report_id;
    v_created := v_report_id is not null;
    if not v_created then
      select r.id into v_report_id from public.reports r
      where r.reporter_user_id = p_actor_user_id and r.target_type = 'user' and r.target_user_id = v_target
        and r.status = 'open';
    end if;
  end if;

  if not v_created then
    return query select v_report_id, 'existing'::text;
    return;
  end if;

  perform public.consume_action_rate_limit(p_actor_user_id, 'report');

  select e.title into v_title from public.events e where e.id = p_event_id;
  select nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), '') into v_target_name
  from public.users u where u.id = v_target;
  perform public.enqueue_notification(
    admin.id, null, 'report_new', 'report:' || v_report_id::text || ':' || admin.id::text,
    jsonb_build_object('targetType', v_type, 'title', v_title, 'reason', p_reason,
      'targetName', coalesce(v_target_name, 'Пользователь Telegram'))
  )
  from public.users admin
  where admin.telegram_user_id = any(coalesce(p_admin_telegram_ids, '{}'::bigint[]));

  return query select v_report_id, 'created'::text;
end;
$$;

-- Blocks the organizer of a meeting, or a participant or requester of the
-- actor's meeting. Pending join requests between the two, either way, are
-- rejected.
create or replace function public.block_user(
  p_actor_user_id uuid, p_event_id text, p_participant_id uuid, p_request_id uuid
)
returns table (blocked_user_id uuid, outcome text)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_target uuid;
  v_existing boolean;
  v_reveal boolean := p_participant_id is not null or p_request_id is not null;
  v_title text;
begin
  v_target := public.moderation_target_user(p_event_id, p_actor_user_id, p_participant_id, p_request_id);
  select e.title into v_title from public.events e where e.id = p_event_id;
  -- Serializes one user's blocks so the cap below holds under concurrency.
  perform pg_advisory_xact_lock(hashtextextended('blocks:' || p_actor_user_id::text, 0));
  v_existing := exists (
    select 1 from public.user_blocks b
    where b.blocker_user_id = p_actor_user_id and b.blocked_user_id = v_target
  );
  if not v_existing and (
    select count(*) from public.user_blocks b where b.blocker_user_id = p_actor_user_id
  ) >= 200 then
    raise exception using errcode = 'P0001', message = 'BLOCK_LIMIT_REACHED';
  end if;
  -- Only the organizer blocking a participant or requester already sees their
  -- name; anyone else gets the meeting title instead.
  insert into public.user_blocks as b (blocker_user_id, blocked_user_id, reveal_identity, label)
  values (p_actor_user_id, v_target, v_reveal,
    left(case when v_reveal then '' else 'Организатор встречи «' || coalesce(v_title, '') || '»' end, 240))
  on conflict on constraint user_blocks_pkey do update
  set reveal_identity = b.reveal_identity or excluded.reveal_identity;
  update public.join_requests r
  set status = 'rejected', decided_at = now(), decided_by_user_id = p_actor_user_id
  where r.status = 'pending'
    and (
      (r.requester_user_id = v_target and r.event_id in (
        select e.id from public.events e where e.owner_user_id = p_actor_user_id))
      or (r.requester_user_id = p_actor_user_id and r.event_id in (
        select e.id from public.events e where e.owner_user_id = v_target))
    );
  return query select v_target, case when v_existing then 'existing' else 'created' end;
end;
$$;

create or replace function public.unblock_user(p_actor_user_id uuid, p_blocked_user_id uuid)
returns boolean
language sql
security definer set search_path = pg_catalog, public
as $$
  with removed as (
    delete from public.user_blocks b
    where b.blocker_user_id = p_actor_user_id and b.blocked_user_id = p_blocked_user_id
    returning 1
  )
  select exists (select 1 from removed);
$$;

-- Names and usernames only where the blocker saw them before the block.
create or replace function public.list_user_blocks(p_actor_user_id uuid)
returns table (user_id uuid, first_name text, last_name text, username text, label text, created_at timestamptz)
language sql stable
security definer set search_path = pg_catalog, public
as $$
  select u.id,
    case when b.reveal_identity then u.first_name end,
    case when b.reveal_identity then u.last_name end,
    case when b.reveal_identity then u.username end,
    b.label, b.created_at
  from public.user_blocks b
  join public.users u on u.id = b.blocked_user_id
  where b.blocker_user_id = p_actor_user_id
  order by b.created_at desc;
$$;

create or replace function public.accept_community_rules(p_user_id uuid)
returns timestamptz
language sql
security definer set search_path = pg_catalog, public
as $$
  update public.users
  set community_rules_accepted_at = coalesce(community_rules_accepted_at, now())
  where id = p_user_id
  returning community_rules_accepted_at;
$$;

-- Moderated actions ------------------------------------------------------

-- The categorized creation wrappers now also enforce bans (open meetings
-- only) and rate limits. A replay of an idempotent create is not counted.
create or replace function public.create_event_categorized(
  p_event_id text, p_actor_user_id uuid, p_admin_token text, p_title text,
  p_description text, p_budget_limit integer, p_visibility text,
  p_max_participants integer, p_time_options jsonb, p_place_options jsonb,
  p_category_id text
)
returns table (event_id text)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
begin
  if p_category_id is not null and not exists (
    select 1 from public.meeting_categories c where c.id = p_category_id and c.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_CATEGORY_INVALID';
  end if;
  if p_visibility = 'public' and exists (
    select 1 from public.users u where u.id = p_actor_user_id and u.banned_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'USER_RESTRICTED';
  end if;
  perform 1 from public.create_event_atomic(p_event_id, p_actor_user_id, p_admin_token,
    p_title, p_description, p_budget_limit, p_visibility, p_max_participants,
    p_time_options, p_place_options);
  if p_category_id is not null then
    update public.events e set category_id = p_category_id where e.id = p_event_id;
  end if;
  perform public.consume_action_rate_limit(p_actor_user_id, 'event_create');
  if p_visibility = 'public' then
    perform public.consume_action_rate_limit(p_actor_user_id, 'open_event_create');
  end if;
  return query select p_event_id;
end;
$$;

create or replace function public.create_event_idempotent_categorized(
  p_client_request_id uuid, p_request_hash text, p_event_id text, p_actor_user_id uuid,
  p_admin_token text, p_title text, p_description text, p_budget_limit integer,
  p_visibility text, p_max_participants integer, p_time_options jsonb, p_place_options jsonb,
  p_category_id text
)
returns table (event_id text, replayed boolean)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_event_id text;
  v_replayed boolean;
begin
  select r.event_id, r.replayed into v_event_id, v_replayed
  from public.create_event_idempotent(p_client_request_id, p_request_hash, p_event_id,
    p_actor_user_id, p_admin_token, p_title, p_description, p_budget_limit, p_visibility,
    p_max_participants, p_time_options, p_place_options) r;
  if not v_replayed then
    if p_category_id is not null then
      if not exists (
        select 1 from public.meeting_categories c where c.id = p_category_id and c.is_active
      ) then
        -- Rolls back the meeting and the key claim made above.
        raise exception using errcode = 'P0001', message = 'CREATE_EVENT_CATEGORY_INVALID';
      end if;
      update public.events e set category_id = p_category_id where e.id = v_event_id;
    end if;
    if p_visibility = 'public' and exists (
      select 1 from public.users u where u.id = p_actor_user_id and u.banned_at is not null
    ) then
      raise exception using errcode = 'P0001', message = 'USER_RESTRICTED';
    end if;
    perform public.consume_action_rate_limit(p_actor_user_id, 'event_create');
    if p_visibility = 'public' then
      perform public.consume_action_rate_limit(p_actor_user_id, 'open_event_create');
    end if;
  end if;
  return query select v_event_id, v_replayed;
end;
$$;

-- A join request that also checks bans, hidden meetings and blocks, and
-- counts new requests against the limit. Blocks answer like an unavailable
-- meeting, so the blocked person does not learn about the block. A person
-- who already takes part or waits for a decision gets the usual idempotent
-- answer.
create or replace function public.create_join_request_moderated(
  p_event_id text, p_requester_user_id uuid
)
returns table (request_id uuid, status text, outcome text)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_request_id uuid;
  v_status text;
  v_outcome text;
begin
  select * into v_event from public.events e where e.id = p_event_id and e.deleted_at is null;
  if found and p_requester_user_id is not null
    and p_requester_user_id is distinct from v_event.owner_user_id
    and not exists (
      select 1 from public.participants p
      where p.event_id = p_event_id and p.user_id = p_requester_user_id
    )
    and not exists (
      select 1 from public.join_requests r
      where r.event_id = p_event_id and r.requester_user_id = p_requester_user_id
        and r.status = 'pending'
    ) then
    if exists (
      select 1 from public.users u where u.id = p_requester_user_id and u.banned_at is not null
    ) then
      raise exception using errcode = 'P0001', message = 'USER_RESTRICTED';
    end if;
    if v_event.hidden_at is not null
      or public.users_blocked_between(p_requester_user_id, v_event.owner_user_id)
      or exists (
        select 1 from public.users u where u.id = v_event.owner_user_id and u.banned_at is not null
      ) then
      raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
    end if;
  end if;
  select r.request_id, r.status, r.outcome into v_request_id, v_status, v_outcome
  from public.create_join_request(p_event_id, p_requester_user_id) r;
  if v_outcome = 'created_pending' then
    perform public.consume_action_rate_limit(p_requester_user_id, 'join_request');
  end if;
  return query select v_request_id, v_status, v_outcome;
end;
$$;

create or replace function public.propose_event_time_option_limited(
  p_event_id text, p_actor_user_id uuid, p_option_id text, p_starts_at timestamptz
)
returns table (option_id text)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_option_id text;
begin
  select r.option_id into v_option_id
  from public.propose_event_time_option(p_event_id, p_actor_user_id, p_option_id, p_starts_at) r;
  perform public.consume_action_rate_limit(p_actor_user_id, 'option_proposal');
  return query select v_option_id;
end;
$$;

create or replace function public.propose_event_place_option_limited(
  p_event_id text, p_actor_user_id uuid, p_option_id text, p_title text, p_area text,
  p_estimated_budget integer
)
returns table (option_id text)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_option_id text;
begin
  select r.option_id into v_option_id
  from public.propose_event_place_option(p_event_id, p_actor_user_id, p_option_id, p_title,
    p_area, p_estimated_budget) r;
  perform public.consume_action_rate_limit(p_actor_user_id, 'option_proposal');
  return query select v_option_id;
end;
$$;

-- One page of the open meetings feed for a viewer: the city's public
-- meetings that collect answers, without hidden ones and without those of
-- people blocked either way. Keyset pagination by (created_at, id).
create or replace function public.public_feed_page(
  p_viewer_user_id uuid, p_city_id text, p_category_id text, p_title_pattern text,
  p_cursor_created_at timestamptz, p_cursor_id text, p_limit integer
)
returns table (
  id text, owner_user_id uuid, title text, description text, budget_limit integer,
  max_participants integer, status text, created_at timestamptz, category_id text
)
language sql stable
security definer set search_path = pg_catalog, public
as $$
  select e.id, e.owner_user_id, e.title, e.description, e.budget_limit,
    e.max_participants, e.status, e.created_at, e.category_id
  from public.events e
  where e.city_id = p_city_id
    and e.visibility = 'public'
    and e.deleted_at is null
    and e.hidden_at is null
    and e.status = 'collecting'
    and (p_category_id is null or e.category_id = p_category_id)
    and (p_title_pattern is null or e.title ilike p_title_pattern)
    and (p_cursor_created_at is null
      or e.created_at < p_cursor_created_at
      or (e.created_at = p_cursor_created_at and e.id < p_cursor_id))
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_user_id = p_viewer_user_id and b.blocked_user_id = e.owner_user_id)
         or (b.blocker_user_id = e.owner_user_id and b.blocked_user_id = p_viewer_user_id)
    )
  order by e.created_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 101);
$$;

-- Administrator tools ----------------------------------------------------

create or replace function public.admin_reports(p_status text, p_limit integer)
returns jsonb
language sql stable
security definer set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(item.value order by item.created_at desc), '[]'::jsonb)
  from (
    select r.created_at, jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'targetType', r.target_type,
      'reason', r.reason,
      'comment', r.comment,
      'createdAt', r.created_at,
      'resolvedAt', r.resolved_at,
      'reporter', jsonb_build_object(
        'name', nullif(btrim(concat_ws(' ', reporter.first_name, reporter.last_name)), ''),
        'username', reporter.username),
      'event', case when e.id is null then null else jsonb_build_object(
        'id', e.id, 'title', e.title, 'status', e.status, 'visibility', e.visibility,
        'hidden', e.hidden_at is not null, 'deleted', e.deleted_at is not null) end,
      'targetUser', case when target.id is null then null else jsonb_build_object(
        'id', target.id,
        'name', nullif(btrim(concat_ws(' ', target.first_name, target.last_name)), ''),
        'username', target.username,
        'banned', target.banned_at is not null) end,
      'openReportsOnTarget', (
        select count(*) from public.reports other
        where other.status = 'open'
          and other.target_type = r.target_type
          and (case when r.target_type = 'event'
                 then other.event_id = r.event_id
                 else other.target_user_id = r.target_user_id end))
    ) as value
    from public.reports r
    left join public.events e on e.id = r.event_id
    left join public.users target on target.id = r.target_user_id
    left join public.users reporter on reporter.id = r.reporter_user_id
    where r.status = case when p_status in ('open', 'resolved', 'dismissed') then p_status else 'open' end
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) item;
$$;

create or replace function public.admin_resolve_report(
  p_admin_user_id uuid, p_report_id uuid, p_status text
)
returns table (status text)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  if p_status not in ('resolved', 'dismissed') then
    raise exception using errcode = 'P0001', message = 'REPORT_INVALID';
  end if;
  update public.reports r
  set status = p_status, resolved_at = now(), resolved_by_user_id = p_admin_user_id
  where r.id = p_report_id and r.status = 'open'
  returning r.status into v_status;
  if v_status is null then
    select r.status into v_status from public.reports r where r.id = p_report_id;
  end if;
  if v_status is null then
    raise exception using errcode = 'P0001', message = 'REPORT_NOT_FOUND';
  end if;
  return query select v_status;
end;
$$;

-- Hiding a meeting resolves the open reports about it.
create or replace function public.admin_set_event_hidden(
  p_admin_user_id uuid, p_event_id text, p_hidden boolean
)
returns table (hidden boolean)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_hidden_at timestamptz;
begin
  update public.events e
  set hidden_at = case when p_hidden then coalesce(e.hidden_at, now()) else null end
  where e.id = p_event_id and e.deleted_at is null
  returning e.hidden_at into v_hidden_at;
  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;
  if p_hidden then
    update public.reports r
    set status = 'resolved', resolved_at = now(), resolved_by_user_id = p_admin_user_id
    where r.status = 'open' and r.target_type = 'event' and r.event_id = p_event_id;
  end if;
  return query select v_hidden_at is not null;
end;
$$;

-- A ban stops the user from creating open meetings and sending join requests,
-- hides all their open meetings (a decided one could be reopened) and
-- resolves the open reports about them. Unbanning does not unhide them.
create or replace function public.admin_set_user_banned(
  p_admin_user_id uuid, p_user_id uuid, p_banned boolean
)
returns table (banned boolean, hidden_events integer)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_banned_at timestamptz;
  v_hidden integer := 0;
begin
  if p_user_id = p_admin_user_id then
    raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_SELF';
  end if;
  update public.users u
  set banned_at = case when p_banned then coalesce(u.banned_at, now()) else null end
  where u.id = p_user_id
  returning u.banned_at into v_banned_at;
  if not found then
    raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_UNAVAILABLE';
  end if;
  if p_banned then
    update public.events e
    set hidden_at = now()
    where e.owner_user_id = p_user_id
      and e.visibility = 'public'
      and e.deleted_at is null
      and e.hidden_at is null;
    get diagnostics v_hidden = row_count;
    update public.reports r
    set status = 'resolved', resolved_at = now(), resolved_by_user_id = p_admin_user_id
    where r.status = 'open' and r.target_user_id = p_user_id;
  end if;
  return query select v_banned_at is not null, v_hidden;
end;
$$;

-- Privileges -------------------------------------------------------------

revoke all on function public.consume_action_rate_limit(uuid, text) from public, anon, authenticated;
revoke all on function public.purge_action_rate_log() from public, anon, authenticated;
revoke all on function public.users_blocked_between(uuid, uuid) from public, anon, authenticated;
revoke all on function public.moderation_target_user(text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_report(uuid, text, uuid, uuid, text, text, bigint[]) from public, anon, authenticated;
revoke all on function public.block_user(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.unblock_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_user_blocks(uuid) from public, anon, authenticated;
revoke all on function public.accept_community_rules(uuid) from public, anon, authenticated;
revoke all on function public.create_join_request_moderated(text, uuid) from public, anon, authenticated;
revoke all on function public.propose_event_time_option_limited(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.propose_event_place_option_limited(text, uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.public_feed_page(uuid, text, text, text, timestamptz, text, integer) from public, anon, authenticated;
revoke all on function public.admin_reports(text, integer) from public, anon, authenticated;
revoke all on function public.admin_resolve_report(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_set_event_hidden(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_set_user_banned(uuid, uuid, boolean) from public, anon, authenticated;

grant execute on function public.purge_action_rate_log() to service_role;
grant execute on function public.create_report(uuid, text, uuid, uuid, text, text, bigint[]) to service_role;
grant execute on function public.block_user(uuid, text, uuid, uuid) to service_role;
grant execute on function public.unblock_user(uuid, uuid) to service_role;
grant execute on function public.list_user_blocks(uuid) to service_role;
grant execute on function public.accept_community_rules(uuid) to service_role;
grant execute on function public.create_join_request_moderated(text, uuid) to service_role;
grant execute on function public.propose_event_time_option_limited(text, uuid, text, timestamptz) to service_role;
grant execute on function public.propose_event_place_option_limited(text, uuid, text, text, text, integer) to service_role;
grant execute on function public.public_feed_page(uuid, text, text, text, timestamptz, text, integer) to service_role;
grant execute on function public.admin_reports(text, integer) to service_role;
grant execute on function public.admin_resolve_report(uuid, uuid, text) to service_role;
grant execute on function public.admin_set_event_hidden(uuid, text, boolean) to service_role;
grant execute on function public.admin_set_user_banned(uuid, uuid, boolean) to service_role;

select cron.schedule(
  'purge-action-rate-log-daily',
  '27 3 * * *',
  'SELECT public.purge_action_rate_log();'
);
