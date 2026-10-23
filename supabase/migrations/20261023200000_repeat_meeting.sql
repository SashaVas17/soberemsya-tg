-- «Собрать ещё раз» (plan «Привлечение аудитории»): the organizer of a
-- meeting starts a new one from it, and the people of the old meeting get
-- an invitation from the bot (notification event_repeated) to the new one.
-- Invitations skip people who blocked the organizer or were blocked by
-- them, people the bot cannot write to, and come from an unbanned
-- organizer only; they are counted against the event_repeat rate limit.

alter table public.notification_outbox
  drop constraint notification_outbox_kind_check,
  add constraint notification_outbox_kind_check check (kind in (
    'response_each', 'response_summary', 'join_request_new',
    'join_request_approved', 'join_request_rejected', 'event_decided',
    'event_cancelled', 'event_updated', 'event_reopened', 'reminder_24h', 'reminder_2h',
    'report_new', 'event_repeated'
  ));

alter table public.action_rate_limits
  drop constraint action_rate_limits_action_check,
  add constraint action_rate_limits_action_check check (action in (
    'event_create', 'open_event_create', 'join_request', 'option_proposal', 'report', 'event_repeat'
  ));

insert into public.action_rate_limits (action, per_hour, per_day) values ('event_repeat', 3, 5)
on conflict (action) do nothing;

-- The meeting a new one was gathered from; set once, so a repeated call for
-- the same new meeting (a retried create) sends nothing twice.
alter table public.events
  add column if not exists repeat_of_event_id text references public.events(id) on delete set null;

-- Invites the people of p_source_event_id to p_event_id; both meetings must
-- be the actor's. Returns how many were invited (at most 50). Raises
-- REPEAT_EVENT_INVALID for someone else's meeting and RATE_LIMITED:event_repeat
-- over the limit; either way nothing is queued.
create or replace function public.invite_previous_participants(
  p_actor_user_id uuid, p_source_event_id text, p_event_id text
)
returns integer
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_title text;
  v_count integer;
begin
  if p_source_event_id = p_event_id
    or not exists (select 1 from public.events source
      where source.id = p_source_event_id and source.owner_user_id = p_actor_user_id and source.deleted_at is null)
  then
    raise exception using errcode = 'P0001', message = 'REPEAT_EVENT_INVALID';
  end if;
  update public.events meeting
  set repeat_of_event_id = p_source_event_id
  where meeting.id = p_event_id
    and meeting.owner_user_id = p_actor_user_id
    and meeting.deleted_at is null
    and meeting.status <> 'cancelled'
    and meeting.repeat_of_event_id is null
  returning meeting.title into v_title;
  if not found then
    -- Already invited for this meeting, or not the actor's open meeting.
    if exists (select 1 from public.events meeting
      where meeting.id = p_event_id and meeting.owner_user_id = p_actor_user_id
        and meeting.repeat_of_event_id = p_source_event_id) then
      return 0;
    end if;
    raise exception using errcode = 'P0001', message = 'REPEAT_EVENT_INVALID';
  end if;
  if exists (select 1 from public.users organizer where organizer.id = p_actor_user_id and organizer.banned_at is not null) then
    return 0;
  end if;

  with invitees as (
    select distinct participant.user_id
    from public.participants participant
    join public.users person on person.id = participant.user_id
    where participant.event_id = p_source_event_id
      and participant.user_id is not null
      and participant.user_id <> p_actor_user_id
      and person.can_message is distinct from false
      and not public.users_blocked_between(p_actor_user_id, participant.user_id)
      and not exists (select 1 from public.participants already
        where already.event_id = p_event_id and already.user_id = participant.user_id)
    limit 50
  ), queued as (
    insert into public.notification_outbox (user_id, event_id, kind, dedupe_key, payload)
    select invitees.user_id, p_event_id, 'event_repeated',
      'event_repeated:' || p_event_id || ':' || invitees.user_id::text,
      jsonb_build_object('title', v_title)
    from invitees
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*)::integer into v_count from queued;

  if v_count > 0 then
    perform public.consume_action_rate_limit(p_actor_user_id, 'event_repeat');
  end if;
  return v_count;
end;
$$;

revoke all on function public.invite_previous_participants(uuid, text, text) from public, anon, authenticated;
grant execute on function public.invite_previous_participants(uuid, text, text) to service_role;
