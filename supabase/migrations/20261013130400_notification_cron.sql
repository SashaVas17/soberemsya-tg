-- Every minute: queue due reminders/summaries, then let the worker deliver.
-- The worker secret is read from Vault at call time and never stored here.
select cron.schedule(
  'enqueue-due-notifications',
  '* * * * *',
  'SELECT public.enqueue_due_notifications();'
);

select cron.schedule(
  'notifications-worker',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://qesuhhhiswwrfvfisfkp.supabase.co/functions/v1/notifications-worker',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);

select cron.schedule(
  'purge-notification-outbox-daily',
  '23 3 * * *',
  'SELECT public.purge_notification_outbox();'
);
