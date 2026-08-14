-- Edge Functions authenticate Telegram initData and use the server-only service role.
-- RLS remains enabled; service_role bypasses policies but needs table privileges.
grant select, insert, update, delete on table
  public.users,
  public.events,
  public.time_options,
  public.place_options,
  public.participants,
  public.availability_votes
to service_role;
