-- Growth plan: a reminder to the organizer to pick the result. Once per
-- meeting, when its nearest upcoming time option is less than a day away and
-- the meeting is still collecting answers. Not for a meeting made less than
-- three hours ago (its nearest time may simply be close), nor for organizers
-- who turned answer notifications off. The scheduler below is unchanged but
-- for the call of the new function at its start.

alter table public.notification_outbox
  drop constraint notification_outbox_kind_check,
  add constraint notification_outbox_kind_check check (kind in (
    'response_each', 'response_summary', 'join_request_new',
    'join_request_approved', 'join_request_rejected', 'event_decided',
    'event_cancelled', 'event_updated', 'event_reopened', 'reminder_24h', 'reminder_2h',
    'report_new', 'event_repeated', 'decide_reminder'
  ));

create or replace function public.enqueue_decide_reminders(p_now timestamptz default now())
returns void
language sql security definer set search_path = pg_catalog, public
as $$
  insert into public.notification_outbox (user_id, event_id, kind, dedupe_key, payload)
  select event.owner_user_id, event.id, 'decide_reminder', 'decide_reminder:' || event.id,
    jsonb_build_object('title', event.title, 'startsAt', nearest.starts_at,
      'answered', public.event_answered_count(event.id, event.owner_user_id))
  from public.events event
  cross join lateral (
    select option.starts_at from public.time_options option
    where option.event_id = event.id and option.starts_at > p_now
    order by option.starts_at
    limit 1
  ) nearest
  where event.status = 'collecting'
    and event.deleted_at is null
    and event.owner_user_id is not null
    and event.created_at <= p_now - interval '3 hours'
    and nearest.starts_at <= p_now + interval '24 hours'
    and public.notification_response_mode(event.owner_user_id) <> 'off'
  on conflict (dedupe_key) do nothing;
$$;

create or replace function public.enqueue_due_notifications(p_now timestamptz default now())
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_available integer;
begin
  -- The organizer of a meeting whose nearest time is under a day away and
  -- still undecided (20261023 migration).
  perform public.enqueue_decide_reminders(p_now);

  insert into public.notification_outbox (user_id, event_id, kind, dedupe_key, payload)
  select person.user_id, event.id, reminder.kind,
    reminder.kind || ':' || event.id || ':' || final_time.id || ':' || person.user_id::text,
    jsonb_build_object('title', event.title, 'startsAt', final_time.starts_at,
      'place', final_place.title, 'area', final_place.area)
  from public.events event
  join public.time_options final_time on final_time.id = event.final_time_option_id
  left join public.place_options final_place on final_place.id = event.final_place_id
  cross join lateral (
    select event.owner_user_id as user_id
    union
    select participant.user_id from public.participants participant
    where participant.event_id = event.id and participant.user_id is not null
  ) person
  left join public.notification_preferences pref on pref.user_id = person.user_id
  cross join lateral (values
    ('reminder_24h', interval '24 hours', coalesce(pref.reminder_24h, true)),
    ('reminder_2h', interval '2 hours', coalesce(pref.reminder_2h, true))
  ) reminder(kind, lead_time, enabled)
  where event.status = 'decided'
    and event.deleted_at is null
    and person.user_id is not null
    and reminder.enabled
    and p_now >= final_time.starts_at - reminder.lead_time
    and p_now < final_time.starts_at - reminder.lead_time + interval '10 minutes'
  on conflict (dedupe_key) do nothing;

  if extract(hour from p_now at time zone 'Europe/Minsk') <> 19 then
    return;
  end if;

  for v_row in
    select event.id, event.title, event.owner_user_id,
      coalesce(state.last_summary_participants, 0) as previous,
      public.event_answered_count(event.id, event.owner_user_id) as answered
    from public.events event
    left join public.event_notification_state state on state.event_id = event.id
    where event.status = 'collecting'
      and event.deleted_at is null
      and event.owner_user_id is not null
      and (state.last_summary_at is null or state.last_summary_at < p_now - interval '20 hours')
  loop
    if v_row.answered > v_row.previous
      and public.notification_response_mode(v_row.owner_user_id) = 'summary' then
      select coalesce(max(option_votes.available), 0) into v_available
      from (
        select count(*) as available
        from public.availability_votes vote
        join public.time_options option on option.id = vote.time_option_id
        join public.participants voter on voter.id = vote.participant_id
        where option.event_id = v_row.id and vote.is_available
          and voter.user_id is distinct from v_row.owner_user_id
        group by option.id
      ) option_votes;
      perform public.enqueue_notification(
        v_row.owner_user_id, v_row.id, 'response_summary',
        'summary:' || v_row.id || ':' || to_char(p_now at time zone 'Europe/Minsk', 'YYYY-MM-DD'),
        jsonb_build_object('title', v_row.title, 'answered', v_row.answered,
          'available', v_available, 'declined', greatest(v_row.answered - v_available, 0)));
    end if;
    insert into public.event_notification_state (event_id, last_summary_at, last_summary_participants)
    values (v_row.id, p_now, v_row.answered)
    on conflict (event_id) do update
      set last_summary_at = excluded.last_summary_at,
          last_summary_participants = excluded.last_summary_participants;
  end loop;
end;
$$;

revoke all on function public.enqueue_decide_reminders(timestamptz) from public, anon, authenticated;
