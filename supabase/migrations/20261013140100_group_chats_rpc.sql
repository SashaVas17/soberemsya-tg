-- RPCs for group chats (service_role only).

-- Issued by the bot for /new in a group; valid for 24 hours, only for the
-- member who sent the command, and usable for several meetings. The token
-- travels in a startapp link, so it uses only base64url characters
-- (18 random bytes -> 24 characters, no padding).
create or replace function public.create_group_link(
  p_chat_id bigint, p_chat_title text, p_issuer_telegram_user_id bigint
)
returns text
language sql security definer set search_path = pg_catalog, public
as $$
  insert into public.group_links (token, chat_id, chat_title, issuer_telegram_user_id, expires_at)
  values (
    translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
    p_chat_id,
    left(coalesce(p_chat_title, ''), 200),
    p_issuer_telegram_user_id,
    now() + interval '24 hours')
  returning token;
$$;

create or replace function public.group_link_info(p_token text, p_actor_user_id uuid)
returns table (chat_title text, is_issuer boolean)
language sql stable security definer set search_path = pg_catalog, public
as $$
  select link.chat_title, exists (
    select 1 from public.users actor
    where actor.id = p_actor_user_id and actor.telegram_user_id = link.issuer_telegram_user_id)
  from public.group_links link
  where link.token = p_token and link.expires_at > now();
$$;

-- Attaches a meeting to the group of a valid link and queues its card.
-- Returns attached | invalid_link | not_issuer | forbidden | already_attached.
-- Repeating the call (e.g. an idempotent create replay) is harmless.
create or replace function public.attach_event_to_group(
  p_event_id text, p_actor_user_id uuid, p_token text
)
returns text
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_link record;
  v_event record;
  v_chat_id bigint;
  v_name text;
begin
  select link.chat_id, link.chat_title, link.issuer_telegram_user_id into v_link
  from public.group_links link
  where link.token = p_token and link.expires_at > now();
  if v_link.chat_id is null then
    return 'invalid_link';
  end if;
  if not exists (
    select 1 from public.users actor
    where actor.id = p_actor_user_id and actor.telegram_user_id = v_link.issuer_telegram_user_id
  ) then
    return 'not_issuer';
  end if;
  select event.id, event.title, event.owner_user_id into v_event
  from public.events event
  where event.id = p_event_id and event.deleted_at is null;
  if v_event.id is null or v_event.owner_user_id is distinct from p_actor_user_id then
    return 'forbidden';
  end if;

  insert into public.event_group_chats (event_id, chat_id, chat_title, attached_by)
  values (p_event_id, v_link.chat_id, v_link.chat_title, p_actor_user_id)
  on conflict (event_id) do nothing;
  select attached.chat_id into v_chat_id
  from public.event_group_chats attached where attached.event_id = p_event_id;
  if v_chat_id is distinct from v_link.chat_id then
    return 'already_attached';
  end if;

  select trim(both from concat_ws(' ', profile.first_name, profile.last_name)) into v_name
  from public.users profile where profile.id = p_actor_user_id;
  insert into public.group_message_outbox (event_id, chat_id, kind, dedupe_key, payload)
  values (
    p_event_id, v_chat_id, 'group_card', 'gcard:' || p_event_id,
    jsonb_build_object('title', v_event.title, 'organizer', coalesce(v_name, '')))
  on conflict (dedupe_key) do nothing;
  return 'attached';
end;
$$;

-- The group hears about the final decision only.
create or replace function public.notify_group_chats()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_chat_id bigint;
begin
  if new.deleted_at is not null or new.status <> 'decided' then
    return new;
  end if;
  if new.status is not distinct from old.status
    and new.final_time_option_id is not distinct from old.final_time_option_id
    and new.final_place_id is not distinct from old.final_place_id then
    return new;
  end if;
  select attached.chat_id into v_chat_id
  from public.event_group_chats attached where attached.event_id = new.id;
  if v_chat_id is null then
    return new;
  end if;
  insert into public.group_message_outbox (event_id, chat_id, kind, dedupe_key, payload)
  values (
    new.id, v_chat_id, 'group_decided',
    'gdecided:' || new.id || ':' || coalesce(new.final_time_option_id, '') || ':' || coalesce(new.final_place_id, ''),
    jsonb_build_object('title', new.title) || coalesce((
      select jsonb_build_object(
        'startsAt', final_time.starts_at, 'place', final_place.title, 'area', final_place.area)
      from public.time_options final_time, public.place_options final_place
      where final_time.id = new.final_time_option_id and final_place.id = new.final_place_id
    ), '{}'::jsonb))
  -- The same result decided again after a reopen: a copy skipped while the
  -- meeting was reopened is queued again; one already sent is not repeated.
  on conflict (dedupe_key) do update
    set status = 'pending', attempts = 0, next_attempt_at = now(), locked_at = null,
        last_error = null, payload = excluded.payload
    where public.group_message_outbox.status = 'skipped';
  return new;
