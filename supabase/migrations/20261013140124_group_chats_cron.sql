-- Daily cleanup of expired group links and old delivered group messages.
select cron.schedule(
  'purge-group-data-daily',
  '37 3 * * *',
  'SELECT public.purge_group_data();'
);
