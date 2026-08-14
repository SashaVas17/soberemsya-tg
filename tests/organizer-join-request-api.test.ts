import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiErrorFromBody } from "../src/api-error";
import {
  joinRequestDecisionErrorToken,
  joinRequestDecisionHttpError,
  joinRequestDecisionResponse,
  organizerDisplayName,
  organizerJoinRequestsResponse,
  resolveJoinRequestDecisionRetry,
} from "../supabase/functions/_shared/organizer-join-requests";
import { errorResponse } from "../supabase/functions/_shared/http";

const backendSource = readFileSync(
  "supabase/functions/telegram-api/index.ts",
  "utf8",
);
const listSource = backendSource.slice(
  backendSource.indexOf("async function organizerJoinRequests"),
  backendSource.indexOf("function assertJoinRequestId"),
);
const retrySource = backendSource.slice(
  backendSource.indexOf("async function loadJoinRequestRetryState"),
  backendSource.indexOf("async function decideJoinRequest"),
);
const decisionSource = backendSource.slice(
  backendSource.indexOf("async function decideJoinRequest"),
  backendSource.indexOf("async function saveResponse"),
);
const apiSource = readFileSync("src/api.ts", "utf8");
const typeSource = readFileSync("src/types.ts", "utf8");
const appSource = readFileSync("src/App.tsx", "utf8");

const requestRows = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    status: "pending",
    created_at: "2026-08-14T10:00:00.000Z",
    requester_user_id: "user_1",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    status: "approved",
    created_at: "2026-08-14T11:00:00.000Z",
    requester_user_id: "user_2",
  },
];

const profiles = [
  {
    id: "user_1",
    first_name: "Анна",
    last_name: "Иванова",
    username: null,
  },
  {
    id: "user_2",
    first_name: "Максим",
    last_name: null,
    username: "max",
  },
];

function rpcError(message: string, code = "P0001") {
  return { code, details: "database detail", hint: "database hint", message };
}

function captureError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail");
}

async function safeResponse(error: unknown) {
  vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
  const response = errorResponse(error);
  return { status: response.status, body: await response.json() };
}

afterEach(() => vi.restoreAllMocks());

describe("organizer request list contract", () => {
  it("returns only pending requests with the exact minimal shape", () => {
    const result = organizerJoinRequestsResponse(requestRows, profiles);
    expect(result).toEqual({
      requests: [{
        requestId: "11111111-1111-4111-8111-111111111111",
        status: "pending",
        createdAt: "2026-08-14T10:00:00.000Z",
        requester: { displayName: "Анна Иванова", username: null },
      }],
    });
    expect(Object.keys(result.requests[0])).toEqual([
      "requestId",
      "status",
      "createdAt",
      "requester",
    ]);
  });

  it("builds names and provides the neutral empty-name fallback", () => {
    expect(organizerDisplayName(profiles[0])).toBe("Анна Иванова");
    expect(organizerDisplayName({ first_name: " Анна ", last_name: null })).toBe("Анна");
    expect(organizerDisplayName({ first_name: "", last_name: null })).toBe("Пользователь Telegram");
  });

  it("does not expose internal or participant fields", () => {
    const serialized = JSON.stringify(
      organizerJoinRequestsResponse(requestRows, profiles),
    );
    for (const secret of [
      "requester_user_id",
      "telegram_user_id",
      "participantId",
      "ownerUserId",
      "budget",
      "area",
      "preferences",
      "restrictions",
      "votes",
      "availability",
      "user_1",
    ]) expect(serialized).not.toContain(secret);
  });

  it("fails safely when a requester profile cannot be resolved", async () => {
    const error = captureError(() => organizerJoinRequestsResponse(requestRows, []));
    expect(await safeResponse(error)).toEqual({
      status: 500,
      body: { error: "Не удалось выполнить действие." },
    });
  });

  it("registers the owner-only GET route before the generic event route", () => {
    expect(backendSource).toContain(
      'organizerJoinRequestsMatch && request.method === "GET"',
    );
    expect(backendSource.indexOf("const organizerJoinRequestsMatch")).toBeLessThan(
      backendSource.indexOf("const eventMatch"),
    );
  });

  it("authenticates event ownership before loading applicants or profiles", () => {
    const eventQuery = listSource.indexOf('.from("events")');
    const ownerCheck = listSource.indexOf("event.owner_user_id !== auth.user.id");
    const publicCheck = listSource.indexOf('event.visibility !== "public"');
    const requestQuery = listSource.indexOf('.from("join_requests")');
    const profileQuery = listSource.indexOf('.from("users")');
    expect(eventQuery).toBeLessThan(ownerCheck);
    expect(ownerCheck).toBeLessThan(publicCheck);
    expect(publicCheck).toBeLessThan(requestQuery);
    expect(requestQuery).toBeLessThan(profileQuery);
  });

  it("keeps deleted/private behavior safe and does not restrict lifecycle status", () => {
    expect(listSource).toContain('.is("deleted_at", null)');
    expect(listSource).toContain("assertEventAvailable(event)");
    expect(listSource).toContain('joinRequestDecisionHttpError("NOT_EVENT_OWNER")');
    expect(listSource).toContain('joinRequestDecisionHttpError("JOIN_REQUEST_NOT_ALLOWED")');
    expect(listSource).not.toContain("collecting");
    expect(listSource).not.toContain("event.status");
  });

  it("queries only pending requests and minimal requester columns", () => {
    expect(listSource).toContain('.eq("status", "pending")');
    expect(listSource).toContain('select("id,status,created_at,requester_user_id")');
    expect(listSource).toContain('select("id,first_name,last_name,username")');
    for (const field of ["telegram_user_id", "budget", "preferences", "restrictions", "availability_votes"])
      expect(listSource).not.toContain(field);
  });
});

