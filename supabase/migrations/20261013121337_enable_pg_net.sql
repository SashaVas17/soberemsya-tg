-- pg_net lets pg_cron call the notifications worker Edge Function.
create extension if not exists pg_net with schema extensions;
