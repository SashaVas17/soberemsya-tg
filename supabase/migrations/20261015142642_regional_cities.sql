-- Stage 4: regional centres. The administrator fills a city's catalog while
-- the city is still closed, then opens it from «Каталог мест».

-- A venue added by hand may belong to a closed city: its catalog is filled
-- before the city opens. The city must still exist.
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
  if not exists (select 1 from public.cities c where c.id = p_city_id) then
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

-- Opens or closes a city. Minsk is the default city of everyone who has not
-- chosen one, so it stays open. Users and meetings of a closed city keep it;
-- their city reads as Minsk until it opens again.
create or replace function public.admin_set_city_active(p_city_id text, p_is_active boolean)
returns table (city_id text, is_active boolean)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
begin
  if p_city_id = 'minsk' and not p_is_active then
    raise exception using errcode = 'P0001', message = 'CITY_DEFAULT_REQUIRED';
  end if;
  return query
  update public.cities c
  set is_active = p_is_active
  where c.id = p_city_id
  returning c.id, c.is_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'CITY_INVALID';
  end if;
end;
$$;

revoke all on function public.admin_set_city_active(text, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_city_active(text, boolean) to service_role;
