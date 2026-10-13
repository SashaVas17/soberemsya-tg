-- Time-based notifications, run every minute by pg_cron:
-- reminders 24h and 2h before a decided meeting, and an evening (19:00 Minsk)
-- summary of new responses for organizers in "summary" mode.
create or replace function public.enqueue_due_notifications(p_now timestamptz default now())
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_available integer;
begin
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

-- Keeps the outbox small: finished rows are kept for 30 days.
create or replace function public.purge_notification_outbox()
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  delete from public.notification_outbox
  where status in ('sent', 'skipped', 'failed') and created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.enqueue_due_notifications(timestamptz) from public, anon, authenticated;
revoke all on function public.purge_notification_outbox() from public, anon, authenticated;
