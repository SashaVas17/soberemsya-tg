-- Keep the automatic RLS event-trigger helper unavailable through Data API RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Cover the place_votes foreign key used when deleting or joining place options.
create index if not exists place_votes_place_option_id_idx
  on public.place_votes(place_option_id);
