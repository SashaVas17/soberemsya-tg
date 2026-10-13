-- Own product analytics (no third-party services): a few server-recorded
-- events plus aggregate stats for the administrator. Meetings, responses
-- and join requests are counted from their own tables, so history before
-- this migration is included; active users come from app_open events.

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  name text not null check (name in (
    'app_open', 'meeting_created', 'response_saved', 'join_requested', 'share_sent', 'share_fallback'
  )),
  user_id uuid references public.users(id) on delete set null,
  event_id text,
  source text check (source is null or length(source) <= 32),
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_name_created_idx
  on public.analytics_events (name, created_at);

alter table public.analytics_events enable row level security;
revoke all privileges on table public.analytics_events from public, anon, authenticated;

create or replace function public.record_analytics_event(
  p_name text, p_user_id uuid, p_event_id text default null, p_source text default null
)
returns void
language sql security definer set search_path = pg_catalog, public
as $$
  insert into public.analytics_events (name, user_id, event_id, source)
  values (p_name, p_user_id, left(p_event_id, 100), left(p_source, 32));
$$;

-- Aggregates for the admin screen and /stats. Days are Minsk calendar days.
create or replace function public.admin_stats()
returns jsonb
language sql stable security definer set search_path = pg_catalog, public
as $$
  with bounds as (
    select now() as now_at,
      (date_trunc('day', now() at time zone 'Europe/Minsk') at time zone 'Europe/Minsk') as today_at
  ),
  opens as (
    select event.user_id, event.created_at, event.source
    from public.analytics_events event
    where event.name = 'app_open' and event.user_id is not null
      and event.created_at >= (select now_at from bounds) - interval '30 days'
  ),
  answered as (
    select participant.event_id, participant.created_at
    from public.participants participant
    join public.events meeting on meeting.id = participant.event_id
    where participant.user_id is distinct from meeting.owner_user_id
      and exists (select 1 from public.availability_votes vote where vote.participant_id = participant.id)
  ),
  previous_week as (
    select distinct opens.user_id from opens, bounds
    where opens.created_at >= bounds.now_at - interval '14 days'
      and opens.created_at < bounds.now_at - interval '7 days'
  ),
  this_week as (
    select distinct opens.user_id from opens, bounds
    where opens.created_at >= bounds.now_at - interval '7 days'
  ),
  recent_meetings as (
    select meeting.id from public.events meeting, bounds
    where meeting.created_at >= bounds.now_at - interval '30 days' and meeting.deleted_at is null
  ),
  days as (
    select generate_series(0, 13) as days_ago
  )
  select jsonb_build_object(
    'generatedAt', bounds.now_at,
    'usersTotal', (select count(*) from public.users),
    'usersNew7d', (select count(*) from public.users profile where profile.created_at >= bounds.now_at - interval '7 days'),
    'activeToday', (select count(distinct opens.user_id) from opens where opens.created_at >= bounds.today_at),
    'active7d', (select count(*) from this_week),
    'active30d', (select count(distinct opens.user_id) from opens),
    'notificationOpens7d', (select count(*) from opens
      where opens.source = 'notification' and opens.created_at >= bounds.now_at - interval '7 days'),
    'meetingsTotal', (select count(*) from public.events),
    'meetings7d', (select count(*) from public.events meeting where meeting.created_at >= bounds.now_at - interval '7 days'),
    'responses7d', (select count(*) from answered where answered.created_at >= bounds.now_at - interval '7 days'),
    'joinRequests7d', (select count(*) from public.join_requests request
      where request.created_at >= bounds.now_at - interval '7 days'),
    'shares7d', (select count(*) from public.analytics_events event
      where event.name in ('share_sent', 'share_fallback') and event.created_at >= bounds.now_at - interval '7 days'),
    'returningUsers7d', (select count(*) from previous_week where previous_week.user_id in (select user_id from this_week)),
    'previousWeekUsers', (select count(*) from previous_week),
    'meetings30d', (select count(*) from recent_meetings),
    'meetingsWithResponses30d', (select count(*) from recent_meetings
      where recent_meetings.id in (select answered.event_id from answered)),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'day', to_char((bounds.today_at - make_interval(days => days.days_ago)) at time zone 'Europe/Minsk', 'YYYY-MM-DD'),
        'active', (select count(distinct opens.user_id) from opens
          where opens.created_at >= bounds.today_at - make_interval(days => days.days_ago)
            and opens.created_at < bounds.today_at - make_interval(days => days.days_ago - 1)),
        'meetings', (select count(*) from public.events meeting
          where meeting.created_at >= bounds.today_at - make_interval(days => days.days_ago)
            and meeting.created_at < bounds.today_at - make_interval(days => days.days_ago - 1)),
        'responses', (select count(*) from answered
          where answered.created_at >= bounds.today_at - make_interval(days => days.days_ago)
            and answered.created_at < bounds.today_at - make_interval(days => days.days_ago - 1))
      ) order by days.days_ago desc)
      from days
    )
  )
  from bounds;
$$;

revoke all on function public.record_analytics_event(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.record_analytics_event(text, uuid, text, text) to service_role;
grant execute on function public.admin_stats() to service_role;
