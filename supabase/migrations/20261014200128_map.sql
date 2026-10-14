-- Stage 4: map of venues and open meetings. A place option chosen from the
-- venue catalogue keeps a link to its venue, so an open meeting can be put on
-- the map at that venue. Meetings without such a place are not on the map.

alter table public.place_options
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

create index if not exists place_options_venue_id_idx
  on public.place_options (venue_id) where venue_id is not null;

-- Links the new meeting's place options to published venues of its city.
-- p_place_venues maps a place option id to a venue id. An unknown,
-- unpublished or foreign-city venue is skipped: the link only places the
-- meeting on the map and must not fail its creation.
create or replace function public.link_place_venues(p_event_id text, p_place_venues jsonb)
returns void
language sql
security definer set search_path = pg_catalog, public
as $$
  update public.place_options po
  set venue_id = v.id
  from jsonb_each_text(
      case when jsonb_typeof(p_place_venues) = 'object' then p_place_venues else '{}'::jsonb end
    ) link, public.venues v, public.events e
  where po.event_id = p_event_id
    and po.id = link.key
    and v.id::text = lower(link.value)
    and v.status = 'published'
    and e.id = p_event_id
    and v.city_id = e.city_id;
$$;

-- Creation with venue links: the categorized wrappers (bans, limits,
-- category) and the links in one transaction. Older Edge Function versions
-- keep calling the categorized wrappers directly.
create or replace function public.create_event_with_venues(
  p_event_id text, p_actor_user_id uuid, p_admin_token text, p_title text,
  p_description text, p_budget_limit integer, p_visibility text,
  p_max_participants integer, p_time_options jsonb, p_place_options jsonb,
  p_category_id text, p_place_venues jsonb
)
returns table (event_id text)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
begin
  perform 1 from public.create_event_categorized(p_event_id, p_actor_user_id, p_admin_token,
    p_title, p_description, p_budget_limit, p_visibility, p_max_participants,
    p_time_options, p_place_options, p_category_id);
  perform public.link_place_venues(p_event_id, p_place_venues);
  return query select p_event_id;
end;
$$;

-- A replay returns the first meeting unchanged; links are set only once.
create or replace function public.create_event_idempotent_with_venues(
  p_client_request_id uuid, p_request_hash text, p_event_id text, p_actor_user_id uuid,
  p_admin_token text, p_title text, p_description text, p_budget_limit integer,
  p_visibility text, p_max_participants integer, p_time_options jsonb, p_place_options jsonb,
  p_category_id text, p_place_venues jsonb
)
returns table (event_id text, replayed boolean)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_event_id text;
  v_replayed boolean;
begin
  select r.event_id, r.replayed into v_event_id, v_replayed
  from public.create_event_idempotent_categorized(p_client_request_id, p_request_hash,
    p_event_id, p_actor_user_id, p_admin_token, p_title, p_description, p_budget_limit,
    p_visibility, p_max_participants, p_time_options, p_place_options, p_category_id) r;
  if not v_replayed then
    perform public.link_place_venues(v_event_id, p_place_venues);
  end if;
  return query select v_event_id, v_replayed;
end;
$$;

-- Map points of a city in one row (PostgREST caps row counts, not a jsonb
-- value). Venues: published ones with coordinates, as compact
-- [id, latitude, longitude, category_id, featured] tuples. Meetings: open
-- meetings the viewer may see in the feed (same rules as public_feed_page;
-- a meeting of a deactivated category is left out like its venues)
-- that have a place linked to a venue with coordinates; the decided place
-- wins, otherwise the first linked one.
create or replace function public.public_map_points(
  p_viewer_user_id uuid, p_city_id text, p_category_id text, p_category_ids text[]
)
returns jsonb
language sql stable
security definer set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'venues', coalesce((
      select jsonb_agg(jsonb_build_array(v.id, v.latitude, v.longitude, v.category_id, v.featured)
        order by v.featured desc, v.id)
      from (
        select v.id, v.latitude, v.longitude, v.category_id, v.featured
        from public.venues v
        where v.city_id = p_city_id
          and v.status = 'published'
          and v.latitude is not null
          and v.category_id = any(p_category_ids)
          and (p_category_id is null or v.category_id = p_category_id)
        order by v.featured desc, v.id
        limit 3000
      ) v
    ), '[]'::jsonb),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id, 'title', m.title, 'categoryId', m.category_id,
          'latitude', m.latitude, 'longitude', m.longitude, 'venueName', m.venue_name,
          'startsAt', m.starts_at)
        order by m.created_at desc, m.id desc)
      from (
        select e.id, e.title, e.category_id, e.created_at, place.latitude, place.longitude,
          place.name as venue_name,
          (select min(t.starts_at) from public.time_options t
            where t.event_id = e.id and t.starts_at >= now()) as starts_at
        from public.events e
        cross join lateral (
          select v.latitude, v.longitude, v.name
          from public.place_options po
          join public.venues v on v.id = po.venue_id
          where po.event_id = e.id and v.latitude is not null
          order by (po.id = e.final_place_id) desc, po.id
          limit 1
        ) place
        where e.city_id = p_city_id
          -- Starts from the few places linked to a venue (partial index), not
          -- from every open meeting of the city.
          and e.id in (select po.event_id from public.place_options po where po.venue_id is not null)
          and e.visibility = 'public'
          and e.deleted_at is null
          and e.hidden_at is null
          and e.status = 'collecting'
          and (e.category_id is null or e.category_id = any(p_category_ids))
          and (p_category_id is null or e.category_id = p_category_id)
          and not exists (
            select 1 from public.user_blocks b
            where (b.blocker_user_id = p_viewer_user_id and b.blocked_user_id = e.owner_user_id)
               or (b.blocker_user_id = e.owner_user_id and b.blocked_user_id = p_viewer_user_id)
          )
        order by e.created_at desc, e.id desc
        limit 500
      ) m
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.link_place_venues(text, jsonb) from public, anon, authenticated;
revoke all on function public.create_event_with_venues(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_event_idempotent_with_venues(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.public_map_points(uuid, text, text, text[]) from public, anon, authenticated;

grant execute on function public.create_event_with_venues(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb, text, jsonb) to service_role;
grant execute on function public.create_event_idempotent_with_venues(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb, text, jsonb) to service_role;
grant execute on function public.public_map_points(uuid, text, text, text[]) to service_role;
