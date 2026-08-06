-- Additive Telegram Mini App identity migration.
-- Existing email owners, admin tokens, and guest participants remain valid data.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint unique not null,
  username text,
  first_name text not null,
  last_name text,
  language_code text,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events
  add column if not exists owner_user_id uuid references public.users(id) on delete set null,
  add column if not exists deleted_at timestamptz;

alter table public.participants
  add column if not exists user_id uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'participants_event_user_unique'
      and conrelid = 'public.participants'::regclass
  ) then
    alter table public.participants
      add constraint participants_event_user_unique unique (event_id, user_id);
  end if;
end $$;

create index if not exists users_telegram_user_id_idx on public.users(telegram_user_id);
create index if not exists events_owner_user_id_created_idx on public.events(owner_user_id, created_at desc) where deleted_at is null;
create index if not exists participants_user_id_event_idx on public.participants(user_id, event_id) where user_id is not null;

alter table public.users enable row level security;
alter table public.events enable row level security;
alter table public.time_options enable row level security;
alter table public.place_options enable row level security;
alter table public.participants enable row level security;
alter table public.availability_votes enable row level security;
alter table public.place_votes enable row level security;

-- The static frontend calls Edge Functions only. No application table is exposed
-- directly to anon/authenticated roles; the function validates Telegram initData
-- before using its server-only secret key.
revoke all on table public.users from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.time_options from anon, authenticated;
revoke all on table public.place_options from anon, authenticated;
revoke all on table public.participants from anon, authenticated;
revoke all on table public.availability_votes from anon, authenticated;
revoke all on table public.place_votes from anon, authenticated;
