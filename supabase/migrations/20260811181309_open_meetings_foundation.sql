-- Open Meetings foundation only. Existing and newly created events remain
-- private until a later API phase explicitly creates public events.
alter table public.events
  add column if not exists visibility text not null default 'private',
  add column if not exists max_participants integer;

update public.events
set visibility = 'private'
where visibility is null;

alter table public.events
  alter column visibility set default 'private',
  alter column visibility set not null;

alter table public.events
  drop constraint if exists events_visibility_check,
  drop constraint if exists events_visibility_max_participants_check,
  add constraint events_visibility_check
    check (visibility in ('private', 'public')),
  add constraint events_visibility_max_participants_check
    check (
      (visibility = 'private' and max_participants is null)
      or (
        visibility = 'public'
        and (
          max_participants is null
          or max_participants between 2 and 50
        )
      )
    );

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  requester_user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_user_id uuid references public.users(id) on delete set null,
  constraint join_requests_event_requester_unique
    unique (event_id, requester_user_id),
  constraint join_requests_status_decision_check
    check (
      (status = 'pending' and decided_at is null and decided_by_user_id is null)
      or (
        status in ('approved', 'rejected')
        and decided_at is not null
      )
    )
);

create index if not exists join_requests_event_pending_idx
  on public.join_requests (event_id, created_at)
  where status = 'pending';

create index if not exists join_requests_requester_created_idx
  on public.join_requests (requester_user_id, created_at desc);

alter table public.join_requests enable row level security;

revoke all privileges on table public.join_requests from public;
revoke all privileges on table public.join_requests from anon;
revoke all privileges on table public.join_requests from authenticated;
grant select, insert, update on table public.join_requests to service_role;

-- OPEN 2 must reject saveResponse for a public event unless the caller is an
-- approved participant. The existing private response flow intentionally stays
-- unchanged until that public API guard is introduced.

