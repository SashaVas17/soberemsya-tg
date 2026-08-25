create or replace function public.create_event_atomic(
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
returns table (event_id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_id text := btrim(coalesce(p_event_id, ''));
  v_admin_token text := btrim(coalesce(p_admin_token, ''));
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_time_option jsonb;
  v_place_option jsonb;
  v_time_option_id text;
  v_time_starts_at_text text;
  v_time_starts_at timestamptz;
  v_place_option_id text;
  v_place_title text;
  v_place_area text;
  v_place_budget_text text;
  v_place_budget numeric;
  v_time_option_ids text[] := array[]::text[];
  v_time_starts_at_values timestamptz[] := array[]::timestamptz[];
  v_place_option_ids text[] := array[]::text[];
  v_place_titles text[] := array[]::text[];
  v_place_areas text[] := array[]::text[];
  v_place_budgets integer[] := array[]::integer[];
begin
  if p_actor_user_id is null
    or not exists (
      select 1
      from public.users as user_profile
      where user_profile.id = p_actor_user_id
    ) then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_ACTOR_INVALID';
  end if;

  if v_event_id = '' or v_admin_token = '' then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_INPUT_INVALID';
  end if;

  if v_title = '' or length(v_title) > 200 then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_TITLE_INVALID';
  end if;

  if length(v_description) > 4000 then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_INPUT_INVALID';
  end if;

  if p_budget_limit is null or p_budget_limit < 0 then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_BUDGET_INVALID';
  end if;

  if p_visibility is null or p_visibility not in ('private', 'public') then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_VISIBILITY_INVALID';
  end if;

  if p_visibility = 'private' and p_max_participants is not null then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_CAPACITY_INVALID';
  end if;

  if p_visibility = 'public'
    and p_max_participants is not null
    and (p_max_participants < 2 or p_max_participants > 50) then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_CAPACITY_INVALID';
  end if;

  if p_time_options is null or jsonb_typeof(p_time_options) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_TIME_OPTIONS_INVALID';
  end if;

  if jsonb_array_length(p_time_options) = 0 then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_TIME_OPTIONS_INVALID';
  end if;

  if jsonb_array_length(p_time_options) > 50 then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_TIME_OPTIONS_LIMIT';
  end if;

  for v_time_option in select value from jsonb_array_elements(p_time_options)
  loop
    if jsonb_typeof(v_time_option) <> 'object' then
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_TIME_OPTIONS_INVALID';
    end if;

    v_time_option_id := btrim(v_time_option ->> 'id');
    v_time_starts_at_text := btrim(v_time_option ->> 'startsAt');
    if coalesce(jsonb_typeof(v_time_option -> 'id'), '') <> 'string'
      or nullif(v_time_option_id, '') is null
      or coalesce(jsonb_typeof(v_time_option -> 'startsAt'), '') <> 'string'
      or nullif(v_time_starts_at_text, '') is null
      or v_time_option_id = any(v_time_option_ids) then
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_TIME_OPTIONS_INVALID';
    end if;

    begin
      v_time_starts_at := v_time_starts_at_text::timestamptz;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode = 'P0001', message = 'CREATE_EVENT_TIME_OPTIONS_INVALID';
    end;

    v_time_option_ids := array_append(v_time_option_ids, v_time_option_id);
    v_time_starts_at_values := array_append(v_time_starts_at_values, v_time_starts_at);
  end loop;

  if p_place_options is null or jsonb_typeof(p_place_options) <> 'array' then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_PLACE_OPTIONS_INVALID';
  end if;

  if jsonb_array_length(p_place_options) > 50 then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_PLACE_OPTIONS_LIMIT';
  end if;

  for v_place_option in select value from jsonb_array_elements(p_place_options)
  loop
    if jsonb_typeof(v_place_option) <> 'object' then
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_PLACE_OPTIONS_INVALID';
    end if;

    v_place_option_id := btrim(v_place_option ->> 'id');
    v_place_title := btrim(v_place_option ->> 'title');
    v_place_area := btrim(coalesce(v_place_option ->> 'area', ''));
    v_place_budget_text := v_place_option ->> 'estimatedBudget';
    if coalesce(jsonb_typeof(v_place_option -> 'id'), '') <> 'string'
      or nullif(v_place_option_id, '') is null
      or v_place_option_id = any(v_place_option_ids)
      or coalesce(jsonb_typeof(v_place_option -> 'title'), '') <> 'string'
      or nullif(v_place_title, '') is null
      or length(v_place_title) > 200
      or (v_place_option ? 'area'
        and coalesce(jsonb_typeof(v_place_option -> 'area'), '') not in ('string', 'null'))
      or length(v_place_area) > 200
      or coalesce(jsonb_typeof(v_place_option -> 'estimatedBudget'), '') <> 'number'
      or length(v_place_budget_text) > 10
      or v_place_budget_text !~ '^(0|[1-9][0-9]*)$' then
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_PLACE_OPTIONS_INVALID';
    end if;

    v_place_budget := v_place_budget_text::numeric;
    if v_place_budget > 2147483647 then
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_PLACE_OPTIONS_INVALID';
    end if;

    v_place_option_ids := array_append(v_place_option_ids, v_place_option_id);
    v_place_titles := array_append(v_place_titles, v_place_title);
    v_place_areas := array_append(v_place_areas, v_place_area);
    v_place_budgets := array_append(v_place_budgets, v_place_budget::integer);
  end loop;

  insert into public.events (
    id,
    admin_token,
    owner_user_id,
    title,
    description,
    budget_limit,
    visibility,
    max_participants
  )
  values (
    v_event_id,
    v_admin_token,
    p_actor_user_id,
    v_title,
    v_description,
    p_budget_limit,
    p_visibility,
    p_max_participants
  );

  insert into public.time_options (id, event_id, starts_at)
  select option.id, v_event_id, option.starts_at
  from unnest(v_time_option_ids, v_time_starts_at_values) as option(id, starts_at);

  insert into public.place_options (id, event_id, title, area, estimated_budget)
  select option.id, v_event_id, option.title, option.area, option.estimated_budget
  from unnest(v_place_option_ids, v_place_titles, v_place_areas, v_place_budgets)
    as option(id, title, area, estimated_budget);

  return query select v_event_id;
end;
$$;

revoke all on function public.create_event_atomic(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb) from public;
revoke all on function public.create_event_atomic(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb) from anon;
revoke all on function public.create_event_atomic(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb) from authenticated;
grant execute on function public.create_event_atomic(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb)
  to service_role;
