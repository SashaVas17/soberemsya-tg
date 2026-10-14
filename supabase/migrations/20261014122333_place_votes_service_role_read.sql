-- telegram-api reads place votes when it builds a meeting with participants;
-- restore_service_role_crud missed this table, so the read was denied.
-- Writes go through security definer RPCs, so only reads are granted.
grant select on table public.place_votes to service_role;
