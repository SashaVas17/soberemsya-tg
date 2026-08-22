create or replace function public.archive_completed_events(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_archived_count integer := 0;
  v_event_id text;
begin
  if p_limit is null or p_limit <= 0 or p_limit > 500 then
    raise exception using errcode = 'P0001', message = 'ARCHIVE_LIMIT_INVALID';
  end if;

  -- Event-first locks keep cleanup compatible with the membership RPCs.
  for v_event_id in
    select event.id
    from public.events as event
    join public.time_options as final_time
      on final_time.id = event.final_time_option_id
      and final_time.event_id = event.id
    join public.place_options as final_place
      on final_place.id = event.final_place_id
      and final_place.event_id = event.id
    where event.status = 'decided'
      and event.deleted_at is null
      and event.final_time_option_id is not null
      and event.final_place_id is not null
      and final_time.starts_at <= now() - interval '12 hours'
    order by final_time.starts_at, event.id
    limit p_limit
    for update of event skip locked
  loop
    update public.events as event
    set deleted_at = now()
    where event.id = v_event_id
      and event.status = 'decided'
      and event.deleted_at is null
      and event.final_time_option_id is not null
      and event.final_place_id is not null
      and exists (
        select 1
        from public.time_options as final_time
        where final_time.id = event.final_time_option_id
          and final_time.event_id = event.id
          and final_time.starts_at <= now() - interval '12 hours'
      )
      and exists (
        select 1
        from public.place_options as final_place
        where final_place.id = event.final_place_id
          and final_place.event_id = event.id
      );

    if found then
      v_archived_count := v_archived_count + 1;
    end if;
  end loop;

  return v_archived_count;
end;
$$;

revoke all on function public.archive_completed_events(integer) from public;
revoke all on function public.archive_completed_events(integer) from anon;
revoke all on function public.archive_completed_events(integer) from authenticated;
grant execute on function public.archive_completed_events(integer) to service_role;
