import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  leaveParticipationErrorToken,
  leaveParticipationHttpError,
} from "../supabase/functions/_shared/leave-participation";
import { errorResponse } from "../supabase/functions/_shared/http";

const migration = readFileSync(
  "supabase/migrations/20260815200810_leave_event_participation.sql",
  "utf8",
).replace(/\r\n/g, "\n");
const apiSource = readFileSync(
  "supabase/functions/telegram-api/index.ts",
  "utf8",
);
const schema = readFileSync(
  "supabase/migrations/20260806080219_soberemsya_schema.sql",
  "utf8",
);
const leaveRpc = migration.slice(
  migration.indexOf("create or replace function public.leave_event_participation"),
  migration.indexOf("revoke all on function public.leave_event_participation"),
);
const leaveHandler = apiSource.slice(
  apiSource.indexOf("async function leaveParticipation"),
  apiSource.indexOf("async function manageEvent"),
);

function rpcError(message: string, code = "P0001") {
  return { code, details: "database detail", hint: "database hint", message };
}

async function safeBody(error: unknown) {
  vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
  const response = errorResponse(leaveParticipationHttpError(error));
  return { body: await response.json(), status: response.status };
}

afterEach(() => vi.restoreAllMocks());

describe("atomic leave participation migration", () => {
  it("uses a hardened service-role-only SECURITY DEFINER RPC", () => {
    expect(leaveRpc).toContain("security definer");
    expect(leaveRpc).toContain("set search_path = pg_catalog, public");
    for (const role of ["public", "anon", "authenticated"])
      expect(migration).toContain(
        `revoke all on function public.leave_event_participation(text, uuid) from ${role};`,
      );
    expect(migration).toContain(
      "grant execute on function public.leave_event_participation(text, uuid)\n  to service_role;",
    );
  });

  it("rejects null actors, unavailable events, owners and non-members with stable tokens", () => {
    for (const token of [
      "PARTICIPATION_ACTOR_UNAVAILABLE",
      "EVENT_UNAVAILABLE",
      "OWNER_CANNOT_LEAVE",
      "PARTICIPATION_UNAVAILABLE",
    ])
      expect(leaveRpc).toContain(`message = '${token}'`);
  });

  it("locks the event before checking or mutating membership and requests", () => {
    const eventLock = leaveRpc.indexOf("from public.events");
    const memberLookup = leaveRpc.indexOf("from public.participants as participant");
    const memberDelete = leaveRpc.indexOf("delete from public.participants as participant");
    const requestDelete = leaveRpc.indexOf("delete from public.join_requests as request");
    expect(eventLock).toBeGreaterThan(-1);
    expect(leaveRpc.slice(eventLock, memberLookup)).toContain("for update");
    expect(eventLock).toBeLessThan(memberLookup);
    expect(memberLookup).toBeLessThan(memberDelete);
    expect(memberDelete).toBeLessThan(requestDelete);
  });

  it("targets only the authenticated event/user membership and never guest rows", () => {
    expect(leaveRpc).toContain("participant.event_id = p_event_id");
    expect(leaveRpc).toContain("participant.user_id = p_user_id");
    expect(leaveRpc).not.toContain("participant.user_id is null");
    expect(leaveRpc).not.toContain("delete from public.participants where event_id");
  });

  it("removes private membership without requiring a join request", () => {
    expect(leaveRpc).toContain("delete from public.participants as participant");
    const publicOnly = leaveRpc.slice(
      leaveRpc.indexOf("if v_event.visibility = 'public' then"),
      leaveRpc.indexOf("return query select p_event_id"),
    );
    expect(publicOnly).toContain("delete from public.join_requests as request");
  });

  it("removes only the leaving public user's join request", () => {
    expect(leaveRpc).toContain("request.event_id = p_event_id");
    expect(leaveRpc).toContain("request.requester_user_id = p_user_id");
    expect(leaveRpc).not.toContain("update public.join_requests");
  });

  it("relies on the existing participant vote cascades instead of duplicate deletes", () => {
    expect(schema).toContain(
      "references public.participants(id) on delete cascade",
    );
    expect(leaveRpc).not.toContain("availability_votes");
    expect(leaveRpc).not.toContain("place_votes");
  });
});

describe("leave participation HTTP contract", () => {
  it("registers an authenticated DELETE route", () => {
    expect(apiSource).toContain("const auth = await authenticate(request);");
    expect(apiSource).toContain("const participationMatch");
    expect(apiSource).toContain(
      'participationMatch && request.method === "DELETE"',
    );
  });

  it("uses only the validated Telegram user id and cannot accept a body override", () => {
    expect(leaveHandler).toContain('db.rpc("leave_event_participation"');
    expect(leaveHandler).toContain("p_event_id: eventId");
    expect(leaveHandler).toContain("p_user_id: auth.user.id");
    expect(leaveHandler).not.toContain("request.json");
    expect(leaveHandler).not.toContain("userId");
    expect(leaveHandler).not.toContain("participantId");
  });

  it("returns only the minimal success response", () => {
    expect(leaveHandler).toContain("return json({ left: true });");
    expect(leaveHandler).not.toContain("participant_id");
    expect(leaveHandler).not.toContain("request_id");
  });

  it.each([
    "EVENT_UNAVAILABLE",
    "OWNER_CANNOT_LEAVE",
    "PARTICIPATION_UNAVAILABLE",
    "PARTICIPATION_ACTOR_UNAVAILABLE",
  ])("allowlists exact P0001 token %s", (token) => {
    expect(leaveParticipationErrorToken(rpcError(token))).toBe(token);
  });

  it("does not map database details or unknown tokens into a client error", async () => {
    expect(leaveParticipationErrorToken(rpcError("PARTICIPATION_UNAVAILABLE", "23505"))).toBeNull();
    const result = await safeBody(rpcError("duplicate key value violates constraint", "23505"));
    expect(result).toEqual({
      status: 500,
      body: { error: "Не удалось выполнить действие." },
    });
  });

  it.each([
    ["EVENT_UNAVAILABLE", 404, undefined],
    ["OWNER_CANNOT_LEAVE", 403, "OWNER_CANNOT_LEAVE"],
    ["PARTICIPATION_UNAVAILABLE", 404, undefined],
  ] as const)("maps %s to a safe HTTP response", async (token, status, code) => {
    const result = await safeBody(rpcError(token));
    expect(result.status).toBe(status);
    expect(result.body).not.toHaveProperty("details");
    expect(result.body).not.toHaveProperty("hint");
    if (code) expect(result.body).toHaveProperty("code", code);
    else expect(result.body).not.toHaveProperty("code");
  });

  it("leaves existing public join, preview and feed flows in place", () => {
    expect(apiSource).toContain('db.rpc("create_join_request"');
    expect(apiSource).toContain('? "approve_join_request"');
    expect(apiSource).toContain(': "reject_join_request"');
    expect(apiSource).toContain("async function publicEvents");
    expect(apiSource).toContain('.eq("visibility", "public")');
    expect(apiSource).toContain("buildPublicEventPreview");
  });
});
