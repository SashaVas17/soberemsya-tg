import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { responseSaveErrorToken, responseSaveHttpError } from "../supabase/functions/_shared/response-save";
import { errorResponse } from "../supabase/functions/_shared/http";

const migration = readFileSync(
  "supabase/migrations/20260822101611_atomic_save_event_response.sql",
  "utf8",
);
const apiSource = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
const saveResponse = apiSource.slice(
  apiSource.indexOf("async function saveResponse"),
  apiSource.indexOf("async function leaveParticipation"),
);

describe("atomic save_event_response RPC", () => {
  it("uses a hardened SECURITY DEFINER function with a fixed search path", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = pg_catalog, public");
  });

  it("limits execution to service_role", () => {
    expect(migration).toContain("revoke all on function public.save_event_response(text, uuid, text, integer, text, text, text[]) from public");
    expect(migration).toContain("revoke all on function public.save_event_response(text, uuid, text, integer, text, text, text[]) from anon");
    expect(migration).toContain("revoke all on function public.save_event_response(text, uuid, text, integer, text, text, text[]) from authenticated");
    expect(migration).toContain("grant execute on function public.save_event_response(text, uuid, text, integer, text, text, text[])\n  to service_role");
  });

  it("rejects a missing actor, unavailable event and closed response collection", () => {
    expect(migration).toContain("RESPONSE_ACTOR_UNAVAILABLE");
    expect(migration).toContain("EVENT_UNAVAILABLE");
    expect(migration).toContain("v_event.status <> 'collecting'");
    expect(migration).toContain("RESPONSE_CLOSED");
  });

  it("keeps private first responses, edits and owner responses eligible", () => {
    expect(migration).not.toMatch(/v_event\.visibility\s*=\s*'private'[\s\S]*?raise exception/);
    expect(migration).toContain("on conflict (event_id, user_id) do update");
  });

  it("requires existing public membership and rejects the public owner", () => {
    expect(migration).toContain("if v_event.visibility = 'public' then");
    expect(migration).toContain("PUBLIC_OWNER_CANNOT_RESPOND");
    expect(migration).toContain("PUBLIC_JOIN_REQUIRED");
  });

  it("scopes the participant lookup to event and authenticated actor, excluding legacy guests", () => {
    expect(migration).toContain("participant.event_id = p_event_id");
    expect(migration).toContain("participant.user_id = p_actor_user_id");
    expect(migration).not.toContain("participant.user_id is null");
  });

  it("rejects negative or absent budgets in the database boundary", () => {
    expect(migration).toContain("if p_budget is null or p_budget < 0 then");
    expect(migration).toContain("RESPONSE_INVALID_BUDGET");
  });

  it("deduplicates supplied time options and rejects cross-event option ids", () => {
    expect(migration).toContain("array_agg(distinct supplied.time_option_id)");
    expect(migration).toContain("option.event_id = p_event_id");
    expect(migration).toContain("TIME_OPTION_UNAVAILABLE");
  });

  it("locks the event before the current participant", () => {
    const eventLock = migration.indexOf("from public.events");
    const participantLock = migration.indexOf("from public.participants as participant");
    expect(eventLock).toBeGreaterThan(-1);
    expect(participantLock).toBeGreaterThan(eventLock);
    expect(migration.slice(eventLock, participantLock)).toContain("for update");
    expect(migration.slice(participantLock)).toContain("for update");
  });

  it("uses the existing event-user unique constraint through an upsert for first-response races", () => {
    expect(migration).toContain("on conflict (event_id, user_id) do update");
    expect(migration).toContain("returning id into v_participant_id");
  });

  it("writes trusted server-side Telegram names and the existing mutable participant fields", () => {
    expect(migration).toContain("from public.users as user_profile");
    for (const field of ["name", "area", "budget", "preferences", "restrictions"])
      expect(migration).toContain(`${field} = excluded.${field}`);
  });

  it("replaces only the actor participant availability matrix", () => {
    expect(migration).toContain("delete from public.availability_votes as vote");
    expect(migration).toContain("where vote.participant_id = v_participant_id");
    expect(migration).toContain("from public.time_options as option");
    expect(migration).toContain("option.id = any(v_available_time_option_ids)");
  });

  it("does not mutate place votes", () => {
    expect(migration).not.toContain("place_votes");
    expect(saveResponse).not.toContain("placeOptionIds");
  });
});

describe("atomic response HTTP integration", () => {
  it("keeps Telegram authentication and the existing request fields", () => {
    expect(apiSource).toContain("const auth = await authenticate(request);");
    expect(saveResponse).toContain('body && typeof body === "object"');
    for (const field of ["area", "budget", "preferences", "restrictions", "availableTimeOptionIds"])
      expect(saveResponse).toContain(`payload.${field}`);
  });

  it("uses verified auth as the only RPC actor identity", () => {
    expect(saveResponse).toContain("p_actor_user_id: auth.user.id");
    expect(saveResponse).not.toContain("payload.userId");
    expect(saveResponse).not.toContain("payload.actor");
  });

  it("performs exactly one response mutation RPC and retains the event response contract", () => {
    expect(saveResponse.match(/db\.rpc\("save_event_response"/g)).toHaveLength(1);
    expect(saveResponse).toContain("return json({ event: await eventPayload(eventId, auth.user.id) })");
    expect(saveResponse).not.toContain('db.from("participants")');
    expect(saveResponse).not.toContain('db.from("availability_votes")');
  });

  it("maps known P0001 tokens to safe statuses and unknown errors to a generic failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cases = [
      ["EVENT_UNAVAILABLE", 404],
      ["RESPONSE_CLOSED", 409],
      ["PUBLIC_JOIN_REQUIRED", 403],
      ["PUBLIC_OWNER_CANNOT_RESPOND", 403],
      ["TIME_OPTION_UNAVAILABLE", 400],
      ["RESPONSE_INVALID_BUDGET", 400],
    ] as const;
    for (const [token, status] of cases) {
      const result = errorResponse(responseSaveHttpError({ code: "P0001", message: token }));
      expect(result.status).toBe(status);
      expect((await result.json()).error).not.toMatch(/P0001|SQL|Postgres/i);
    }
    const result = errorResponse(responseSaveHttpError({ code: "23505", message: "duplicate" }));
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ error: "Не удалось выполнить действие." });
  });

  it("recognizes only the intended P0001 response-save tokens", () => {
    expect(responseSaveErrorToken({ code: "P0001", message: "TIME_OPTION_UNAVAILABLE" })).toBe("TIME_OPTION_UNAVAILABLE");
    expect(responseSaveErrorToken({ code: "23505", message: "TIME_OPTION_UNAVAILABLE" })).toBeNull();
    expect(responseSaveErrorToken({ code: "P0001", message: "other" })).toBeNull();
  });
});
