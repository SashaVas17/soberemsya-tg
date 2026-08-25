create or replace function public.add_event_time_option(
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
  select *
  into v_event
  from public.events as event
  where event.id = p_event_id
    and event.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;

  if p_actor_user_id is null
    or v_event.owner_user_id is null
    or v_event.owner_user_id <> p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_EVENT_OWNER';
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

create or replace function public.add_event_place_option(
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
  select *
  into v_event
  from public.events as event
  where event.id = p_event_id
    and event.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;

  if p_actor_user_id is null
    or v_event.owner_user_id is null
    or v_event.owner_user_id <> p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_EVENT_OWNER';
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
    p_title,
    p_area,
    p_estimated_budget
  );

  return query select p_option_id;
end;
$$;

revoke all on function public.add_event_time_option(text, uuid, text, timestamptz) from public;
revoke all on function public.add_event_time_option(text, uuid, text, timestamptz) from anon;
revoke all on function public.add_event_time_option(text, uuid, text, timestamptz) from authenticated;
grant execute on function public.add_event_time_option(text, uuid, text, timestamptz)
  to service_role;

revoke all on function public.add_event_place_option(text, uuid, text, text, text, integer) from public;
revoke all on function public.add_event_place_option(text, uuid, text, text, text, integer) from anon;
revoke all on function public.add_event_place_option(text, uuid, text, text, text, integer) from authenticated;
grant execute on function public.add_event_place_option(text, uuid, text, text, text, integer)
  to service_role;
