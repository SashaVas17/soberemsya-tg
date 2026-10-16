select cron.schedule(
  'archive-completed-events-hourly',
  '54 * * * *',
  'SELECT public.archive_completed_events();'
);
