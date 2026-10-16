-- Daily cleanup of analytics events older than 400 days.
select cron.schedule(
  'purge-analytics-events-daily',
  '41 3 * * *',
  'SELECT public.purge_analytics_events();'
);
