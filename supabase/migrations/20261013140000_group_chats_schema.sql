-- Bot in group chats. /new in a group issues a short-lived link token bound
-- to the member who sent the command, so a forwarded link cannot post into
-- the group. A meeting created through that link is attached to the group,
-- and the bot posts only the meeting card and the final result there.
-- Delivery is at-least-once, like the personal notification outbox.

create table if not exists public.group_links (
  token text primary key,
  chat_id bigint not null,
  chat_title text not null default '',
  issuer_telegram_user_id bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists group_links_expires_idx on public.group_links (expires_at);

-- One group per meeting: the first attachment wins.
create table if not exists public.event_group_chats (
  event_id text primary key references public.events(id) on delete cascade,
  chat_id bigint not null,
  chat_title text not null default '',
  attached_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists event_group_chats_chat_idx on public.event_group_chats (chat_id);

create table if not exists public.group_message_outbox (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  chat_id bigint not null,
  kind text not null check (kind in ('group_card', 'group_decided')),
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

create index if not exists group_message_outbox_due_idx
  on public.group_message_outbox (next_attempt_at, id)
  where status in ('pending', 'sending');

create index if not exists group_message_outbox_created_idx
  on public.group_message_outbox (created_at);

alter table public.group_links enable row level security;
alter table public.event_group_chats enable row level security;
alter table public.group_message_outbox enable row level security;

revoke all privileges on table public.group_links from public, anon, authenticated;
revoke all privileges on table public.event_group_chats from public, anon, authenticated;
revoke all privileges on table public.group_message_outbox from public, anon, authenticated;
