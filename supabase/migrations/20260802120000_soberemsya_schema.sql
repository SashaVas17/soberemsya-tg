create table if not exists public.events (
  id text primary key,
  admin_token text not null unique,
  owner_id uuid references auth.users(id) on delete set null,
  claim_token_hash text,
  title text not null,
  description text not null default '',
  budget_limit integer not null default 0 check (budget_limit >= 0),
  status text not null default 'collecting' check (status in ('collecting', 'place_selection', 'decided', 'cancelled')),
  final_place_id text,
  final_time_option_id text,
  created_at timestamptz not null default now()
);
create index if not exists events_owner_id_idx on public.events(owner_id);
create table if not exists public.time_options (id text primary key, event_id text not null references public.events(id) on delete cascade, starts_at timestamptz not null);
create index if not exists time_options_event_starts_idx on public.time_options(event_id, starts_at);
create table if not exists public.place_options (id text primary key, event_id text not null references public.events(id) on delete cascade, title text not null, area text not null default '', estimated_budget integer not null default 0 check (estimated_budget >= 0));
create index if not exists place_options_event_idx on public.place_options(event_id);
create table if not exists public.participants (id uuid primary key, event_id text not null references public.events(id) on delete cascade, edit_token uuid not null unique, name text not null, area text not null default '', budget integer not null default 0 check (budget >= 0), preferences text not null default '', restrictions text not null default '', created_at timestamptz not null default now());
create index if not exists participants_event_idx on public.participants(event_id);
create table if not exists public.availability_votes (participant_id uuid not null references public.participants(id) on delete cascade, time_option_id text not null references public.time_options(id) on delete cascade, is_available boolean not null, primary key (participant_id, time_option_id));
create index if not exists availability_votes_time_idx on public.availability_votes(time_option_id);
create table if not exists public.place_votes (participant_id uuid not null references public.participants(id) on delete cascade, place_option_id text not null references public.place_options(id) on delete cascade, primary key (participant_id, place_option_id));
alter table public.events enable row level security;
alter table public.time_options enable row level security;
alter table public.place_options enable row level security;
alter table public.participants enable row level security;
alter table public.availability_votes enable row level security;
alter table public.place_votes enable row level security;
