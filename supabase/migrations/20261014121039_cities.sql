-- Stage 2.1: cities. A meeting and a user belong to a city; the open meetings
-- feed shows the viewer's city, and times are shown in the city's time zone.
-- Only Minsk is active for now; the regional centres open in Stage 4.
-- Cities are never deleted, only deactivated.

create table if not exists public.cities (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,31}$'),
  name text not null check (char_length(name) between 1 and 80),
  timezone text not null,
  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.cities enable row level security;

revoke all privileges on table public.cities from public, anon, authenticated;

insert into public.cities (id, name, timezone, is_active, sort_order) values
  ('minsk', 'Минск', 'Europe/Minsk', true, 10),
  ('brest', 'Брест', 'Europe/Minsk', false, 20),
  ('vitebsk', 'Витебск', 'Europe/Minsk', false, 30),
  ('gomel', 'Гомель', 'Europe/Minsk', false, 40),
  ('grodno', 'Гродно', 'Europe/Minsk', false, 50),
  ('mogilev', 'Могилёв', 'Europe/Minsk', false, 60)
on conflict (id) do nothing;

-- The user's chosen city; null means not chosen yet and reads as Minsk.
alter table public.users
  add column if not exists city_id text references public.cities(id);

-- Every meeting has a city; existing meetings are in Minsk. No column
-- default: the trigger below fills a missing city, so an explicit one wins.
alter table public.events
  add column if not exists city_id text references public.cities(id);

update public.events set city_id = 'minsk' where city_id is null;

alter table public.events alter column city_id set not null;

create index if not exists events_public_feed_city_idx
  on public.events (city_id, created_at desc, id desc)
  where visibility = 'public' and deleted_at is null and status = 'collecting';

-- A new meeting without a city takes its organizer's active city, otherwise
-- Minsk. Creation RPCs stay unchanged, so older Edge Function versions keep
-- working; a later RPC can pass a city explicitly.
create or replace function public.set_event_city_from_owner()
returns trigger
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_city_id text;
begin
  if new.city_id is not null then
    return new;
  end if;
  if new.owner_user_id is not null then
    select u.city_id
      into v_city_id
      from public.users u
      join public.cities c on c.id = u.city_id and c.is_active
     where u.id = new.owner_user_id;
  end if;
  new.city_id := coalesce(v_city_id, 'minsk');
  return new;
end;
$$;

revoke all on function public.set_event_city_from_owner() from public, anon, authenticated;

create or replace trigger events_set_city_from_owner
  before insert on public.events
  for each row execute function public.set_event_city_from_owner();
