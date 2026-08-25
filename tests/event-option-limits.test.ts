import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  optionAdditionErrorToken,
  optionAdditionHttpError,
} from "../supabase/functions/_shared/event-option-addition";
import { errorResponse } from "../supabase/functions/_shared/http";

const migrationPath =
  "supabase/migrations/20260825123000_limit_event_option_additions.sql";
const migration = readFileSync(migrationPath, "utf8");
const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const manageEvent = api.slice(
  api.indexOf("async function manageEvent"),
  api.indexOf("async function meetings"),
);
const timeRpc = migration.slice(
  migration.indexOf("create or replace function public.add_event_time_option"),
  migration.indexOf("create or replace function public.add_event_place_option"),
);
const placeRpc = migration.slice(
  migration.indexOf("create or replace function public.add_event_place_option"),
  migration.indexOf("revoke all on function public.add_event_time_option"),
);
const addTime = manageEvent.slice(
  manageEvent.indexOf('case "add_time"'),
  manageEvent.indexOf('case "remove_time"'),
);
const addPlace = manageEvent.slice(
  manageEvent.indexOf('case "add_place"'),
  manageEvent.indexOf('case "remove_place"'),
);

function expectHardenedRpc(source: string, signature: string) {
  expect(source).toContain("security definer");
  expect(source).toContain("set search_path = pg_catalog, public");
  for (const role of ["public", "anon", "authenticated"])
    expect(migration).toContain(`revoke all on function ${signature} from ${role};`);
  expect(migration).toContain(
    `grant execute on function ${signature}\n  to service_role;`,
  );
}

function expectEventLockThenCountThenInsert(
  source: string,
  table: "time_options" | "place_options",
  token: string,
) {
  const eventLock = source.indexOf("from public.events as event");
  const count = source.indexOf(`from public.${table} as option`);
  const rejection = source.indexOf(token);
  const insert = source.indexOf(`insert into public.${table}`);
  expect(eventLock).toBeGreaterThan(-1);
  expect(source.slice(eventLock, count)).toContain("for update");
  expect(count).toBeGreaterThan(eventLock);
  expect(rejection).toBeGreaterThan(count);
  expect(insert).toBeGreaterThan(rejection);
  expect(source).toContain("where option.event_id = p_event_id");
}

describe("transactional event option cap migrations", () => {
  it("adds exactly one focused migration without changing the canonical hotfix migration", () => {
    const migrations = readdirSync("supabase/migrations");
    expect(migrations.filter((name) => name.includes("limit_event_option_additions")))
      .toEqual(["20260825123000_limit_event_option_additions.sql"]);
    expect(readFileSync(
      "supabase/migrations/20260825122438_fix_ensure_telegram_user_conflict.sql",
      "utf8",
    )).toContain("users_telegram_user_id_key");
  });

  it("creates explicit hardened time and place addition RPCs", () => {
    expect(timeRpc).toContain("p_event_id text");
    expect(timeRpc).toContain("p_actor_user_id uuid");
    expect(timeRpc).toContain("p_option_id text");
    expect(timeRpc).toContain("p_starts_at timestamptz");
    expect(placeRpc).toContain("p_title text");
    expect(placeRpc).toContain("p_area text");
    expect(placeRpc).toContain("p_estimated_budget integer");
    expect(timeRpc).toContain("returns table (option_id text)");
    expect(placeRpc).toContain("returns table (option_id text)");
    expectHardenedRpc(
      timeRpc,
      "public.add_event_time_option(text, uuid, text, timestamptz)",
    );
    expectHardenedRpc(
      placeRpc,
      "public.add_event_place_option(text, uuid, text, text, text, integer)",
    );
  });

  it("locks the parent event before each scoped count and insert", () => {
    expectEventLockThenCountThenInsert(
      timeRpc,
      "time_options",
      "TIME_OPTION_LIMIT_REACHED",
    );
    expectEventLockThenCountThenInsert(
      placeRpc,
      "place_options",
      "PLACE_OPTION_LIMIT_REACHED",
    );
    expect(timeRpc).toContain("if v_option_count >= 50 then");
    expect(placeRpc).toContain("if v_option_count >= 50 then");
  });

  it("validates the locked event owner without adding lifecycle restrictions", () => {
    for (const source of [timeRpc, placeRpc]) {
      expect(source).toContain("event.deleted_at is null");
      expect(source).toContain("v_event.owner_user_id <> p_actor_user_id");
      expect(source).toContain("EVENT_UNAVAILABLE");
      expect(source).toContain("NOT_EVENT_OWNER");
      expect(source).not.toContain("v_event.status");
    }
  });

  it("does not modify or remove existing option rows", () => {
    expect(migration).not.toMatch(/delete\s+from\s+public\.(time_options|place_options)/i);
    expect(migration).not.toMatch(/update\s+public\.(time_options|place_options)/i);
  });
});

describe("manage add-option RPC integration", () => {
  it("replaces only direct add inserts with one RPC each", () => {
    expect(addTime).toContain('db.rpc("add_event_time_option"');
    expect(addPlace).toContain('db.rpc("add_event_place_option"');
    expect(addTime).not.toContain('db.from("time_options").insert');
    expect(addPlace).not.toContain('db.from("place_options").insert');
    expect(manageEvent).toContain('case "remove_time"');
    expect(manageEvent).toContain('case "remove_place"');
    expect(manageEvent).toContain('case "close"');
    expect(manageEvent).toContain('case "reopen"');
    expect(manageEvent).toContain('case "decide"');
  });

  it("uses verified auth and Edge-generated option ids, never payload actor ids", () => {
    expect(addTime).toContain("p_actor_user_id: auth.user.id");
    expect(addPlace).toContain("p_actor_user_id: auth.user.id");
    expect(addTime).toContain('p_option_id: id("time")');
    expect(addPlace).toContain('p_option_id: id("place")');
    expect(addTime).not.toContain("payload.actor");
    expect(addPlace).not.toContain("payload.actor");
    expect(addTime).not.toContain("payload.userId");
    expect(addPlace).not.toContain("payload.userId");
  });

  it("preserves validation, success response, and browser CORS error wrapping", () => {
    expect(addTime).toContain("Date.parse(startsAt)");
    expect(addPlace).toContain('textField(place, "title", 200');
    expect(addPlace).toContain("budgetField(place.estimatedBudget)");
    expect(manageEvent).toContain(
      "return json({ event: await eventPayload(eventId, auth.user.id) })",
    );
    expect(api).toContain("withBrowserCors(request, response)");
  });

  it("maps only stable limit errors to safe 409 responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const time = errorResponse(optionAdditionHttpError({
      code: "P0001",
      message: "TIME_OPTION_LIMIT_REACHED",
    }));
    expect(time.status).toBe(409);
    expect(await time.json()).toEqual({
      error: "Нельзя добавить больше 50 вариантов времени.",
    });
    const place = errorResponse(optionAdditionHttpError({
      code: "P0001",
      message: "PLACE_OPTION_LIMIT_REACHED",
    }));
    expect(place.status).toBe(409);
    expect(await place.json()).toEqual({
      error: "Нельзя добавить больше 50 вариантов мест.",
    });
    expect(optionAdditionErrorToken({
      code: "23505",
      message: "TIME_OPTION_LIMIT_REACHED",
    })).toBeNull();
  });
});
