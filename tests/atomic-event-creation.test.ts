import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  eventCreationErrorToken,
  eventCreationHttpError,
} from "../supabase/functions/_shared/event-creation";
import { errorResponse } from "../supabase/functions/_shared/http";

const migrationPath =
  "supabase/migrations/20260825192358_atomic_event_creation.sql";
const migration = readFileSync(migrationPath, "utf8");
const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const createEvent = api.slice(
  api.indexOf("async function createEvent"),
  api.indexOf("async function createJoinRequest"),
);
const createRpc = migration.slice(
  migration.indexOf("create or replace function public.create_event_atomic"),
  migration.indexOf("revoke all on function public.create_event_atomic"),
);
const signature =
  "public.create_event_atomic(text, uuid, text, text, text, integer, text, integer, jsonb, jsonb)";

function expectHardenedRpc() {
  expect(createRpc).toContain("security definer");
  expect(createRpc).toContain("set search_path = pg_catalog, public");
  for (const role of ["public", "anon", "authenticated"])
    expect(migration).toContain(`revoke all on function ${signature} from ${role};`);
  expect(migration).toContain(`grant execute on function ${signature}\n  to service_role;`);
}

describe("atomic event creation migration", () => {
  it("adds exactly one focused migration and leaves the prior final-option migration canonical", () => {
    const migrations = readdirSync("supabase/migrations");
    expect(migrations.filter((name) => name.includes("atomic_event_creation")))
      .toEqual(["20260825192358_atomic_event_creation.sql"]);
    expect(readFileSync(
      "supabase/migrations/20260825173426_protect_final_event_options.sql",
      "utf8",
    )).toContain("events_final_time_option_same_event_fkey");
  });

  it("defines the narrow service-role-only create RPC", () => {
    for (const parameter of [
      "p_event_id text",
      "p_actor_user_id uuid",
      "p_admin_token text",
      "p_title text",
      "p_description text",
      "p_budget_limit integer",
      "p_visibility text",
      "p_max_participants integer",
      "p_time_options jsonb",
      "p_place_options jsonb",
    ]) expect(createRpc).toContain(parameter);
    expect(createRpc).toContain("returns table (event_id text)");
    expectHardenedRpc();
    expect(createRpc).not.toContain("p_owner_user_id");
    expect(createRpc).not.toContain("p_final_time_option_id");
    expect(createRpc).not.toContain("p_final_place_id");
    expect(createRpc).not.toContain("p_status");
    expect(createRpc).not.toContain("p_deleted_at");
  });

  it("uses the verified actor as the event owner and keeps final fields at database defaults", () => {
    expect(createRpc).toContain("where user_profile.id = p_actor_user_id");
    const eventInsert = createRpc.slice(
      createRpc.indexOf("insert into public.events"),
      createRpc.indexOf("insert into public.time_options"),
    );
    expect(eventInsert).toContain("owner_user_id");
    expect(eventInsert).toContain("p_actor_user_id");
    expect(eventInsert).not.toContain("final_time_option_id");
    expect(eventInsert).not.toContain("final_place_id");
    expect(eventInsert).not.toContain("status,");
  });

  it("validates scalar fields and preserves current visibility/capacity rules", () => {
    expect(createRpc).toContain("length(v_title) > 200");
    expect(createRpc).toContain("length(v_description) > 4000");
    expect(createRpc).toContain("p_budget_limit is null or p_budget_limit < 0");
    expect(createRpc).toContain("p_visibility is null or p_visibility not in ('private', 'public')");
    expect(createRpc).toContain("p_visibility = 'private' and p_max_participants is not null");
    expect(createRpc).toContain("p_max_participants < 2 or p_max_participants > 50");
  });

  it("defense-in-depth validates normalized time JSON before inserting it", () => {
    expect(createRpc).toContain("jsonb_typeof(p_time_options) <> 'array'");
    expect(createRpc).toContain("jsonb_array_length(p_time_options) = 0");
    expect(createRpc).toContain("jsonb_array_length(p_time_options) > 50");
    expect(createRpc).toContain("jsonb_typeof(v_time_option) <> 'object'");
    expect(createRpc).toContain("v_time_option ->> 'id'");
    expect(createRpc).toContain("v_time_option ->> 'startsAt'");
    expect(createRpc).toContain("v_time_option_id = any(v_time_option_ids)");
    expect(createRpc).toContain("v_time_starts_at_text::timestamptz");
    expect(createRpc).toContain("when invalid_datetime_format or datetime_field_overflow then");
  });

  it("defense-in-depth validates normalized place JSON before inserting it", () => {
    expect(createRpc).toContain("jsonb_typeof(p_place_options) <> 'array'");
    expect(createRpc).toContain("jsonb_array_length(p_place_options) > 50");
    expect(createRpc).toContain("v_place_option ->> 'id'");
    expect(createRpc).toContain("v_place_option ->> 'title'");
    expect(createRpc).toContain("v_place_option ->> 'area'");
    expect(createRpc).toContain("v_place_option ->> 'estimatedBudget'");
    expect(createRpc).toContain("length(v_place_title) > 200");
    expect(createRpc).toContain("length(v_place_area) > 200");
    expect(createRpc).toContain("length(v_place_budget_text) > 10");
    expect(createRpc).toContain("v_place_budget > 2147483647");
    expect(createRpc).toContain("v_place_option_id = any(v_place_option_ids)");
  });

  it("bulk inserts the event and both option sets in one function transaction", () => {
    const eventInsert = createRpc.indexOf("insert into public.events");
    const timeInsert = createRpc.indexOf("insert into public.time_options");
    const placeInsert = createRpc.indexOf("insert into public.place_options");
    expect(eventInsert).toBeGreaterThan(-1);
    expect(timeInsert).toBeGreaterThan(eventInsert);
    expect(placeInsert).toBeGreaterThan(timeInsert);
    expect(createRpc).toContain("from unnest(v_time_option_ids, v_time_starts_at_values)");
    expect(createRpc).toContain("from unnest(v_place_option_ids, v_place_titles, v_place_areas, v_place_budgets)");
    expect(createRpc).toContain("v_event_id, option.starts_at");
    expect(createRpc).toContain("v_event_id, option.title");
    expect(createRpc).not.toMatch(/\b(commit|rollback|start transaction)\b/i);
    expect(createRpc).not.toContain("exception when others");
    expect(createRpc).toContain("return query select v_event_id");
  });

  it("uses no locks and leaves participant, vote, and join-request creation out of scope", () => {
    expect(createRpc).not.toMatch(/for update|pg_advisory|\block table\b/i);
    expect(createRpc).not.toMatch(/insert into public\.(participants|availability_votes|place_votes|join_requests)/i);
  });
});

