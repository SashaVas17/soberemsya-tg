-- Releases a key whose event was soft-deleted, so a retry of the same draft
-- creates a new event instead of replaying a deleted one.
create or replace function public.release_deleted_event_creation_key(
  p_owner_user_id uuid, p_client_request_id uuid
)
returns void
language sql security definer set search_path = pg_catalog, public
as $$
  delete from public.event_creation_requests r using public.events e
  where r.owner_user_id = p_owner_user_id and r.client_request_id = p_client_request_id
    and e.id = r.event_id and e.deleted_at is not null;
$$;

-- Claims the key, then creates the event via create_event_atomic in the same
-- transaction; a same-key retry replays the event, a different payload is 409.
create or replace function public.create_event_idempotent(
  p_client_request_id uuid, p_request_hash text, p_event_id text, p_actor_user_id uuid,
  p_admin_token text, p_title text, p_description text, p_budget_limit integer,
  p_visibility text, p_max_participants integer, p_time_options jsonb, p_place_options jsonb
)
returns table (event_id text, replayed boolean)
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_event_id text := btrim(coalesce(p_event_id, ''));
  v_claimed text;
  v_existing text;
  v_hash text;
begin
  if p_client_request_id is null or p_request_hash is null
    or p_request_hash !~ '^[0-9a-f]{64}$' or v_event_id = '' then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_INPUT_INVALID';
  end if;
  if p_actor_user_id is null
    or not exists (select 1 from public.users u where u.id = p_actor_user_id) then
    raise exception using errcode = 'P0001', message = 'CREATE_EVENT_ACTOR_INVALID';
  end if;
  perform public.release_deleted_event_creation_key(p_actor_user_id, p_client_request_id);
  -- A concurrent same-key caller blocks on the primary key until we finish.
  insert into public.event_creation_requests (owner_user_id, client_request_id, request_hash, event_id)
  values (p_actor_user_id, p_client_request_id, p_request_hash, v_event_id)
  on conflict on constraint event_creation_requests_pkey do nothing
  returning event_creation_requests.event_id into v_claimed;
  if v_claimed is null then
    select r.event_id, r.request_hash into v_existing, v_hash
    from public.event_creation_requests r
    where r.owner_user_id = p_actor_user_id and r.client_request_id = p_client_request_id;
    if v_existing is null then
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_INPUT_INVALID';
    end if;
    if v_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'CREATE_EVENT_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing, true;
    return;
  end if;
  perform 1 from public.create_event_atomic(v_event_id, p_actor_user_id, p_admin_token,
    p_title, p_description, p_budget_limit, p_visibility, p_max_participants,
    p_time_options, p_place_options);
  return query select v_event_id, false;
end;
$$;

revoke all on function public.release_deleted_event_creation_key(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_event_idempotent(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_event_idempotent(uuid, text, text, uuid, text, text, text, integer, text, integer, jsonb, jsonb) to service_role;
