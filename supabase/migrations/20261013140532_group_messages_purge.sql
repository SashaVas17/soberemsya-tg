-- Cleanup of old delivered group messages; purge_group_data() runs both
-- cleanups for the daily pg_cron job.
create or replace function public.purge_group_messages()
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  delete from public.group_message_outbox
  where status in ('sent', 'skipped', 'failed') and created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.purge_group_data()
returns integer
language sql security definer set search_path = pg_catalog, public
as $$
  select public.purge_group_links() + public.purge_group_messages();
$$;

revoke all on function public.purge_group_messages() from public, anon, authenticated;
revoke all on function public.purge_group_data() from public, anon, authenticated;
grant execute on function public.purge_group_messages() to service_role;
grant execute on function public.purge_group_data() to service_role;