describe("telegram-api atomic event creation integration", () => {
  it("uses exactly one creation RPC and removes the three direct creation inserts", () => {
    expect(createEvent.match(/db\.rpc\("create_event_atomic"/g)).toHaveLength(1);
    expect(createEvent).not.toContain('db.from("events").insert');
    expect(createEvent).not.toContain('db.from("time_options").insert');
    expect(createEvent).not.toContain('db.from("place_options").insert');
  });

  it("keeps actor and opaque id generation in verified Edge code", () => {
    expect(createEvent).toContain("p_actor_user_id: auth.user.id");
    expect(createEvent).toContain('const eventId = id("evt")');
    expect(createEvent).toContain('p_admin_token: id("backup")');
    expect(createEvent).toContain('id: id("time")');
    expect(createEvent).toContain('id: id("place")');
    expect(createEvent).not.toContain("payload.ownerUserId");
    expect(createEvent).not.toContain("payload.actor");
  });

  it("passes Edge-normalized times and places, then retains the existing response reload", () => {
    expect(createEvent).toContain("[...new Set(stringArrayField(");
    expect(createEvent).toContain(".filter((value) => !Number.isNaN(Date.parse(value))))].sort()");
    expect(createEvent).toContain("p_time_options: times.map((startsAt) => ({ id: id(\"time\"), startsAt }))");
    expect(createEvent).toContain("p_place_options: places");
    expect(createEvent).toContain("eventPayload(eventId, auth.user.id)");
    expect(createEvent).toContain("}, 201)");
  });

  it("maps only stable create-validation tokens to existing safe client errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const title = errorResponse(eventCreationHttpError({
      code: "P0001",
      message: "CREATE_EVENT_TITLE_INVALID",
    }));
    expect(title.status).toBe(400);
    expect(await title.json()).toEqual({ error: "Укажите корректное название встречи." });
    const timeLimit = errorResponse(eventCreationHttpError({
      code: "P0001",
      message: "CREATE_EVENT_TIME_OPTIONS_LIMIT",
    }));
    expect(timeLimit.status).toBe(400);
    expect(await timeLimit.json()).toEqual({ error: "Укажите не более 50 вариантов времени." });
    expect(eventCreationErrorToken({
      code: "23505",
      message: "CREATE_EVENT_TITLE_INVALID",
    })).toBeNull();
    const unknown = errorResponse(eventCreationHttpError({ code: "22P02", message: "raw SQL" }));
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: "Не удалось выполнить действие." });
  });

  it("does not change unrelated creation responsibilities", () => {
    expect(createEvent).not.toContain('db.from("participants")');
    expect(createEvent).not.toContain('db.from("join_requests")');
    expect(createEvent).not.toContain('db.from("availability_votes")');
    expect(createEvent).not.toContain('db.from("place_votes")');
    expect(api).toContain('db.rpc("add_event_time_option"');
    expect(api).toContain('db.rpc("add_event_place_option"');
  });
});
