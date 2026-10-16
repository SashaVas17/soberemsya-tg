-- Daily cleanup of idempotency keys older than 30 days.
create or replace function public.purge_event_creation_requests()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  delete from public.event_creation_requests
  where created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_event_creation_requests() from public;
revoke all on function public.purge_event_creation_requests() from anon;
revoke all on function public.purge_event_creation_requests() from authenticated;

select cron.schedule(
  'purge-event-creation-requests-daily',
  '17 3 * * *',
  'SELECT public.purge_event_creation_requests();'
);
