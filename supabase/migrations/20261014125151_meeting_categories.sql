-- Stage 2.2: meeting categories. A meeting may have a category; the open
-- meetings feed filters by it. Categories live in a table rather than a check
-- constraint, so adding one is an insert (no constraint drop needed).

create table if not exists public.meeting_categories (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,31}$'),
  name text not null check (char_length(name) between 1 and 40),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.meeting_categories enable row level security;

revoke all privileges on table public.meeting_categories from public, anon, authenticated;

-- telegram-api reads the list directly; new tables here give the service
-- role no data privileges by default.
grant select on table public.meeting_categories to service_role;

insert into public.meeting_categories (id, name, sort_order) values
  ('coffee', 'Кофе', 10),
  ('bar', 'Бар', 20),
  ('sport', 'Спорт', 30),
  ('boardgames', 'Настолки', 40),
  ('walk', 'Прогулка', 50),
  ('cinema', 'Кино', 60),
  ('concert', 'Концерт', 70),
  ('outdoor', 'Активный отдых', 80),
  ('other', 'Другое', 90)
on conflict (id) do nothing;

-- Optional: existing meetings and meetings created without one have none.
alter table public.events
  add column if not exists category_id text references public.meeting_categories(id);

create index if not exists events_public_feed_category_idx
  on public.events (city_id, category_id, created_at desc, id desc)
  where visibility = 'public' and deleted_at is null and status = 'collecting';

-- Creation with a category: the existing RPCs stay unchanged (older Edge
-- Function versions keep calling them); these wrappers create the meeting and
-- set its category in the same transaction. Updating category_id fires no
-- notification trigger (those watch status, title, description and finals).
create or replace function public.create_event_categorized(
  p_event_id text, p_actor_user_id uuid, p_admin_token text, p_title text,
  p_description text, p_budget_limit integer, p_visibility text,
  p_max_participants integer, p_time_options jsonb, p_place_options jsonb,
  p_category_id text
)
returns table (event_id text)
language plpgsql
security definer set search_path = pg_catalog, public
as $$
begin
  if p_category_id is not null and not exists (
    select 1 from public.meeting_categories c where c.id = p_category_id and c.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_CATEGORY_INVALID';
  end if;
  perform 1 from public.create_event_atomic(p_event_id, p_actor_user_id, p_admin_token,
    p_title, p_description, p_budget_limit, p_visibility, p_max_participants,
    p_time_options, p_place_options);
  if p_category_id is not null then
    update public.events e set category_id = p_category_id where e.id = p_event_id;
  end if;
  return query select p_event_id;
end;
$$;

-- A replay returns the meeting created by the first call and changes nothing,
-- even if its category was deactivated since: rejecting the retry would make
-- the client drop its key and create a duplicate. The request hash covers the
-- category, so the same key with another category is a conflict.
create or replace function public.create_event_idempotent_categorized(
  p_client_request_id uuid, p_request_hash text, p_event_id text, p_actor_user_id uuid,
  p_admin_token text, p_title text, p_description text, p_budget_limit integer,
  p_visibility text, p_max_participants integer, p_time_options jsonb, p_place_options jsonb,
  p_category_id text
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
  from public.create_event_idempotent(p_client_request_id, p_request_hash, p_event_id,
    p_actor_user_id, p_admin_token, p_title, p_description, p_budget_limit, p_visibility,
    p_max_participants, p_time_options, p_place_options) r;
  if not v_replayed and p_category_id is not null then
    if not exists (
      select 1 from public.meeting_categories c where c.id = p_category_id and c.is_active
    ) then
      -- Rolls back the meeting and the key claim made above.
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_CATEGORY_INVALID';
    end if;
    update public.events e set category_id = p_category_id where e.id = v_event_id;
  end if;
  return query select v_event_id, v_replayed;
end;
$$;

revoke all on function public.create_event_categorized(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_event_idempotent_categorized(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_event_categorized(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb, text) to service_role;
grant execute on function public.create_event_idempotent_categorized(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb, text) to service_role;
