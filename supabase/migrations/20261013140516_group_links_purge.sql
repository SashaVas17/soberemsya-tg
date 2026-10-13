-- Cleanup of expired group links, called daily by pg_cron.
create or replace function public.purge_group_links()
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  delete from public.group_links where expires_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_group_links() from public, anon, authenticated;
grant execute on function public.purge_group_links() to service_role;