describe("decision RPC and route architecture", () => {
  it("registers approve and reject POST routes", () => {
    expect(backendSource).toContain("joinRequestDecisionMatch");
    expect(backendSource).toContain("(approve|reject)");
    expect(backendSource).toContain(
      'joinRequestDecisionMatch && request.method === "POST"',
    );
  });

  it("passes only route IDs and authenticated actor to the RPC", () => {
    expect(decisionSource).toContain('"approve_join_request"');
    expect(decisionSource).toContain('"reject_join_request"');
    expect(decisionSource).toContain("p_event_id: eventId");
    expect(decisionSource).toContain("p_request_id: requestId");
    expect(decisionSource).toContain("p_actor_user_id: auth.user.id");
    expect(decisionSource).not.toContain("request.json");
  });

  it("keeps participant creation and capacity authority out of TypeScript", () => {
    expect(decisionSource).not.toContain(".insert(");
    expect(decisionSource).not.toContain(".update(");
    expect(decisionSource).not.toContain("max_participants");
    expect(decisionSource).not.toContain("participantCount");
  });

  it("returns the minimal decision response without participant ID", () => {
    expect(joinRequestDecisionResponse("request_1", "approved")).toEqual({
      requestId: "request_1",
      status: "approved",
    });
    expect(joinRequestDecisionResponse("request_1", "rejected")).toEqual({
      requestId: "request_1",
      status: "rejected",
    });
    expect(joinRequestDecisionResponse("request_1", "approved")).not.toHaveProperty("participantId");
  });

  it("rejects malformed request UUIDs before invoking an RPC", () => {
    expect(decisionSource.indexOf("assertJoinRequestId(requestId)")).toBeLessThan(
      decisionSource.indexOf("db.rpc"),
    );
  });

  it("scopes authoritative rereads by both event and request", () => {
    expect(retrySource).toContain('.eq("event_id", eventId)');
    expect(retrySource).toContain('.eq("id", requestId)');
    expect(retrySource).toContain('select("status,requester_user_id")');
    expect(retrySource).toContain('.eq("user_id", request.requester_user_id)');
  });

  it("keeps Manage UI untouched", () => {
    const manage = appSource.slice(
      appSource.indexOf("function Manage("),
      appSource.indexOf("function Result("),
    );
    expect(manage).not.toContain("api.joinRequests");
    expect(manage).not.toContain("approveJoinRequest");
    expect(manage).not.toContain("rejectJoinRequest");
  });
});

