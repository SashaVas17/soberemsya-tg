import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { finalOptionRemovalHttpError } from "../supabase/functions/_shared/final-option-removal";
import { errorResponse } from "../supabase/functions/_shared/http";

const migrationPath =
  "supabase/migrations/20260825203000_protect_final_event_options.sql";
const migration = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n");
const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const manageEvent = api.slice(
  api.indexOf("async function manageEvent"),
  api.indexOf("async function meetings"),
);
const removeTime = manageEvent.slice(
  manageEvent.indexOf('case "remove_time"'),
  manageEvent.indexOf('case "add_place"'),
);
const removePlace = manageEvent.slice(
  manageEvent.indexOf('case "remove_place"'),
  manageEvent.indexOf('case "close"'),
);

describe("final event option referential integrity migration", () => {
  it("adds exactly one new migration without modifying the option-cap migration", () => {
    const migrations = readdirSync("supabase/migrations");
    expect(migrations.filter((name) => name.includes("protect_final_event_options")))
      .toEqual(["20260825203000_protect_final_event_options.sql"]);
    expect(readFileSync(
      "supabase/migrations/20260825170533_limit_event_option_additions.sql",
      "utf8",
    )).toContain("TIME_OPTION_LIMIT_REACHED");
  });

  it("adds the exact composite keys and same-event final foreign keys", () => {
    expect(migration).toContain(
      "add constraint time_options_event_id_id_key unique (event_id, id);",
    );
    expect(migration).toContain(
      "add constraint place_options_event_id_id_key unique (event_id, id);",
    );
    expect(migration).toContain(
      "add constraint events_final_time_option_same_event_fkey\n      foreign key (id, final_time_option_id)\n      references public.time_options(event_id, id)\n      on delete no action not deferrable;",
    );
    expect(migration).toContain(
      "add constraint events_final_place_option_same_event_fkey\n      foreign key (id, final_place_id)\n      references public.place_options(event_id, id)\n      on delete no action not deferrable;",
    );
  });

  it("keeps nullable finals and rejects invalid references without repairing data", () => {
    expect(migration).not.toMatch(/final_(time_option|place)_id\s+set\s+not\s+null/i);
    expect(migration).not.toMatch(/on delete set null|on delete cascade/i);
    expect(migration).toContain("on delete no action not deferrable;");
    expect(migration).not.toMatch(/delete\s+from|update\s+public\.events/i);
  });

  it("retains option-to-event cascades and composite same-event ordering", () => {
    const schema = readFileSync(
      "supabase/migrations/20260806080219_soberemsya_schema.sql",
      "utf8",
    );
    expect(schema).toContain("event_id text not null references public.events(id) on delete cascade");
    expect(migration).toContain("foreign key (id, final_time_option_id)");
    expect(migration).toContain("references public.time_options(event_id, id)");
    expect(migration).toContain("foreign key (id, final_place_id)");
    expect(migration).toContain("references public.place_options(event_id, id)");
  });
});

describe("final option removal error mapping", () => {
  it("keeps direct non-final delete paths and classifies only the named FK", () => {
    expect(removeTime).toContain('db.from("time_options").delete()');
    expect(removePlace).toContain('db.from("place_options").delete()');
    expect(removeTime).toContain('finalOptionRemovalHttpError(deleteError, "time")');
    expect(removePlace).toContain('finalOptionRemovalHttpError(deleteError, "place")');
    expect(removeTime).not.toContain("rpc(");
    expect(removePlace).not.toContain("rpc(");
  });

  it("maps only the known final time FK violation to a safe 409", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = errorResponse(finalOptionRemovalHttpError({
      code: "23503",
      message: 'update violates foreign key constraint "events_final_time_option_same_event_fkey"',
    }, "time"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Нельзя удалить выбранный итоговый вариант времени. Сначала возобновите сбор ответов.",
      code: "FINAL_TIME_OPTION_REMOVE_FORBIDDEN",
    });
  });

  it("maps only the known final place FK violation to a safe 409", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = errorResponse(finalOptionRemovalHttpError({
      code: "23503",
      message: 'update violates foreign key constraint "events_final_place_option_same_event_fkey"',
    }, "place"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Нельзя удалить выбранное итоговое место. Сначала возобновите сбор ответов.",
      code: "FINAL_PLACE_OPTION_REMOVE_FORBIDDEN",
    });
  });

  it("does not misclassify unrelated foreign-key errors or expose their text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = errorResponse(finalOptionRemovalHttpError({
      code: "23503",
      message: 'update violates foreign key constraint "participants_event_id_fkey"',
    }, "time"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Не удалось выполнить действие." });
  });

  it("preserves reopen, decision, create, and vote cascade behavior", () => {
    expect(manageEvent).toContain(
      'status: "collecting", final_time_option_id: null, final_place_id: null',
    );
    expect(manageEvent).toContain('case "decide"');
    expect(api).toContain('db.from("events").insert');
    expect(api).toContain('db.from("availability_votes")');
    expect(api).not.toContain("remove_event_time_option");
    expect(api).not.toContain("remove_event_place_option");
  });
});
