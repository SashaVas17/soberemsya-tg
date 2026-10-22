-- Venues added by hand get a point on the map. The administrator pastes the
-- coordinates copied from a map; the server checks they lie in Belarus.
-- Places imported from OpenStreetMap keep the point OSM gave them.

-- The same as the 7-argument admin_create_venue, plus an optional point.
-- Both coordinates or none (the table checks the pair too). The old function
-- stays for callers not yet updated.
create or replace function public.admin_create_venue(
  p_admin_user_id uuid, p_city_id text, p_category_id text, p_name text,
  p_address text, p_price_level smallint, p_website text,
  p_latitude double precision, p_longitude double precision
)
returns table (venue_id uuid)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception using errcode = 'P0001', message = 'VENUE_POINT_INVALID';
  end if;
  if not exists (select 1 from public.cities c where c.id = p_city_id) then
    raise exception using errcode = 'P0001', message = 'VENUE_CITY_INVALID';
  end if;
  if not exists (select 1 from public.meeting_categories c where c.id = p_category_id and c.is_active) then
    raise exception using errcode = 'P0001', message = 'VENUE_CATEGORY_INVALID';
  end if;
  insert into public.venues (
    city_id, category_id, name, address, latitude, longitude, price_level, website,
    source, status, reviewed_at, reviewed_by_user_id
  )
  values (
    p_city_id, p_category_id, p_name, coalesce(p_address, ''), p_latitude, p_longitude,
    p_price_level, p_website, 'manual', 'published', now(), p_admin_user_id
  )
  returning id into v_id;
  return query select v_id;
end;
$$;

-- Sets or clears (both null) the point of a venue added by hand. An imported
-- venue keeps OSM's point: the next import would overwrite a change anyway.
create or replace function public.admin_set_venue_point(
  p_admin_user_id uuid, p_venue_id uuid,
  p_latitude double precision, p_longitude double precision
)
returns table (venue_id uuid)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
begin
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception using errcode = 'P0001', message = 'VENUE_POINT_INVALID';
  end if;
  update public.venues v
  set latitude = p_latitude,
      longitude = p_longitude,
      reviewed_by_user_id = p_admin_user_id,
      updated_at = now()
  where v.id = p_venue_id and v.source = 'manual';
  if not found then
    raise exception using errcode = 'P0001', message = 'VENUE_NOT_FOUND';
  end if;
  return query select p_venue_id;
end;
$$;

revoke all on function public.admin_create_venue(uuid, text, text, text, text, smallint, text, double precision, double precision) from public, anon, authenticated;
revoke all on function public.admin_set_venue_point(uuid, uuid, double precision, double precision) from public, anon, authenticated;
grant execute on function public.admin_create_venue(uuid, text, text, text, text, smallint, text, double precision, double precision) to service_role;
grant execute on function public.admin_set_venue_point(uuid, uuid, double precision, double precision) to service_role;
