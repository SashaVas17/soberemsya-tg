-- Participant proposals use a distinct capability from owner management.
-- The event-row lock serializes all option additions that enforce the 50-item cap.
create or replace function public.propose_event_time_option(
  p_event_id text,
  p_actor_user_id uuid,
  p_option_id text,
  p_starts_at timestamptz
)
returns table (option_id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_option_count integer;
begin
  if p_actor_user_id is null then
    raise exception using errcode = 'P0001', message = 'OPTION_PROPOSAL_ACTOR_UNAVAILABLE';
  end if;

  if p_option_id is null or btrim(p_option_id) = '' or p_starts_at is null then
    raise exception using errcode = 'P0001', message = 'TIME_OPTION_INVALID';
  end if;

  select *
  into v_event
  from public.events as event
  where event.id = p_event_id
    and event.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;

  if v_event.status <> 'collecting' then
    raise exception using errcode = 'P0001', message = 'OPTION_PROPOSAL_CLOSED';
  end if;

  -- Owners retain their separate owner-only management RPCs.
  if v_event.owner_user_id = p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'OPTION_PROPOSAL_NOT_ALLOWED';
  end if;

  -- A public event requires an approved participant row. Private invite links
  -- already authorize this actor's first response without a participant row.
  if v_event.visibility = 'public' and not exists (
    select 1
    from public.participants as participant
    where participant.event_id = p_event_id
      and participant.user_id = p_actor_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'OPTION_PROPOSAL_NOT_ALLOWED';
  end if;

  select count(*)::integer
  into v_option_count
  from public.time_options as option
  where option.event_id = p_event_id;

  if v_option_count >= 50 then
    raise exception using errcode = 'P0001', message = 'TIME_OPTION_LIMIT_REACHED';
  end if;

  insert into public.time_options (id, event_id, starts_at)
  values (p_option_id, p_event_id, p_starts_at);

  return query select p_option_id;
end;
$$;

create or replace function public.propose_event_place_option(
  p_event_id text,
  p_actor_user_id uuid,
  p_option_id text,
  p_title text,
  p_area text,
  p_estimated_budget integer
)
returns table (option_id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_option_count integer;
begin
  if p_actor_user_id is null then
    raise exception using errcode = 'P0001', message = 'OPTION_PROPOSAL_ACTOR_UNAVAILABLE';
  end if;

  if p_option_id is null
    or btrim(p_option_id) = ''
    or p_title is null
    or btrim(p_title) = ''
    or char_length(p_title) > 200
    or p_area is null
    or char_length(p_area) > 200
    or p_estimated_budget is null
    or p_estimated_budget < 0 then
    raise exception using errcode = 'P0001', message = 'PLACE_OPTION_INVALID';
  end if;

  select *
  into v_event
  from public.events as event
  where event.id = p_event_id
    and event.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;

  if v_event.status <> 'collecting' then
    raise exception using errcode = 'P0001', message = 'OPTION_PROPOSAL_CLOSED';
  end if;

  if v_event.owner_user_id = p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'OPTION_PROPOSAL_NOT_ALLOWED';
  end if;

  if v_event.visibility = 'public' and not exists (
    select 1
    from public.participants as participant
    where participant.event_id = p_event_id
      and participant.user_id = p_actor_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'OPTION_PROPOSAL_NOT_ALLOWED';
  end if;

  select count(*)::integer
  into v_option_count
  from public.place_options as option
  where option.event_id = p_event_id;

  if v_option_count >= 50 then
    raise exception using errcode = 'P0001', message = 'PLACE_OPTION_LIMIT_REACHED';
  end if;

  insert into public.place_options (
    id,
    event_id,
    title,
    area,
    estimated_budget
  )
  values (
    p_option_id,
    p_event_id,
    btrim(p_title),
    btrim(p_area),
    p_estimated_budget
  );

  return query select p_option_id;
end;
$$;

-- Replace the prior signature rather than leaving an ambiguous overload. The
-- final argument defaults to NULL, so the previous seven-argument RPC call
-- preserves existing place votes until the client explicitly sends an array.
drop function public.save_event_response(text, uuid, text, integer, text, text, text[]);

create function public.save_event_response(
  p_event_id text,
  p_actor_user_id uuid,
  p_area text,
  p_budget integer,
  p_preferences text,
  p_restrictions text,
  p_available_time_option_ids text[],
  p_selected_place_option_ids text[] default null
)
returns table (participant_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_existing_participant_id uuid;
  v_participant_id uuid;
  v_name text;
  v_available_time_option_ids text[];
  v_selected_place_option_ids text[];
  v_invalid_time_option_id text;
  v_invalid_place_option_id text;
begin
  if p_actor_user_id is null then
    raise exception using errcode = 'P0001', message = 'RESPONSE_ACTOR_UNAVAILABLE';
  end if;

  -- Keep the established event-first lock order for response, membership,
  -- place-vote, and option-proposal mutations.
  select *
  into v_event
  from public.events
  where id = p_event_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;

  if v_event.status <> 'collecting' then
    raise exception using errcode = 'P0001', message = 'RESPONSE_CLOSED';
  end if;

  select participant.id
  into v_existing_participant_id
  from public.participants as participant
  where participant.event_id = p_event_id
    and participant.user_id = p_actor_user_id
  for update;

  if v_event.visibility = 'public' then
    if v_event.owner_user_id = p_actor_user_id then
      raise exception using errcode = 'P0001', message = 'PUBLIC_OWNER_CANNOT_RESPOND';
    end if;

    if v_existing_participant_id is null then
      raise exception using errcode = 'P0001', message = 'PUBLIC_JOIN_REQUIRED';
    end if;
  end if;

  if p_budget is null or p_budget < 0 then
    raise exception using errcode = 'P0001', message = 'RESPONSE_INVALID_BUDGET';
  end if;

  if array_position(coalesce(p_available_time_option_ids, '{}'::text[]), null) is not null then
    raise exception using errcode = 'P0001', message = 'TIME_OPTION_UNAVAILABLE';
  end if;

  select coalesce(array_agg(distinct supplied.time_option_id), '{}'::text[])
  into v_available_time_option_ids
  from unnest(coalesce(p_available_time_option_ids, '{}'::text[])) as supplied(time_option_id);

  select supplied.time_option_id
  into v_invalid_time_option_id
  from unnest(v_available_time_option_ids) as supplied(time_option_id)
  where not exists (
    select 1
    from public.time_options as option
    where option.id = supplied.time_option_id
      and option.event_id = p_event_id
  )
  limit 1;

  if found then
    raise exception using errcode = 'P0001', message = 'TIME_OPTION_UNAVAILABLE';
  end if;

  if p_selected_place_option_ids is not null then
    if cardinality(p_selected_place_option_ids) > 50
      or array_position(p_selected_place_option_ids, null) is not null then
      raise exception using errcode = 'P0001', message = 'PLACE_OPTION_UNAVAILABLE';
    end if;

    select coalesce(array_agg(distinct supplied.place_option_id), '{}'::text[])
    into v_selected_place_option_ids
    from unnest(p_selected_place_option_ids) as supplied(place_option_id);

    select supplied.place_option_id
    into v_invalid_place_option_id
    from unnest(v_selected_place_option_ids) as supplied(place_option_id)
    where not exists (
      select 1
      from public.place_options as option
      where option.id = supplied.place_option_id
        and option.event_id = p_event_id
    )
    limit 1;

    if found then
      raise exception using errcode = 'P0001', message = 'PLACE_OPTION_UNAVAILABLE';
    end if;
  end if;

  select concat_ws(' ', nullif(user_profile.first_name, ''), nullif(user_profile.last_name, ''))
  into v_name
  from public.users as user_profile
  where user_profile.id = p_actor_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'RESPONSE_ACTOR_UNAVAILABLE';
  end if;

  insert into public.participants (
    id,
    event_id,
    user_id,
    edit_token,
    name,
    area,
    budget,
    preferences,
    restrictions
  )
  values (
    gen_random_uuid(),
    p_event_id,
    p_actor_user_id,
    gen_random_uuid(),
    v_name,
    btrim(coalesce(p_area, '')),
    p_budget,
    btrim(coalesce(p_preferences, '')),
    btrim(coalesce(p_restrictions, ''))
  )
  on conflict (event_id, user_id) do update
  set
    name = excluded.name,
    area = excluded.area,
    budget = excluded.budget,
    preferences = excluded.preferences,
    restrictions = excluded.restrictions
  returning id into v_participant_id;

  delete from public.availability_votes as vote
  where vote.participant_id = v_participant_id;

  insert into public.availability_votes (
    participant_id,
    time_option_id,
    is_available
  )
  select
    v_participant_id,
    option.id,
    option.id = any(v_available_time_option_ids)
  from public.time_options as option
  where option.event_id = p_event_id;

  -- NULL means an older client omitted the additive field. An explicit array,
  -- including {}, replaces only this actor's own place-vote set.
  if p_selected_place_option_ids is not null then
    delete from public.place_votes as vote
    where vote.participant_id = v_participant_id;

    insert into public.place_votes (participant_id, place_option_id)
    select v_participant_id, option.id
    from public.place_options as option
    where option.event_id = p_event_id
      and option.id = any(v_selected_place_option_ids);
  end if;

  return query select v_participant_id;
end;
$$;

revoke all on function public.propose_event_time_option(text, uuid, text, timestamptz) from public;
revoke all on function public.propose_event_time_option(text, uuid, text, timestamptz) from anon;
revoke all on function public.propose_event_time_option(text, uuid, text, timestamptz) from authenticated;
grant execute on function public.propose_event_time_option(text, uuid, text, timestamptz)
  to service_role;

revoke all on function public.propose_event_place_option(text, uuid, text, text, text, integer) from public;
revoke all on function public.propose_event_place_option(text, uuid, text, text, text, integer) from anon;
revoke all on function public.propose_event_place_option(text, uuid, text, text, text, integer)
  from authenticated;
grant execute on function public.propose_event_place_option(text, uuid, text, text, text, integer)
  to service_role;

revoke all on function public.save_event_response(text, uuid, text, integer, text, text, text[], text[]) from public;
revoke all on function public.save_event_response(text, uuid, text, integer, text, text, text[], text[]) from anon;
revoke all on function public.save_event_response(text, uuid, text, integer, text, text, text[], text[])
  from authenticated;
grant execute on function public.save_event_response(text, uuid, text, integer, text, text, text[], text[])
  to service_role;
