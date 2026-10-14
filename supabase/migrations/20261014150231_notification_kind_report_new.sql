-- Stage 2.4: reports reach the administrator through the notification outbox.
alter table public.notification_outbox
  drop constraint notification_outbox_kind_check,
  add constraint notification_outbox_kind_check check (kind in (
    'response_each', 'response_summary', 'join_request_new',
    'join_request_approved', 'join_request_rejected', 'event_decided',
    'event_cancelled', 'event_updated', 'event_reopened', 'reminder_24h', 'reminder_2h',
    'report_new'
  ));
