-- Lost-response protection for event creation. A client retries POST /events
-- with the same client_request_id; the key and the event are written in one
-- transaction, so a key exists if and only if its event was created.

create table if not exists public.event_creation_requests (
  owner_user_id uuid not null references public.users(id) on delete cascade,
  client_request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  event_id text not null
    references public.events(id) on delete cascade
    deferrable initially deferred,
  created_at timestamptz not null default now(),
  constraint event_creation_requests_pkey
    primary key (owner_user_id, client_request_id)
);

create index if not exists event_creation_requests_created_idx
  on public.event_creation_requests (created_at);

create index if not exists event_creation_requests_event_idx
  on public.event_creation_requests (event_id);

alter table public.event_creation_requests enable row level security;

revoke all privileges on table public.event_creation_requests from public;
revoke all privileges on table public.event_creation_requests from anon;
revoke all privileges on table public.event_creation_requests from authenticated;
grant select, insert, delete on table public.event_creation_requests to service_role;
