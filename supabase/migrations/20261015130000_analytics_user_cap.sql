-- Security hardening: a scripted client could fill analytics_events through
-- /me/analytics by changing eventId on every call (the per-minute duplicate
-- check only catches identical rows). A soft cap per user and hour keeps the
-- table bounded; parallel calls may pass it by a few rows, which is fine for
-- statistics. Analytics never fails a request, so extra events are skipped.

create index if not exists analytics_events_user_created_idx
  on public.analytics_events (user_id, created_at);

create or replace function public.record_analytics_event(
  p_name text, p_user_id uuid, p_event_id text default null, p_source text default null
)
returns void
language sql security definer set search_path = pg_catalog, public
as $$
  insert into public.analytics_events (name, user_id, event_id, source)
  select p_name, p_user_id, left(p_event_id, 100), left(p_source, 32)
  where not exists (
    select 1 from public.analytics_events recent
    where recent.name = p_name
      and recent.created_at > now() - interval '1 minute'
      and recent.user_id is not distinct from p_user_id
      and recent.event_id is not distinct from left(p_event_id, 100)
      and recent.source is not distinct from left(p_source, 32))
  and (
    p_user_id is null
    or (
      select count(*) from (
        select 1 from public.analytics_events mine
        where mine.user_id = p_user_id
          and mine.created_at > now() - interval '1 hour'
        limit 200
      ) capped
    ) < 200);
$$;

revoke all on function public.record_analytics_event(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_analytics_event(text, uuid, text, text) to service_role;
