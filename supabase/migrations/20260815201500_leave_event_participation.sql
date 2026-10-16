create or replace function public.leave_event_participation(
  p_event_id text,
  p_user_id uuid
)
returns table (event_id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_participant_id uuid;
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'PARTICIPATION_ACTOR_UNAVAILABLE';
  end if;

  -- Keep the same event-first lock order as join-request approval.
  select *
  into v_event
  from public.events
  where id = p_event_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;

  if v_event.owner_user_id is not null
    and v_event.owner_user_id = p_user_id then
    raise exception using errcode = 'P0001', message = 'OWNER_CANNOT_LEAVE';
  end if;

  select participant.id
  into v_participant_id
  from public.participants as participant
  where participant.event_id = p_event_id
    and participant.user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PARTICIPATION_UNAVAILABLE';
  end if;

  delete from public.participants as participant
  where participant.id = v_participant_id
    and participant.event_id = p_event_id
    and participant.user_id = p_user_id;

  if v_event.visibility = 'public' then
    delete from public.join_requests as request
    where request.event_id = p_event_id
      and request.requester_user_id = p_user_id;
  end if;

  return query select p_event_id;
end;
$$;

revoke all on function public.leave_event_participation(text, uuid) from public;
revoke all on function public.leave_event_participation(text, uuid) from anon;
revoke all on function public.leave_event_participation(text, uuid) from authenticated;
grant execute on function public.leave_event_participation(text, uuid)
  to service_role;
