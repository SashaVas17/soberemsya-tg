import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260822110311_archive_completed_events.sql",
  "utf8",
).replace(/\r\n/g, "\n");
const apiSource = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const cleanup = migration.slice(
  migration.indexOf("create or replace function public.archive_completed_events"),
  migration.indexOf("revoke all on function public.archive_completed_events"),
);
const manageEvent = apiSource.slice(
  apiSource.indexOf("async function updateActiveOwnedEvent"),
  apiSource.indexOf("async function meetings"),
);

describe("completed event auto-archive migration", () => {
  it("uses a hardened internal SECURITY DEFINER function", () => {
    expect(cleanup).toContain("p_limit integer default 100");
    expect(cleanup).toContain("returns integer");
    expect(cleanup).toContain("security definer");
    expect(cleanup).toContain("set search_path = pg_catalog, public");
    for (const role of ["public", "anon", "authenticated"])
      expect(migration).toContain(
        `revoke all on function public.archive_completed_events(integer) from ${role};`,
      );
    expect(migration).toContain(
      "grant execute on function public.archive_completed_events(integer) to service_role;",
    );
  });

  it("does not enable pg_cron or create a scheduler job", () => {
    expect(migration).not.toMatch(/create extension[\s\S]*pg_cron/i);
    expect(migration).not.toContain("cron.schedule");
    expect(migration).not.toContain("pg_cron");
  });

  it("bounds the private batch limit and returns only the archived count", () => {
    expect(cleanup).toContain("p_limit is null or p_limit <= 0 or p_limit > 500");
    expect(cleanup).toContain("ARCHIVE_LIMIT_INVALID");
    expect(cleanup).toContain("return v_archived_count;");
    expect(cleanup).not.toContain("return query");
  });

  it("selects only fully decided, active events whose final rows belong to the event", () => {
    for (const predicate of [
      "event.status = 'decided'",
      "event.deleted_at is null",
      "event.final_time_option_id is not null",
      "event.final_place_id is not null",
      "final_time.id = event.final_time_option_id",
      "final_time.event_id = event.id",
      "final_place.id = event.final_place_id",
      "final_place.event_id = event.id",
      "final_time.starts_at <= now() - interval '12 hours'",
    ]) expect(cleanup).toContain(predicate);
  });

  it("orders, bounds and locks event rows without locking participants or votes", () => {
    expect(cleanup).toContain("order by final_time.starts_at, event.id");
    expect(cleanup).toContain("limit p_limit");
    expect(cleanup).toContain("for update of event skip locked");
    for (const table of ["participants", "availability_votes", "place_votes", "join_requests"])
      expect(cleanup).not.toContain(`public.${table}`);
  });

  it("rechecks eligibility and soft-deletes only the selected event rows", () => {
    const update = cleanup.slice(cleanup.indexOf("update public.events as event"));
    expect(update).toContain("set deleted_at = now()");
    expect(update).toContain("event.status = 'decided'");
    expect(update).toContain("event.deleted_at is null");
    expect(update).toContain("exists (");
    expect(update).not.toMatch(/delete\s+from\s+public\.events/i);
    expect(cleanup).not.toMatch(/delete\s+from\s+public\.(participants|availability_votes|place_votes|join_requests)/i);
  });

  it("uses server-side timestamptz comparison and remains idempotent", () => {
    expect(cleanup).toContain("now() - interval '12 hours'");
    expect(cleanup).toContain("and event.deleted_at is null");
    expect(cleanup).toContain("if found then\n      v_archived_count := v_archived_count + 1;");
  });
});

describe("manage event archive race hardening", () => {
  it("makes every final event update conditional on an active owned event", () => {
    expect(manageEvent).toContain('.eq("owner_user_id", ownerUserId)');
    expect(manageEvent).toContain('.is("deleted_at", null)');
    expect(manageEvent).toContain('.select("id")');
    expect(manageEvent).toContain(".maybeSingle()");
    expect(manageEvent).toContain("if (!data) throw unavailableManagedEventError()");
  });

  it("keeps management actions and deletion on the existing API path", () => {
    for (const action of ["update_details", "close", "reopen", "decide"])
      expect(manageEvent).toContain(`case "${action}"`);
    expect(manageEvent).toContain("await updateActiveOwnedEvent(eventId, auth.user.id");
    expect(manageEvent).toContain("return json({ deleted: true });");
    expect(apiSource).toContain('db.rpc("remove_event_participant"');
    expect(apiSource).toContain('db.rpc("save_event_response"');
  });

  it("leaves frontend, feed, direct fetch and calendar flows out of the change", () => {
    expect(apiSource).toContain("async function publicEvents");
    expect(apiSource).toContain("async function calendarLink");
    expect(apiSource).toContain("async function calendarDownload");
    expect(apiSource).toContain('.is("deleted_at", null).maybeSingle<FullEventRow>()');
  });
});