describe("safe decision token mapping", () => {
  const approveTokens = [
    "EVENT_UNAVAILABLE",
    "NOT_EVENT_OWNER",
    "JOIN_REQUEST_NOT_ALLOWED",
    "JOIN_REQUESTS_CLOSED",
    "JOIN_REQUEST_UNAVAILABLE",
    "JOIN_REQUEST_NOT_PENDING",
    "OWNER_CANNOT_JOIN",
    "JOIN_REQUEST_STATE_INCONSISTENT",
    "REQUESTER_UNAVAILABLE",
    "EVENT_FULL",
  ];
  const rejectTokens = [
    "EVENT_UNAVAILABLE",
    "NOT_EVENT_OWNER",
    "JOIN_REQUEST_NOT_ALLOWED",
    "JOIN_REQUEST_UNAVAILABLE",
    "JOIN_REQUEST_NOT_PENDING",
  ];

  it.each(approveTokens)("recognizes exact approve token %s", (token) => {
    expect(joinRequestDecisionErrorToken(rpcError(token), "approve")).toBe(token);
  });

  it.each(rejectTokens)("recognizes exact reject token %s", (token) => {
    expect(joinRequestDecisionErrorToken(rpcError(token), "reject")).toBe(token);
  });

  it("rejects wrong SQL codes, partial tokens and action-inapplicable tokens", () => {
    expect(joinRequestDecisionErrorToken(rpcError("EVENT_FULL", "23505"), "approve")).toBeNull();
    expect(joinRequestDecisionErrorToken(rpcError("prefix EVENT_FULL"), "approve")).toBeNull();
    expect(joinRequestDecisionErrorToken(rpcError("EVENT_FULL"), "reject")).toBeNull();
  });

  it.each([
    ["NOT_EVENT_OWNER", 403, "NOT_EVENT_OWNER"],
    ["JOIN_REQUEST_NOT_ALLOWED", 409, "JOIN_REQUEST_NOT_ALLOWED"],
    ["JOIN_REQUESTS_CLOSED", 409, "JOIN_REQUESTS_CLOSED"],
    ["JOIN_REQUEST_NOT_PENDING", 409, "JOIN_REQUEST_NOT_PENDING"],
    ["OWNER_CANNOT_JOIN", 403, "OWNER_CANNOT_JOIN"],
    ["EVENT_FULL", 409, "EVENT_FULL"],
  ] as const)("maps %s to a safe application response", async (token, status, code) => {
    const result = await safeResponse(joinRequestDecisionHttpError(token));
    expect(result.status).toBe(status);
    expect(result.body).toHaveProperty("code", code);
    expect(result.body).not.toHaveProperty("details");
    expect(result.body).not.toHaveProperty("hint");
  });

  it.each(["EVENT_UNAVAILABLE", "JOIN_REQUEST_UNAVAILABLE"])(
    "keeps unavailable token %s on the safe 404 convention",
    async (token) => {
      const result = await safeResponse(joinRequestDecisionHttpError(token));
      expect(result.status).toBe(404);
      expect(result.body).not.toHaveProperty("code");
    },
  );

  it.each(["REQUESTER_UNAVAILABLE", "JOIN_REQUEST_STATE_INCONSISTENT"])(
    "hides internal token %s",
    async (token) => {
      const result = await safeResponse(joinRequestDecisionHttpError(token));
      expect(result).toEqual({
        status: 500,
        body: { error: "Не удалось выполнить действие." },
      });
      expect(JSON.stringify(result.body)).not.toContain(token);
    },
  );

  it("hides unknown database errors and raw details", async () => {
    const token = joinRequestDecisionErrorToken(
      rpcError("duplicate key", "23505"),
      "approve",
    );
    const result = await safeResponse(joinRequestDecisionHttpError(token));
    expect(result).toEqual({
      status: 500,
      body: { error: "Не удалось выполнить действие." },
    });
    expect(JSON.stringify(result.body)).not.toContain("duplicate");
    expect(JSON.stringify(result.body)).not.toContain("23505");
  });

  it("preserves only the new safe frontend codes", () => {
    for (const code of [
      "NOT_EVENT_OWNER",
      "JOIN_REQUESTS_CLOSED",
      "JOIN_REQUEST_NOT_PENDING",
      "EVENT_FULL",
    ]) expect(apiErrorFromBody(409, { error: "safe", code }).code).toBe(code);
    expect(apiErrorFromBody(500, { error: "raw", code: "P0001" }).code).toBeUndefined();
  });
});

