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

create or replace function public.create_event_idempotent(
  p_client_request_id uuid,
  p_request_hash text,
  p_event_id text,
  p_actor_user_id uuid,
  p_admin_token text,
  p_title text,
  p_description text,
  p_budget_limit integer,
  p_visibility text,
  p_max_participants integer,
  p_time_options jsonb,
  p_place_options jsonb
)
returns table (event_id text, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_id text := btrim(coalesce(p_event_id, ''));
  v_claimed_event_id text;
  v_existing_event_id text;
  v_existing_hash text;
begin
  if p_client_request_id is null
    or p_request_hash is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or v_event_id = '' then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_INPUT_INVALID';
  end if;

  -- Claim the key first. A concurrent caller with the same key blocks on the
  -- primary key until this transaction ends, then falls through to the replay
  -- branch (commit) or claims the key itself (rollback).
  insert into public.event_creation_requests (
    owner_user_id,
    client_request_id,
    request_hash,
    event_id
  )
  values (
    p_actor_user_id,
    p_client_request_id,
    p_request_hash,
    v_event_id
  )
  on conflict on constraint event_creation_requests_pkey do nothing
  returning event_creation_requests.event_id into v_claimed_event_id;

  if v_claimed_event_id is null then
    select request.event_id, request.request_hash
    into v_existing_event_id, v_existing_hash
    from public.event_creation_requests as request
    where request.owner_user_id = p_actor_user_id
      and request.client_request_id = p_client_request_id;

    if v_existing_event_id is null then
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_INPUT_INVALID';
    end if;

    if v_existing_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_IDEMPOTENCY_CONFLICT';
    end if;

    return query select v_existing_event_id, true;
    return;
  end if;

  perform 1
  from public.create_event_atomic(
    v_event_id,
    p_actor_user_id,
    p_admin_token,
    p_title,
    p_description,
    p_budget_limit,
    p_visibility,
    p_max_participants,
    p_time_options,
    p_place_options
  );

  return query select v_event_id, false;
end;
$$;

revoke all on function public.create_event_idempotent(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb) from public;
revoke all on function public.create_event_idempotent(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb) from anon;
revoke all on function public.create_event_idempotent(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb) from authenticated;
grant execute on function public.create_event_idempotent(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb)
  to service_role;

create or replace function public.purge_event_creation_requests()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  delete from public.event_creation_requests
  where created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_event_creation_requests() from public;
revoke all on function public.purge_event_creation_requests() from anon;
revoke all on function public.purge_event_creation_requests() from authenticated;

select cron.schedule(
  'purge-event-creation-requests-daily',
  '17 3 * * *',
  'SELECT public.purge_event_creation_requests();'
);
