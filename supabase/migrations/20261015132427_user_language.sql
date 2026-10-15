-- English version, step 2: the language a person chose in the app settings.
-- Empty means «as in Telegram»: the bot and notifications then follow
-- users.language_code. Requests from the app carry their language
-- themselves; this column is for messages sent outside a request.

alter table public.users
  add column if not exists language text check (language in ('ru', 'en'));

-- Saves the choice; null returns to «as in Telegram».
create or replace function public.set_user_language(p_user_id uuid, p_language text)
returns text
language sql
security definer set search_path = pg_catalog, public
as $$
  update public.users
  set language = p_language, updated_at = now()
  where id = p_user_id
  returning language;
$$;

revoke all on function public.set_user_language(uuid, text) from public, anon, authenticated;
grant execute on function public.set_user_language(uuid, text) to service_role;
