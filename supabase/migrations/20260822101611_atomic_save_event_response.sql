create or replace function public.save_event_response(
  p_event_id text,
  p_actor_user_id uuid,
  p_area text,
  p_budget integer,
  p_preferences text,
  p_restrictions text,
  p_available_time_option_ids text[]
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
  v_invalid_time_option_id text;
begin
  if p_actor_user_id is null then
    raise exception using errcode = 'P0001', message = 'RESPONSE_ACTOR_UNAVAILABLE';
  end if;

  -- Keep the established event-first lock order for response and membership mutations.
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

  return query select v_participant_id;
end;
$$;

revoke all on function public.save_event_response(text, uuid, text, integer, text, text, text[]) from public;
revoke all on function public.save_event_response(text, uuid, text, integer, text, text, text[]) from anon;
revoke all on function public.save_event_response(text, uuid, text, integer, text, text, text[]) from authenticated;
grant execute on function public.save_event_response(text, uuid, text, integer, text, text, text[])
  to service_role;
