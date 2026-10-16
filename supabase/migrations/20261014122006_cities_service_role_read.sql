-- Edge Functions read the cities directory through the service role; in this
-- project table privileges are granted explicitly (see restore_service_role_crud).
-- Only reads: the owner manages cities by hand.
grant select on table public.cities to service_role;
