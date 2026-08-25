create or replace function public.ensure_telegram_user(
  p_telegram_user_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_language_code text,
  p_photo_url text
)
returns table (
  id uuid,
  telegram_user_id text,
  username text,
  first_name text,
  last_name text,
  photo_url text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user public.users%rowtype;
begin
  insert into public.users (
    telegram_user_id,
    username,
    first_name,
    last_name,
    language_code,
    photo_url
  )
  values (
    p_telegram_user_id,
    p_username,
    p_first_name,
    p_last_name,
    p_language_code,
    p_photo_url
  )
  on conflict on constraint users_telegram_user_id_key do nothing
  returning * into v_user;

  if not found then
    select *
    into v_user
    from public.users as user_profile
    where user_profile.telegram_user_id = p_telegram_user_id
    for update;

    if v_user.username is distinct from p_username
      or v_user.first_name is distinct from p_first_name
      or v_user.last_name is distinct from p_last_name
      or v_user.language_code is distinct from p_language_code
      or v_user.photo_url is distinct from p_photo_url then
      update public.users as user_profile
      set username = p_username,
          first_name = p_first_name,
          last_name = p_last_name,
          language_code = p_language_code,
          photo_url = p_photo_url,
          updated_at = now()
      where user_profile.id = v_user.id
      returning * into v_user;
    end if;
  end if;

  return query
  select
    v_user.id,
    v_user.telegram_user_id::text,
    v_user.username,
    v_user.first_name,
    v_user.last_name,
    v_user.photo_url;
end;
$$;

revoke all on function public.ensure_telegram_user(bigint, text, text, text, text, text) from public;
revoke all on function public.ensure_telegram_user(bigint, text, text, text, text, text) from anon;
revoke all on function public.ensure_telegram_user(bigint, text, text, text, text, text) from authenticated;
grant execute on function public.ensure_telegram_user(bigint, text, text, text, text, text)
  to service_role;
