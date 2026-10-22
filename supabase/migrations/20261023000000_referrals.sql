-- Referral links (plan «Привлечение аудитории»): a meeting link shared by a
-- person carries their code, event_<id>__r<code> (format also in
-- _shared/domain.ts and src/meeting-links.ts). A person whose account is
-- made by opening such a link is attributed to the one who shared it, once.
-- The code is random: it holds neither the Telegram ID nor the name, though
-- links from one person share it. Who invited whom is seen only by
-- administrators in the statistics.

alter table public.users
  add column if not exists referral_code text
    check (referral_code is null or referral_code ~ '^[0-9a-f]{12}$'),
  add column if not exists referred_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists referred_at timestamptz;

create unique index if not exists users_referral_code_key on public.users (referral_code);
create index if not exists users_referred_by_idx
  on public.users (referred_by_user_id, referred_at)
  where referred_by_user_id is not null;

-- The person's code, made on first use. Concurrent calls for one person wait
-- on the row and return the same code.
create or replace function public.ensure_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_code text;
begin
  select profile.referral_code into v_code from public.users profile where profile.id = p_user_id;
  if v_code is not null then
    return v_code;
  end if;
  for attempt in 1..5 loop
    begin
      update public.users
      set referral_code = encode(extensions.gen_random_bytes(6), 'hex')
      where id = p_user_id and referral_code is null
      returning referral_code into v_code;
      if not found then
        select profile.referral_code into v_code from public.users profile where profile.id = p_user_id;
      end if;
      return v_code;
    exception when unique_violation then
      -- Another person already has this code: draw again.
    end;
  end loop;
  raise exception using errcode = 'P0001', message = 'REFERRAL_CODE_UNAVAILABLE';
end;
$$;

-- Attributes a person to the code's owner, once, on the sign-in that made
-- their account (users are made only at sign-in; ten minutes cover retries).
-- The inviter must have joined earlier, so nobody invites themselves or the
-- person who invited them.
create or replace function public.record_referral(p_user_id uuid, p_code text)
returns boolean
language plpgsql
security definer set search_path = pg_catalog, public
as $$
begin
  if p_code is null or p_code !~ '^[0-9a-f]{12}$' then
    return false;
  end if;
  update public.users invitee
  set referred_by_user_id = inviter.id, referred_at = now()
  from public.users inviter
  where invitee.id = p_user_id
    and invitee.referred_by_user_id is null
    and invitee.created_at >= now() - interval '10 minutes'
    and inviter.referral_code = p_code
    and inviter.id <> invitee.id
    and inviter.created_at < invitee.created_at;
  return found;
end;
$$;

-- Invitations for the statistics screen and /stats: people who came by a
-- link in 7 and 30 days and who brought the most in 30 days.
create or replace function public.admin_referral_stats()
returns jsonb
language sql stable
security definer set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'invited7d', (select count(*) from public.users invitee
      where invitee.referred_at >= now() - interval '7 days'),
    'invited30d', (select count(*) from public.users invitee
      where invitee.referred_at >= now() - interval '30 days'),
    'topInviters', coalesce((
      select jsonb_agg(jsonb_build_object('name', top.name, 'username', top.username, 'invited', top.invited)
        order by top.invited desc, top.name)
      from (
        select inviter.first_name as name, inviter.username, count(*) as invited
        from public.users invitee
        join public.users inviter on inviter.id = invitee.referred_by_user_id
        where invitee.referred_at >= now() - interval '30 days'
        group by inviter.id, inviter.first_name, inviter.username
        order by invited desc, inviter.first_name
        limit 5
      ) top
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.ensure_referral_code(uuid) from public, anon, authenticated;
revoke all on function public.record_referral(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_referral_stats() from public, anon, authenticated;
grant execute on function public.ensure_referral_code(uuid) to service_role;
grant execute on function public.record_referral(uuid, text) to service_role;
grant execute on function public.admin_referral_stats() to service_role;
