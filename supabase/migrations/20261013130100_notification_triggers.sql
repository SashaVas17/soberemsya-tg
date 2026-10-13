-- Business changes enqueue notifications in the same transaction.

-- Participants (not the organizer) hear about the final decision, a
-- cancellation and edits of the title or description.
create or replace function public.notify_event_changes()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_kind text;
  v_key text;
  v_payload jsonb := jsonb_build_object('title', new.title);
  v_person record;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if new.status = 'decided' and (
    new.status is distinct from old.status
    or new.final_time_option_id is distinct from old.final_time_option_id
    or new.final_place_id is distinct from old.final_place_id
  ) then
    v_kind := 'event_decided';
    v_key := 'decided:' || new.id || ':' || coalesce(new.final_time_option_id, '') || ':' || coalesce(new.final_place_id, '');
    v_payload := v_payload || coalesce((
      select jsonb_build_object(
        'startsAt', final_time.starts_at, 'place', final_place.title, 'area', final_place.area)
      from public.time_options final_time, public.place_options final_place
      where final_time.id = new.final_time_option_id and final_place.id = new.final_place_id
    ), '{}'::jsonb);
  elsif new.status is distinct from old.status and new.status = 'cancelled' then
    v_kind := 'event_cancelled';
    v_key := 'cancelled:' || new.id;
  elsif new.status is distinct from old.status and new.status = 'collecting' and old.status = 'decided' then
    v_kind := 'event_reopened';
    v_key := 'reopened:' || new.id || ':' || floor(extract(epoch from now()) / 600)::text;
  elsif new.status <> 'cancelled'
    and (new.title is distinct from old.title or new.description is distinct from old.description) then
    v_kind := 'event_updated';
    v_key := 'updated:' || new.id || ':' || floor(extract(epoch from now()) / 600)::text;
  else
    return new;
  end if;

  for v_person in
    select distinct participant.user_id
    from public.participants participant
    where participant.event_id = new.id
      and participant.user_id is not null
      and participant.user_id is distinct from new.owner_user_id
  loop
    perform public.enqueue_notification(
      v_person.user_id, new.id, v_kind, v_key || ':' || v_person.user_id::text, v_payload);
  end loop;
  return new;
end;
$$;

drop trigger if exists events_notify_changes on public.events;
create trigger events_notify_changes
  after update of status, title, description, final_time_option_id, final_place_id on public.events
  for each row execute function public.notify_event_changes();

-- The organizer hears about new join requests; the requester about decisions.
create or replace function public.notify_join_requests()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_event record;
  v_name text;
begin
  select event.id, event.title, event.owner_user_id into v_event
  from public.events event where event.id = new.event_id and event.deleted_at is null;
  if v_event.id is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status = 'pending' then
    select trim(both from concat_ws(' ', profile.first_name, profile.last_name)) into v_name
    from public.users profile where profile.id = new.requester_user_id;
    perform public.enqueue_notification(
      v_event.owner_user_id, v_event.id, 'join_request_new', 'joinreq:' || new.id::text,
      jsonb_build_object('title', v_event.title, 'requester', coalesce(nullif(v_name, ''), 'Пользователь Telegram')));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    perform public.enqueue_notification(
      new.requester_user_id, v_event.id,
      case new.status when 'approved' then 'join_request_approved' else 'join_request_rejected' end,
      'joinreq:' || new.id::text || ':' || new.status,
      jsonb_build_object('title', v_event.title));
  end if;
  return new;
end;
$$;

drop trigger if exists join_requests_notify on public.join_requests;
create trigger join_requests_notify
  after insert or update of status on public.join_requests
  for each row execute function public.notify_join_requests();

-- A saved response rewrites availability votes; once per statement, tell an
-- organizer in "each" mode, at most one message per event per 15 minutes.
create or replace function public.notify_new_responses()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_bucket bigint;
  v_payload jsonb;
  v_id bigint;
begin
  for v_row in
    select distinct event.id, event.title, event.owner_user_id
    from new_votes vote
    join public.participants participant on participant.id = vote.participant_id
    join public.events event on event.id = participant.event_id
    where event.deleted_at is null
      and event.status = 'collecting'
      and participant.user_id is distinct from event.owner_user_id
  loop
    if public.notification_response_mode(v_row.owner_user_id) = 'each' then
      v_bucket := floor(extract(epoch from now()) / 900)::bigint;
      v_payload := jsonb_build_object('title', v_row.title,
        'answered', public.event_answered_count(v_row.id, v_row.owner_user_id));
      v_id := null;
      -- First response in a 15-minute window goes out now; later ones update
      -- the still-pending message or roll into one message for the next window.
      insert into public.notification_outbox (user_id, event_id, kind, dedupe_key, payload)
      values (v_row.owner_user_id, v_row.id, 'response_each', 'resp:' || v_row.id || ':' || v_bucket, v_payload)
      on conflict (dedupe_key) do update set payload = excluded.payload
        where notification_outbox.status = 'pending'
      returning notification_outbox.id into v_id;
      if v_id is null then
        insert into public.notification_outbox (user_id, event_id, kind, dedupe_key, payload, next_attempt_at)
        values (v_row.owner_user_id, v_row.id, 'response_each', 'resp:' || v_row.id || ':' || (v_bucket + 1),
          v_payload, to_timestamp((v_bucket + 1) * 900))
        on conflict (dedupe_key) do update set payload = excluded.payload
          where notification_outbox.status = 'pending';
      end if;
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists availability_votes_notify on public.availability_votes;
create trigger availability_votes_notify
  after insert on public.availability_votes
  referencing new table as new_votes
  for each statement execute function public.notify_new_responses();

revoke all on function public.notify_event_changes() from public, anon, authenticated;
revoke all on function public.notify_join_requests() from public, anon, authenticated;
revoke all on function public.notify_new_responses() from public, anon, authenticated;
