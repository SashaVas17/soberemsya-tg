do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'time_options_event_id_id_key'
      and conrelid = 'public.time_options'::regclass
  ) then
    alter table public.time_options
      add constraint time_options_event_id_id_key unique (event_id, id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'place_options_event_id_id_key'
      and conrelid = 'public.place_options'::regclass
  ) then
    alter table public.place_options
      add constraint place_options_event_id_id_key unique (event_id, id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_final_time_option_same_event_fkey'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_final_time_option_same_event_fkey
      foreign key (id, final_time_option_id)
      references public.time_options(event_id, id)
      on delete no action not deferrable;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_final_place_option_same_event_fkey'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_final_place_option_same_event_fkey
      foreign key (id, final_place_id)
      references public.place_options(event_id, id)
      on delete no action not deferrable;
  end if;
end;
$$;
