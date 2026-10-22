-- The point of a venue is checked in the database too, not only in the Edge
-- Function: Belarus with a margin (the same bounds as POINT_BOUNDS in
-- supabase/functions/_shared/venues.ts and src/coordinates.ts).

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
  if (p_latitude is null) <> (p_longitude is null)
     or p_latitude not between 51.0 and 56.5
     or p_longitude not between 23.0 and 33.0 then
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

create or replace function public.admin_set_venue_point(
  p_admin_user_id uuid, p_venue_id uuid,
  p_latitude double precision, p_longitude double precision
)
returns table (venue_id uuid)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
begin
  if (p_latitude is null) <> (p_longitude is null)
     or p_latitude not between 51.0 and 56.5
     or p_longitude not between 23.0 and 33.0 then
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