create or replace function public.create_join_request(
  p_event_id text,
  p_requester_user_id uuid
)
returns table (request_id uuid, status text, outcome text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_request public.join_requests%rowtype;
  v_request_found boolean;
  v_participant_id uuid;
begin
  select *
  into v_event
  from public.events
  where id = p_event_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;

  if v_event.visibility <> 'public'
    or v_event.owner_user_id is null
    or v_event.status <> 'collecting' then
    raise exception using errcode = 'P0001', message = 'JOIN_REQUEST_NOT_ALLOWED';
  end if;

  if p_requester_user_id is null then
    raise exception using errcode = 'P0001', message = 'REQUESTER_UNAVAILABLE';
  end if;

  if p_requester_user_id = v_event.owner_user_id then
    raise exception using errcode = 'P0001', message = 'OWNER_CANNOT_JOIN';
  end if;

  select *
  into v_request
  from public.join_requests
  where event_id = p_event_id
    and requester_user_id = p_requester_user_id
  for update;
  v_request_found := found;

  select id
  into v_participant_id
  from public.participants
  where event_id = p_event_id
    and user_id = p_requester_user_id;

  if found then
    return query
      select
        case when v_request_found then v_request.id else null::uuid end,
        'approved'::text,
        'already_participant'::text;
    return;
  end if;

  if not v_request_found then
    insert into public.join_requests (event_id, requester_user_id)
    values (p_event_id, p_requester_user_id)
    returning * into v_request;

    return query
      select v_request.id, 'pending'::text, 'created_pending'::text;
    return;
  end if;

  if v_request.status = 'pending' then
    return query
      select v_request.id, 'pending'::text, 'existing_pending'::text;
    return;
  end if;

  if v_request.status = 'rejected' then
    raise exception using errcode = 'P0001', message = 'JOIN_REQUEST_REJECTED';
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'JOIN_REQUEST_STATE_INCONSISTENT';
end;
$$;

create or replace function public.approve_join_request(
  p_event_id text,
  p_request_id uuid,
  p_actor_user_id uuid
)
returns table (request_id uuid, participant_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_request public.join_requests%rowtype;
  v_participant_id uuid;
  v_participant_count integer;
  v_name text;
begin
  select *
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Event not found';
  end if;

  if v_event.owner_user_id is null or v_event.owner_user_id <> p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'Only the event owner can approve requests';
  end if;

  if v_event.visibility <> 'public' or v_event.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'Join requests are unavailable for this event';
  end if;

  if v_event.status <> 'collecting' then
    raise exception using errcode = 'P0001', message = 'Join requests are closed for this event';
  end if;

  select *
  into v_request
  from public.join_requests
  where id = p_request_id
    and event_id = p_event_id
  for update;

  if not found or v_request.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'Pending join request not found';
  end if;

  if v_request.requester_user_id = v_event.owner_user_id then
    raise exception using errcode = 'P0001', message = 'Event owner cannot join their own event';
  end if;

  if exists (
    select 1
    from public.participants
    where event_id = p_event_id
      and user_id = v_request.requester_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'Participant already exists';
  end if;

  select concat_ws(' ', first_name, last_name)
  into v_name
  from public.users
  where id = v_request.requester_user_id;

  if v_name is null then
    raise exception using errcode = 'P0001', message = 'Requester user not found';
  end if;

  select count(*)::integer
  into v_participant_count
  from public.participants
  where event_id = p_event_id
    and (
      user_id is null
      or user_id <> v_event.owner_user_id
    );

  if v_event.max_participants is not null
    and 1 + v_participant_count >= v_event.max_participants then
    raise exception using errcode = 'P0001', message = 'Event capacity has been reached';
  end if;

  v_participant_id := gen_random_uuid();

  insert into public.participants (
    id,
    event_id,
    user_id,
    edit_token,
    name
  ) values (
    v_participant_id,
    p_event_id,
    v_request.requester_user_id,
    gen_random_uuid(),
    v_name
  );

  update public.join_requests
  set status = 'approved',
      decided_at = now(),
      decided_by_user_id = p_actor_user_id
  where id = v_request.id;

  return query select v_request.id, v_participant_id;
end;
$$;

create or replace function public.reject_join_request(
  p_event_id text,
  p_request_id uuid,
  p_actor_user_id uuid
)
returns table (request_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_request public.join_requests%rowtype;
begin
  select *
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Event not found';
  end if;

  if v_event.owner_user_id is null or v_event.owner_user_id <> p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'Only the event owner can reject requests';
  end if;

  if v_event.visibility <> 'public' or v_event.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'Join requests are unavailable for this event';
  end if;

  select *
  into v_request
  from public.join_requests
  where id = p_request_id
    and event_id = p_event_id
  for update;

  if not found or v_request.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'Pending join request not found';
  end if;

  update public.join_requests
  set status = 'rejected',
      decided_at = now(),
      decided_by_user_id = p_actor_user_id
  where id = v_request.id;

  return query select v_request.id;
end;
$$;

revoke all on function public.create_join_request(text, uuid) from public;
revoke all on function public.create_join_request(text, uuid) from anon;
revoke all on function public.create_join_request(text, uuid) from authenticated;
revoke all on function public.approve_join_request(text, uuid, uuid) from public;
revoke all on function public.approve_join_request(text, uuid, uuid) from anon;
revoke all on function public.approve_join_request(text, uuid, uuid) from authenticated;
revoke all on function public.reject_join_request(text, uuid, uuid) from public;
revoke all on function public.reject_join_request(text, uuid, uuid) from anon;
revoke all on function public.reject_join_request(text, uuid, uuid) from authenticated;
grant execute on function public.approve_join_request(text, uuid, uuid)
  to service_role;
grant execute on function public.reject_join_request(text, uuid, uuid)
  to service_role;
grant execute on function public.create_join_request(text, uuid)
  to service_role;