end;
$$;

create or replace trigger events_notify_group_chats
  after update of status, final_time_option_id, final_place_id on public.events
  for each row execute function public.notify_group_chats();

-- Same claim semantics as claim_notification_batch: rows stuck in
-- "sending" for 5 minutes are retried (at-least-once).
create or replace function public.claim_group_message_batch(p_limit integer)
returns table (
  id bigint, chat_id bigint, kind text, event_id text,
  event_status text, event_deleted boolean, payload jsonb, attempts integer
)
language sql security definer set search_path = pg_catalog, public
as $$
  with picked as (
    select outbox.id from public.group_message_outbox outbox
    where (outbox.status = 'pending' and outbox.next_attempt_at <= now())
       or (outbox.status = 'sending' and outbox.locked_at < now() - interval '5 minutes')
    order by outbox.id
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    for update skip locked
  )
  update public.group_message_outbox outbox
  set status = 'sending', locked_at = now(), attempts = outbox.attempts + 1
  from picked
  where outbox.id = picked.id
  returning outbox.id, outbox.chat_id, outbox.kind, outbox.event_id,
    (select event.status from public.events event where event.id = outbox.event_id),
    coalesce((select event.deleted_at is not null from public.events event where event.id = outbox.event_id), false),
    outbox.payload, outbox.attempts;
$$;

-- p_outcome: sent | retry | defer | blocked (bot removed from the group) |
-- skip | failed | migrated (the group became a supergroup; p_new_chat_id).
create or replace function public.complete_group_message(
  p_id bigint, p_outcome text, p_error text default null,
  p_retry_after_seconds integer default null, p_new_chat_id bigint default null
)
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_old_chat_id bigint;
begin
  if p_outcome = 'sent' then
    update public.group_message_outbox
    set status = 'sent', sent_at = now(), locked_at = null, last_error = null
    where id = p_id;
  elsif p_outcome = 'retry' then
    update public.group_message_outbox
    set status = case when attempts >= 5 then 'failed' else 'pending' end,
        next_attempt_at = now() + make_interval(secs => coalesce(
          p_retry_after_seconds, least(3600, 30 * power(2, attempts))::integer)),
        locked_at = null, last_error = left(p_error, 500)
    where id = p_id;
  elsif p_outcome = 'defer' then
    update public.group_message_outbox
    set status = 'pending', attempts = greatest(attempts - 1, 0), locked_at = null,
        next_attempt_at = now() + make_interval(secs => coalesce(p_retry_after_seconds, 30))
    where id = p_id;
  elsif p_outcome = 'migrated' and p_new_chat_id is not null then
    select outbox.chat_id into v_old_chat_id
    from public.group_message_outbox outbox where outbox.id = p_id;
    update public.event_group_chats set chat_id = p_new_chat_id where chat_id = v_old_chat_id;
    update public.group_links set chat_id = p_new_chat_id where chat_id = v_old_chat_id;
    update public.group_message_outbox
    set chat_id = p_new_chat_id
    where chat_id = v_old_chat_id and status in ('pending', 'sending');
    update public.group_message_outbox
    set status = case when attempts >= 5 then 'failed' else 'pending' end,
        next_attempt_at = now(), locked_at = null, last_error = left(p_error, 500)
    where id = p_id;
  elsif p_outcome in ('blocked', 'skip') then
    update public.group_message_outbox
    set status = 'skipped', locked_at = null, last_error = left(p_error, 500)
    where id = p_id;
  else
    update public.group_message_outbox
    set status = 'failed', locked_at = null, last_error = left(p_error, 500)
    where id = p_id;
  end if;
end;
$$;

create or replace function public.purge_group_data()
returns void
language sql security definer set search_path = pg_catalog, public
as $$
  delete from public.group_links where expires_at < now() - interval '1 day';
  delete from public.group_message_outbox
  where status in ('sent', 'skipped', 'failed') and created_at < now() - interval '30 days';
$$;

revoke all on function public.create_group_link(bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.group_link_info(text, uuid) from public, anon, authenticated;
revoke all on function public.attach_event_to_group(text, uuid, text) from public, anon, authenticated;
revoke all on function public.notify_group_chats() from public, anon, authenticated;
revoke all on function public.claim_group_message_batch(integer) from public, anon, authenticated;
revoke all on function public.complete_group_message(bigint, text, text, integer, bigint) from public, anon, authenticated;
revoke all on function public.purge_group_data() from public, anon, authenticated;
grant execute on function public.create_group_link(bigint, text, bigint) to service_role;
grant execute on function public.group_link_info(text, uuid) to service_role;
grant execute on function public.attach_event_to_group(text, uuid, text) to service_role;
grant execute on function public.claim_group_message_batch(integer) to service_role;
grant execute on function public.complete_group_message(bigint, text, text, integer, bigint) to service_role;
grant execute on function public.purge_group_data() to service_role;
