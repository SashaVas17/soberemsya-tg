-- Bot notifications: per-user preferences, a transactional outbox filled by
-- triggers and a scheduler, and per-event summary state. Delivery is
-- at-least-once: a crash between Telegram sendMessage and the status update
-- can repeat a message; dedupe_key prevents duplicates in normal operation.

alter table public.users add column if not exists can_message boolean;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  response_mode text not null default 'summary'
    check (response_mode in ('summary', 'each', 'off')),
  reminder_24h boolean not null default true,
  reminder_2h boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  event_id text references public.events(id) on delete cascade,
  kind text not null check (kind in (
    'response_each', 'response_summary', 'join_request_new',
    'join_request_approved', 'join_request_rejected', 'event_decided',
    'event_cancelled', 'event_updated', 'event_reopened', 'reminder_24h', 'reminder_2h'
  )),
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists notification_outbox_due_idx
  on public.notification_outbox (next_attempt_at, id)
  where status in ('pending', 'sending');

create index if not exists notification_outbox_created_idx
  on public.notification_outbox (created_at);

create table if not exists public.event_notification_state (
  event_id text primary key references public.events(id) on delete cascade,
  last_summary_at timestamptz,
  last_summary_participants integer not null default 0
);

alter table public.notification_preferences enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.event_notification_state enable row level security;

revoke all privileges on table public.notification_preferences from public, anon, authenticated;
revoke all privileges on table public.notification_outbox from public, anon, authenticated;
revoke all privileges on table public.event_notification_state from public, anon, authenticated;
grant select, insert, update on table public.notification_preferences to service_role;
grant select on table public.notification_outbox to service_role;

-- Inserts one notification unless the same dedupe key was already queued.
create or replace function public.enqueue_notification(
  p_user_id uuid, p_event_id text, p_kind text, p_dedupe_key text,
  p_payload jsonb, p_delay interval default interval '0'
)
returns void
language sql security definer set search_path = pg_catalog, public
as $$
  insert into public.notification_outbox (user_id, event_id, kind, dedupe_key, payload, next_attempt_at)
  select p_user_id, p_event_id, p_kind, p_dedupe_key, coalesce(p_payload, '{}'::jsonb), now() + p_delay
  where p_user_id is not null
  on conflict (dedupe_key) do nothing;
$$;

create or replace function public.notification_response_mode(p_user_id uuid)
returns text
language sql stable security definer set search_path = pg_catalog, public
as $$
  select coalesce(
    (select pref.response_mode from public.notification_preferences pref where pref.user_id = p_user_id),
    'summary'
  );
$$;

-- People who actually answered: non-organizer participants with votes.
-- Approving a join request adds a participant before they answer.
create or replace function public.event_answered_count(p_event_id text, p_owner_user_id uuid)
returns integer
language sql stable security definer set search_path = pg_catalog, public
as $$
  select count(*)::integer from public.participants participant
  where participant.event_id = p_event_id
    and participant.user_id is distinct from p_owner_user_id
    and exists (select 1 from public.availability_votes vote where vote.participant_id = participant.id);
$$;

revoke all on function public.enqueue_notification(uuid, text, text, text, jsonb, interval) from public, anon, authenticated;
revoke all on function public.event_answered_count(text, uuid) from public, anon, authenticated;
revoke all on function public.notification_response_mode(uuid) from public, anon, authenticated;
