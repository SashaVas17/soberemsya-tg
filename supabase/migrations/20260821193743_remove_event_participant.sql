create or replace function public.remove_event_participant(
  p_event_id text,
  p_participant_id uuid,
  p_actor_user_id uuid
)
returns table (event_id text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.events%rowtype;
  v_participant public.participants%rowtype;
begin
  if p_actor_user_id is null then
    raise exception using errcode = 'P0001', message = 'PARTICIPANT_REMOVAL_ACTOR_UNAVAILABLE';
  end if;

  -- Keep the same event-first lock order as join approval and self-leave.
  select *
  into v_event
  from public.events
  where id = p_event_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_UNAVAILABLE';
  end if;

  if v_event.owner_user_id is null
    or v_event.owner_user_id <> p_actor_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_EVENT_OWNER';
  end if;

  select *
  into v_participant
  from public.participants as participant
  where participant.id = p_participant_id
    and participant.event_id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PARTICIPANT_UNAVAILABLE';
  end if;

  if v_participant.user_id = v_event.owner_user_id then
    raise exception using errcode = 'P0001', message = 'OWNER_PARTICIPANT_CANNOT_REMOVE';
  end if;

  delete from public.participants as participant
  where participant.id = v_participant.id
    and participant.event_id = p_event_id;

  if v_event.visibility = 'public'
    and v_participant.user_id is not null then
    delete from public.join_requests as request
    where request.event_id = p_event_id
      and request.requester_user_id = v_participant.user_id;
  end if;

  return query select p_event_id;
end;
$$;

revoke all on function public.remove_event_participant(text, uuid, uuid) from public;
revoke all on function public.remove_event_participant(text, uuid, uuid) from anon;
revoke all on function public.remove_event_participant(text, uuid, uuid) from authenticated;
grant execute on function public.remove_event_participant(text, uuid, uuid)
  to service_role;
