-- Stage 2.3: venue catalogue. Venues are imported from OpenStreetMap (ODbL,
-- attribution in the app) or added by hand; the administrator curates them:
-- an imported venue stays "pending" until published. People see published
-- venues of active categories in their city in «Куда сходить» and in the
-- «Где?» step of the creation wizard. Venues are never deleted, only hidden.

-- Restaurants are the most common kind of meeting place and fit no existing
-- category. Adding a category is an insert (see meeting_categories).
insert into public.meeting_categories (id, name, sort_order) values
  ('food', 'Ресторан', 15)
on conflict (id) do nothing;

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  city_id text not null references public.cities(id),
  category_id text not null references public.meeting_categories(id),
  name text not null check (char_length(name) between 1 and 120),
  address text not null default '' check (char_length(address) <= 200),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  -- 1: до 20 BYN, 2: 20–50 BYN, 3: от 50 BYN per person; set by the curator.
  price_level smallint check (price_level between 1 and 3),
  website text check (website is null or (char_length(website) <= 300 and website ~ '^https?://')),
  opening_hours text check (opening_hours is null or char_length(opening_hours) <= 200),
  source text not null check (source in ('osm', 'manual')),
  osm_type text check (osm_type in ('node', 'way', 'relation')),
  osm_id bigint check (osm_id > 0),
  status text not null default 'pending' check (status in ('pending', 'published', 'hidden')),
  -- A curated pick, listed first. Paid promotion, if it comes, gets its own
  -- table and does not reuse this flag.
  featured boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venues_coordinates_pair check ((latitude is null) = (longitude is null)),
  constraint venues_osm_source check ((source = 'osm') = (osm_type is not null and osm_id is not null)),
  constraint venues_osm_key unique (osm_type, osm_id)
);

alter table public.venues enable row level security;

revoke all privileges on table public.venues from public, anon, authenticated;

-- telegram-api lists venues directly; changes go through the RPCs below.
grant select on table public.venues to service_role;

create index if not exists venues_published_idx
  on public.venues (city_id, category_id, featured desc, name, id)
  where status = 'published';

create index if not exists venues_curation_idx
  on public.venues (city_id, status, category_id, name, id);

create index if not exists venues_reviewed_by_user_id_idx
  on public.venues (reviewed_by_user_id) where reviewed_by_user_id is not null;

-- OSM import: inserts new venues as pending and refreshes the OSM fields of
-- known ones. The curator's choices (status, category, price, featured) are
-- kept. Rows whose OSM fields did not change are left untouched.
create or replace function public.admin_import_venues(p_city_id text, p_items jsonb)
returns table (inserted integer, updated integer)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_inserted integer;
  v_updated integer;
begin
  if not exists (select 1 from public.cities c where c.id = p_city_id) then
    raise exception using errcode = 'P0001', message = 'VENUE_CITY_INVALID';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 1000
    or exists (select 1 from jsonb_array_elements(p_items) item where jsonb_typeof(item) <> 'object') then
    raise exception using errcode = 'P0001', message = 'VENUE_IMPORT_INVALID';
  end if;

  with incoming as (
    select distinct on (item.osm_type, item.osm_id) item.*
    from jsonb_to_recordset(p_items) as item(
      osm_type text, osm_id bigint, category_id text, name text, address text,
      latitude double precision, longitude double precision, website text, opening_hours text
    )
    order by item.osm_type, item.osm_id
  ), upserted as (
    insert into public.venues as v (
      city_id, category_id, name, address, latitude, longitude, website, opening_hours,
      source, osm_type, osm_id
    )
    select p_city_id, i.category_id, i.name, coalesce(i.address, ''), i.latitude, i.longitude,
      i.website, i.opening_hours, 'osm', i.osm_type, i.osm_id
    from incoming i
    on conflict on constraint venues_osm_key do update
    set name = excluded.name,
        address = excluded.address,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        website = excluded.website,
        opening_hours = excluded.opening_hours,
        updated_at = now()
    where (v.name, v.address, v.latitude, v.longitude, v.website, v.opening_hours)
      is distinct from (excluded.name, excluded.address, excluded.latitude, excluded.longitude,
        excluded.website, excluded.opening_hours)
    returning (v.xmax = 0) as is_new
  )
  select count(*) filter (where u.is_new), count(*) filter (where not u.is_new)
  into v_inserted, v_updated
  from upserted u;

  return query select v_inserted, v_updated;
end;
$$;

-- A venue the curator adds by hand is published at once.
create or replace function public.admin_create_venue(
  p_admin_user_id uuid, p_city_id text, p_category_id text, p_name text,
  p_address text, p_price_level smallint, p_website text
)
returns table (venue_id uuid)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.cities c where c.id = p_city_id and c.is_active) then
    raise exception using errcode = 'P0001', message = 'VENUE_CITY_INVALID';
  end if;
  if not exists (select 1 from public.meeting_categories c where c.id = p_category_id and c.is_active) then
    raise exception using errcode = 'P0001', message = 'VENUE_CATEGORY_INVALID';
  end if;
  insert into public.venues (
    city_id, category_id, name, address, price_level, website, source, status,
    reviewed_at, reviewed_by_user_id
  )
  values (
    p_city_id, p_category_id, p_name, coalesce(p_address, ''), p_price_level, p_website,
    'manual', 'published', now(), p_admin_user_id
  )
  returning id into v_id;
  return query select v_id;
end;
$$;

-- Sets the curated fields of one venue. Only a new category must be active:
-- a venue left in a deactivated category can still be hidden or edited.
create or replace function public.admin_update_venue(
  p_admin_user_id uuid, p_venue_id uuid, p_status text, p_category_id text,
  p_price_level smallint, p_featured boolean
)
returns table (venue_id uuid)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.venues v where v.id = p_venue_id and v.category_id = p_category_id
  ) and not exists (
    select 1 from public.meeting_categories c where c.id = p_category_id and c.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'VENUE_CATEGORY_INVALID';
  end if;
  update public.venues v
  set status = p_status,
      category_id = p_category_id,
      price_level = p_price_level,
      featured = p_featured,
      reviewed_at = now(),
      reviewed_by_user_id = p_admin_user_id,
      updated_at = now()
  where v.id = p_venue_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'VENUE_NOT_FOUND';
  end if;
  return query select p_venue_id;
end;
$$;

-- Publishes the listed pending venues; others are skipped.
create or replace function public.admin_publish_venues(p_admin_user_id uuid, p_venue_ids uuid[])
returns table (published integer)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if p_venue_ids is null or cardinality(p_venue_ids) > 200 then
    raise exception using errcode = 'P0001', message = 'VENUE_IMPORT_INVALID';
  end if;
  update public.venues v
  set status = 'published', reviewed_at = now(), reviewed_by_user_id = p_admin_user_id, updated_at = now()
  where v.id = any(p_venue_ids) and v.status = 'pending';
  get diagnostics v_count = row_count;
  return query select v_count;
end;
$$;

revoke all on function public.admin_import_venues(text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_create_venue(uuid, text, text, text, text, smallint, text) from public, anon, authenticated;
revoke all on function public.admin_update_venue(uuid, uuid, text, text, smallint, boolean) from public, anon, authenticated;
revoke all on function public.admin_publish_venues(uuid, uuid[]) from public, anon, authenticated;

grant execute on function public.admin_import_venues(text, jsonb) to service_role;
grant execute on function public.admin_create_venue(uuid, text, text, text, text, smallint, text) to service_role;
grant execute on function public.admin_update_venue(uuid, uuid, text, text, smallint, boolean) to service_role;
grant execute on function public.admin_publish_venues(uuid, uuid[]) to service_role;
