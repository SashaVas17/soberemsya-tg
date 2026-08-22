import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  removeEventParticipantErrorToken,
  removeEventParticipantHttpError,
} from "../supabase/functions/_shared/remove-event-participant";
import { errorResponse } from "../supabase/functions/_shared/http";

const migration = readFileSync(
  "supabase/migrations/20260821165200_remove_event_participant.sql",
  "utf8",
).replace(/\r\n/g, "\n");
const schema = readFileSync(
  "supabase/migrations/20260806080219_soberemsya_schema.sql",
  "utf8",
).replace(/\r\n/g, "\n");
const foundation = readFileSync(
  "supabase/migrations/20260814104624_open_meetings_foundation.sql",
  "utf8",
).replace(/\r\n/g, "\n");
const apiSource = readFileSync(
  "supabase/functions/telegram-api/index.ts",
  "utf8",
);
const rpc = migration.slice(
  migration.indexOf("create or replace function public.remove_event_participant"),
  migration.indexOf("revoke all on function public.remove_event_participant"),
);
const handler = apiSource.slice(
  apiSource.indexOf("async function removeEventParticipant"),
  apiSource.indexOf("async function publicEvents"),
);

function rpcError(message: string, code = "P0001") {
  return { code, details: "database detail", hint: "database hint", message };
}

async function safeBody(error: unknown) {
  vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
  const response = errorResponse(removeEventParticipantHttpError(error));
  return { body: await response.json(), status: response.status };
}

afterEach(() => vi.restoreAllMocks());

describe("atomic organizer participant removal migration", () => {
  it("uses a hardened service-role-only SECURITY DEFINER RPC", () => {
    expect(rpc).toContain("security definer");
    expect(rpc).toContain("set search_path = pg_catalog, public");
    for (const role of ["public", "anon", "authenticated"])
      expect(migration).toContain(
        `revoke all on function public.remove_event_participant(text, uuid, uuid) from ${role};`,
      );
    expect(migration).toContain(
      "grant execute on function public.remove_event_participant(text, uuid, uuid)\n  to service_role;",
    );
  });

  it("uses stable tokens for actor, event, ownership, target and owner-member guards", () => {
    for (const token of [
      "PARTICIPANT_REMOVAL_ACTOR_UNAVAILABLE",
      "EVENT_UNAVAILABLE",
      "NOT_EVENT_OWNER",
      "PARTICIPANT_UNAVAILABLE",
      "OWNER_PARTICIPANT_CANNOT_REMOVE",
    ]) expect(rpc).toContain(`message = '${token}'`);
  });

  it("locks the event before the event-scoped target participant and mutations", () => {
    const eventLock = rpc.indexOf("from public.events");
    const participantLock = rpc.indexOf("from public.participants as participant");
    const participantDelete = rpc.indexOf("delete from public.participants as participant");
    const requestDelete = rpc.indexOf("delete from public.join_requests as request");
    expect(rpc.slice(eventLock, participantLock)).toContain("for update");
    expect(rpc.slice(participantLock, participantDelete)).toContain("for update");
    expect(eventLock).toBeLessThan(participantLock);
    expect(participantLock).toBeLessThan(participantDelete);
    expect(participantDelete).toBeLessThan(requestDelete);
  });

  it("scopes target lookup and deletion to the event plus participant id", () => {
    expect(rpc).toContain("participant.id = p_participant_id");
    expect(rpc).toContain("participant.event_id = p_event_id");
    expect(rpc).toContain("where participant.id = v_participant.id");
    expect(rpc).not.toContain("delete from public.participants where event_id");
  });

  it("allows intentional guest removal but does not clean up a guest request", () => {
    expect(rpc).toContain("and v_participant.user_id is not null then");
    const privateRemoval = rpc.slice(
      rpc.indexOf("delete from public.participants as participant"),
      rpc.indexOf("if v_event.visibility = 'public'"),
    );
    expect(privateRemoval).not.toContain("join_requests");
    const publicCleanup = rpc.slice(
      rpc.indexOf("if v_event.visibility = 'public'"),
      rpc.indexOf("return query select p_event_id"),
    );
    expect(publicCleanup).toContain("delete from public.join_requests as request");
  });

  it("cleans up only the removed public user's request and permits a fresh request", () => {
    expect(rpc).toContain("request.event_id = p_event_id");
    expect(rpc).toContain("request.requester_user_id = v_participant.user_id");
    expect(rpc).not.toContain("update public.join_requests");
    expect(foundation).toContain("if not v_request_found then\n    insert into public.join_requests");
  });

  it("relies on participant vote cascades without duplicate vote deletes", () => {
    expect(schema).toMatch(
      /create table if not exists public\.availability_votes[\s\S]*?references public\.participants\(id\) on delete cascade/,
    );
    expect(schema).toMatch(
      /create table if not exists public\.place_votes[\s\S]*?references public\.participants\(id\) on delete cascade/,
    );
    expect(rpc).not.toContain("availability_votes");
    expect(rpc).not.toContain("place_votes");
  });
});