describe("authoritative retry normalization", () => {
  const requestId = "11111111-1111-4111-8111-111111111111";

  it.each(["not_pending", "closed"] as const)(
    "normalizes approved + participant after %s",
    (source) => {
      expect(resolveJoinRequestDecisionRetry(
        "approve",
        requestId,
        { status: "approved", requesterUserId: "user_1", participantExists: true },
        source,
      )).toEqual({ requestId, status: "approved" });
    },
  );

  it("rejects approved without participant and pending with participant as internal", async () => {
    for (const state of [
      { status: "approved", requesterUserId: "user_1", participantExists: false },
      { status: "pending", requesterUserId: "user_1", participantExists: true },
    ]) {
      const error = captureError(() => resolveJoinRequestDecisionRetry(
        "approve",
        requestId,
        state,
        "not_pending",
      ));
      expect(await safeResponse(error)).toEqual({
        status: 500,
        body: { error: "Не удалось выполнить действие." },
      });
    }
  });

  it("returns NOT_PENDING for the opposite approve action", async () => {
    const error = captureError(() => resolveJoinRequestDecisionRetry(
      "approve",
      requestId,
      { status: "rejected", requesterUserId: "user_1", participantExists: false },
      "not_pending",
    ));
    expect(await safeResponse(error)).toMatchObject({
      status: 409,
      body: { code: "JOIN_REQUEST_NOT_PENDING" },
    });
  });

  it("preserves CLOSED when the request was not consistently approved", async () => {
    const error = captureError(() => resolveJoinRequestDecisionRetry(
      "approve",
      requestId,
      { status: "pending", requesterUserId: "user_1", participantExists: false },
      "closed",
    ));
    expect(await safeResponse(error)).toMatchObject({
      status: 409,
      body: { code: "JOIN_REQUESTS_CLOSED" },
    });
  });

  it("normalizes repeated reject only without participant membership", () => {
    expect(resolveJoinRequestDecisionRetry(
      "reject",
      requestId,
      { status: "rejected", requesterUserId: "user_1", participantExists: false },
      "not_pending",
    )).toEqual({ requestId, status: "rejected" });
  });

  it("rejects rejected + participant as internal", async () => {
    const error = captureError(() => resolveJoinRequestDecisionRetry(
      "reject",
      requestId,
      { status: "rejected", requesterUserId: "user_1", participantExists: true },
      "not_pending",
    ));
    expect(await safeResponse(error)).toEqual({
      status: 500,
      body: { error: "Не удалось выполнить действие." },
    });
  });

  it("returns NOT_PENDING for approved then reject", async () => {
    const error = captureError(() => resolveJoinRequestDecisionRetry(
      "reject",
      requestId,
      { status: "approved", requesterUserId: "user_1", participantExists: true },
      "not_pending",
    ));
    expect(await safeResponse(error)).toMatchObject({
      status: 409,
      body: { code: "JOIN_REQUEST_NOT_PENDING" },
    });
  });

  it("returns safe 404 for a missing or wrong-event request reread", async () => {
    const error = captureError(() => resolveJoinRequestDecisionRetry(
      "approve",
      requestId,
      null,
      "not_pending",
    ));
    expect(await safeResponse(error)).toEqual({
      status: 404,
      body: { error: "Заявка не найдена." },
    });
  });
});

describe("frontend API-only contract", () => {
  it("adds thin typed list, approve and reject methods", () => {
    expect(apiSource).toContain("joinRequests: (eventId: string)");
    expect(apiSource).toContain("approveJoinRequest: (eventId: string, requestId: string)");
    expect(apiSource).toContain("rejectJoinRequest: (eventId: string, requestId: string)");
    expect(apiSource).toContain("request<OrganizerJoinRequestsResponse>");
    expect(apiSource.match(/request<JoinRequestDecisionResponse>/g)).toHaveLength(2);
  });

  it("keeps organizer types separate from EventData and PublicEventPreview", () => {
    expect(typeSource).toContain("export type OrganizerJoinRequest =");
    expect(typeSource).toContain("export type OrganizerJoinRequestsResponse =");
    expect(typeSource).toContain("export type JoinRequestDecisionResponse =");
    const organizerTypes = typeSource.slice(
      typeSource.indexOf("export type OrganizerJoinRequest ="),
      typeSource.indexOf("export type TelegramUser ="),
    );
    expect(organizerTypes).not.toContain("EventData");
    expect(organizerTypes).not.toContain("PublicEventPreview");
  });
});
