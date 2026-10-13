-- RPCs for the notifications-worker Edge Function (service_role only).

-- Shared secret for pg_cron -> notifications-worker; generated in the
-- database and never stored in the repository.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notifications_worker_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notifications_worker_secret',
      'pg_cron -> notifications-worker shared secret');
  end if;
end;
$$;

create or replace function public.verify_notifications_worker_secret(p_secret text)
returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets secret
    where secret.name = 'notifications_worker_secret' and secret.decrypted_secret = p_secret);
$$;

-- Claims due rows; rows stuck in "sending" for 5 minutes are retried, which
-- is where the at-least-once duplicate can come from.
create or replace function public.claim_notification_batch(p_limit integer)
returns table (
  id bigint, telegram_user_id bigint, kind text, event_id text,
  event_status text, event_deleted boolean, payload jsonb, attempts integer
)
language sql security definer set search_path = pg_catalog, public
as $$
  with picked as (
    select outbox.id from public.notification_outbox outbox
    where (outbox.status = 'pending' and outbox.next_attempt_at <= now())
       or (outbox.status = 'sending' and outbox.locked_at < now() - interval '5 minutes')
    order by outbox.id
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    for update skip locked
  )
  update public.notification_outbox outbox
  set status = 'sending', locked_at = now(), attempts = outbox.attempts + 1
  from picked, public.users recipient
  where outbox.id = picked.id and recipient.id = outbox.user_id
  returning outbox.id, recipient.telegram_user_id, outbox.kind, outbox.event_id,
    (select event.status from public.events event where event.id = outbox.event_id),
    coalesce((select event.deleted_at is not null from public.events event where event.id = outbox.event_id), false),
    outbox.payload, outbox.attempts;
$$;

-- p_outcome: sent | retry | defer (not attempted, e.g. throttled; does not
-- consume an attempt) | blocked (user blocked the bot) | skip | failed.
create or replace function public.complete_notification(
  p_id bigint, p_outcome text, p_error text default null, p_retry_after_seconds integer default null
)
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
begin
  if p_outcome = 'sent' then
    update public.notification_outbox
    set status = 'sent', sent_at = now(), locked_at = null, last_error = null
    where id = p_id returning user_id into v_user_id;
    update public.users set can_message = true where id = v_user_id and can_message is distinct from true;
  elsif p_outcome = 'retry' then
    update public.notification_outbox
    set status = case when attempts >= 5 then 'failed' else 'pending' end,
        next_attempt_at = now() + make_interval(secs => coalesce(
          p_retry_after_seconds, least(3600, 30 * power(2, attempts))::integer)),
        locked_at = null, last_error = left(p_error, 500)
    where id = p_id;
  elsif p_outcome = 'defer' then
    update public.notification_outbox
    set status = 'pending', attempts = greatest(attempts - 1, 0), locked_at = null,
        next_attempt_at = now() + make_interval(secs => coalesce(p_retry_after_seconds, 30))
    where id = p_id;
  elsif p_outcome = 'blocked' then
    update public.notification_outbox
    set status = 'skipped', locked_at = null, last_error = left(p_error, 500)
    where id = p_id returning user_id into v_user_id;
    update public.users set can_message = false where id = v_user_id;
  elsif p_outcome = 'skip' then
    update public.notification_outbox
    set status = 'skipped', locked_at = null, last_error = left(p_error, 500)
    where id = p_id;
  else
    update public.notification_outbox
    set status = 'failed', locked_at = null, last_error = left(p_error, 500)
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.verify_notifications_worker_secret(text) from public, anon, authenticated;
revoke all on function public.claim_notification_batch(integer) from public, anon, authenticated;
revoke all on function public.complete_notification(bigint, text, text, integer) from public, anon, authenticated;
grant execute on function public.verify_notifications_worker_secret(text) to service_role;
grant execute on function public.claim_notification_batch(integer) to service_role;
grant execute on function public.complete_notification(bigint, text, text, integer) to service_role;