describe("organizer participant removal HTTP contract", () => {
  it("registers an authenticated event and participant scoped DELETE route", () => {
    expect(apiSource).toContain("const auth = await authenticate(request);");
    expect(apiSource).toContain("const organizerParticipantMatch");
    expect(apiSource).toContain('participants\\/[^/]+$/.test(path)) return ["DELETE"]');
  });

  it("derives the actor only from validated Telegram auth", () => {
    expect(handler).toContain('db.rpc("remove_event_participant"');
    expect(handler).toContain("p_event_id: eventId");
    expect(handler).toContain("p_participant_id: participantId");
    expect(handler).toContain("p_actor_user_id: auth.user.id");
    expect(handler).not.toContain("request.json");
    expect(handler).not.toContain("userId");
  });

  it("validates malformed participant ids before calling the RPC", () => {
    expect(apiSource).toContain("function assertParticipantId");
    expect(handler).toContain("assertParticipantId(participantId)");
  });

  it("returns only the minimal success response", () => {
    expect(handler).toContain("return json({ removed: true });");
    expect(handler).not.toContain("return json({ participant_id");
    expect(handler).not.toContain("return json({ request_id");
  });

  it.each([
    "EVENT_UNAVAILABLE",
    "NOT_EVENT_OWNER",
    "PARTICIPANT_UNAVAILABLE",
    "OWNER_PARTICIPANT_CANNOT_REMOVE",
    "PARTICIPANT_REMOVAL_ACTOR_UNAVAILABLE",
  ])("allowlists exact P0001 token %s", (token) => {
    expect(removeEventParticipantErrorToken(rpcError(token))).toBe(token);
  });

  it("does not map database details or unknown tokens into client errors", async () => {
    expect(removeEventParticipantErrorToken(rpcError("PARTICIPANT_UNAVAILABLE", "23505"))).toBeNull();
    const result = await safeBody(rpcError("database internals", "23505"));
    expect(result).toEqual({
      status: 500,
      body: { error: "Не удалось выполнить действие." },
    });
  });

  it.each([
    ["EVENT_UNAVAILABLE", 404, undefined],
    ["NOT_EVENT_OWNER", 403, "NOT_EVENT_OWNER"],
    ["PARTICIPANT_UNAVAILABLE", 404, undefined],
    ["OWNER_PARTICIPANT_CANNOT_REMOVE", 403, "OWNER_PARTICIPANT_CANNOT_REMOVE"],
  ] as const)("maps %s to a safe HTTP response", async (token, status, code) => {
    const result = await safeBody(rpcError(token));
    expect(result.status).toBe(status);
    expect(result.body).not.toHaveProperty("details");
    expect(result.body).not.toHaveProperty("hint");
    if (code) expect(result.body).toHaveProperty("code", code);
    else expect(result.body).not.toHaveProperty("code");
  });

  it("leaves self-leave, approval, preview, feed and role-scoped payload flows in place", () => {
    expect(apiSource).toContain('db.rpc("leave_event_participation"');
    expect(apiSource).toContain('? "approve_join_request"');
    expect(apiSource).toContain(': "reject_join_request"');
    expect(apiSource).toContain("async function publicEvents");
    expect(apiSource).toContain("buildPublicEventPreview");
    expect(apiSource).toContain("participantEventPayload");
    expect(apiSource).toContain("privateInviteEventPayload");
  });
});
