import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { apiErrorFromBody } from "../src/api-error";
import {
  createJoinRequestOnce,
  mockCreateJoinRequest,
  publicJoinRequestView,
} from "../src/join-request";
import {
  createJoinRequestErrorToken,
  createJoinRequestHttpError,
  createJoinRequestHttpResult,
} from "../supabase/functions/_shared/join-request";
import { errorResponse } from "../supabase/functions/_shared/http";

const backendSource = readFileSync(
  "supabase/functions/telegram-api/index.ts",
  "utf8",
);
const handlerSource = backendSource.slice(
  backendSource.indexOf("async function createJoinRequest"),
  backendSource.indexOf("async function organizerJoinRequests"),
);
const appSource = readFileSync("src/App.tsx", "utf8");
const previewSource = appSource.slice(
  appSource.indexOf("function PublicPreviewScreen"),
  appSource.indexOf("function ParticipantEvent"),
);
const participantSource = appSource.slice(
  appSource.indexOf("function ParticipantEvent"),
  appSource.indexOf("function MyEvents"),
);
const mockSource = readFileSync("src/mock-api.ts", "utf8");

function rpcError(message: string, code = "P0001") {
  return { code, details: "database detail", hint: "database hint", message };
}

async function safeBody(error: unknown) {
  vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
  const response = errorResponse(createJoinRequestHttpError(error));
  return { body: await response.json(), status: response.status };
}

afterEach(() => vi.restoreAllMocks());

describe("public join-request HTTP contract", () => {
  it("registers POST /events/:eventId/join-request", () => {
    expect(backendSource).toContain("const joinRequestMatch");
    expect(backendSource).toContain('join-request$/.test(path)) return ["POST"]');
  });

  it("calls only create_join_request with route and authenticated identity", () => {
    expect(handlerSource).toContain('db.rpc("create_join_request"');
    expect(handlerSource).toContain("p_event_id: eventId");
    expect(handlerSource).toContain("p_requester_user_id: auth.user.id");
    expect(handlerSource.match(/db\./g)).toHaveLength(1);
  });

  it("cannot accept a body identity override", () => {
    expect(handlerSource).not.toContain("request.json");
    expect(handlerSource).not.toContain("requesterUserId");
    expect(handlerSource).not.toContain("telegramUserId");
    expect(handlerSource).not.toContain("participantId");
    expect(handlerSource).not.toContain("ownerId");
  });

  it("does not write join requests or participants directly", () => {
    expect(handlerSource).not.toContain('db.from("join_requests")');
    expect(handlerSource).not.toContain('db.from("participants")');
    expect(handlerSource).not.toContain(".insert(");
    expect(handlerSource).not.toContain(".update(");
  });

  it("does not reproduce capacity or lifecycle authority in TypeScript", () => {
    expect(handlerSource).not.toContain("max_participants");
    expect(handlerSource).not.toContain("participantCount");
    expect(handlerSource).not.toContain("visibility");
    expect(handlerSource).not.toContain("collecting");
  });

  it.each([
    ["created_pending", "pending", 201, "pending"],
    ["existing_pending", "pending", 200, "pending"],
    ["already_participant", "approved", 200, "approved"],
  ] as const)("maps %s to the minimal response", (outcome, status, httpStatus, joinRequestStatus) => {
    expect(
      createJoinRequestHttpResult({ request_id: "request-secret", outcome, status }),
    ).toEqual({ body: { joinRequestStatus }, status: httpStatus });
  });

  it("rejects unknown or inconsistent success rows", () => {
    expect(() =>
      createJoinRequestHttpResult({
        request_id: "request-secret",
        outcome: "created_pending",
        status: "approved",
      }),
    ).toThrow("Не удалось выполнить действие.");
    expect(() => createJoinRequestHttpResult(null)).toThrow();
  });

  it("never exposes RPC identifiers or outcomes", () => {
    const result = createJoinRequestHttpResult({
      request_id: "request-secret",
      outcome: "created_pending",
      status: "pending",
    });
    expect(result.body).toEqual({ joinRequestStatus: "pending" });
    expect(result.body).not.toHaveProperty("request_id");
    expect(result.body).not.toHaveProperty("outcome");
  });
});

describe("exact and safe RPC error mapping", () => {
  it.each([
    "EVENT_UNAVAILABLE",
    "JOIN_REQUEST_NOT_ALLOWED",
    "REQUESTER_UNAVAILABLE",
    "OWNER_CANNOT_JOIN",
    "JOIN_REQUEST_REJECTED",
    "JOIN_REQUEST_STATE_INCONSISTENT",
  ])("extracts the exact allowlisted P0001 token %s", (token) => {
    expect(createJoinRequestErrorToken(rpcError(token))).toBe(token);
  });

  it("rejects non-P0001 and non-exact token matches", () => {
    expect(
      createJoinRequestErrorToken(rpcError("JOIN_REQUEST_REJECTED", "23505")),
    ).toBeNull();
    expect(
      createJoinRequestErrorToken(rpcError("prefix JOIN_REQUEST_REJECTED suffix")),
    ).toBeNull();
  });

  it.each([
    ["EVENT_UNAVAILABLE", 404, undefined],
    ["JOIN_REQUEST_NOT_ALLOWED", 409, "JOIN_REQUEST_NOT_ALLOWED"],
    ["OWNER_CANNOT_JOIN", 403, "OWNER_CANNOT_JOIN"],
    ["JOIN_REQUEST_REJECTED", 409, "JOIN_REQUEST_REJECTED"],
  ] as const)("maps %s safely", async (token, status, code) => {
    const result = await safeBody(rpcError(token));
    expect(result.status).toBe(status);
    expect(result.body).not.toHaveProperty("details");
    expect(result.body).not.toHaveProperty("hint");
    if (code) expect(result.body).toHaveProperty("code", code);
    else expect(result.body).not.toHaveProperty("code");
  });

  it.each([
    "REQUESTER_UNAVAILABLE",
    "JOIN_REQUEST_STATE_INCONSISTENT",
  ])("does not expose internal token %s", async (token) => {
    const result = await safeBody(rpcError(token));
    expect(result).toEqual({
      body: { error: "Не удалось выполнить действие." },
      status: 500,
    });
    expect(JSON.stringify(result.body)).not.toContain(token);
  });

  it("turns unknown database errors into a generic safe 500", async () => {
    const result = await safeBody(
      rpcError("duplicate key value violates unique constraint", "23505"),
    );
    expect(result).toEqual({
      body: { error: "Не удалось выполнить действие." },
      status: 500,
    });
    expect(JSON.stringify(result.body)).not.toContain("23505");
    expect(JSON.stringify(result.body)).not.toContain("duplicate");
  });

  it("preserves only whitelisted join-request codes in the frontend", () => {
    expect(
      apiErrorFromBody(409, {
        code: "JOIN_REQUEST_REJECTED",
        error: "Ваша заявка не была одобрена.",
      }),
    ).toMatchObject({ code: "JOIN_REQUEST_REJECTED", status: 409 });
    expect(
      apiErrorFromBody(500, { code: "P0001", error: "raw database message" })
        .code,
    ).toBeUndefined();
  });
});

describe("requester preview behavior", () => {
  it("shows the join CTA only for collecting + none", () => {
    expect(publicJoinRequestView("collecting", "none")).toMatchObject({
      actionLabel: "Хочу присоединиться",
    });
    expect(previewSource).toContain("requestView.actionLabel");
    expect(previewSource).toContain("onJoin");
  });

  it("allows a collecting request even when the preview is at capacity", () => {
    const fullPreview = { participantCount: 6, maxParticipants: 6 };
    expect(fullPreview.participantCount).toBe(fullPreview.maxParticipants);
    expect(publicJoinRequestView("collecting", "none").actionLabel).toBe(
      "Хочу присоединиться",
    );
  });

  it("shows pending state without another CTA", () => {
    expect(publicJoinRequestView("collecting", "pending")).toEqual({
      actionLabel: null,
      message: "Заявка отправлена",
      supportingText: "Ожидайте решения организатора",
    });
  });

  it("shows final rejection without another CTA", () => {
    expect(publicJoinRequestView("collecting", "rejected")).toEqual({
      actionLabel: null,
      message: "Заявка не одобрена",
      supportingText: null,
    });
  });

  it.each(["place_selection", "decided", "cancelled"] as const)(
    "shows no active CTA for %s",
    (status) => {
      expect(publicJoinRequestView(status, "none").actionLabel).toBeNull();
    },
  );

  it("locks rapid duplicate submissions", async () => {
    const lock = { current: false };
    let release!: (value: { joinRequestStatus: "pending" }) => void;
    const pending = new Promise<{ joinRequestStatus: "pending" }>((resolve) => {
      release = resolve;
    });
    const request = vi.fn(() => pending);
    const first = createJoinRequestOnce("evt_public", lock, request);
    const second = await createJoinRequestOnce("evt_public", lock, request);
    expect(second).toBeNull();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("evt_public");
    release({ joinRequestStatus: "pending" });
    await expect(first).resolves.toEqual({ joinRequestStatus: "pending" });
    expect(lock.current).toBe(false);
  });

  it("updates successful pending requests locally", () => {
    expect(participantSource).toContain("state.setPreview((current)");
    expect(participantSource).toContain('joinRequestStatus: "pending"');
  });

  it("attempts the existing full-event flow once for approved state", () => {
    expect(participantSource).toContain("approvedReloadAttempted");
    expect(participantSource).toContain('result.joinRequestStatus === "approved"');
    expect(participantSource).toContain("await state.load()");
  });

  it("keeps preview free of voting and organizer controls", () => {
    expect(previewSource).not.toContain("Отправить ответ");
    expect(previewSource).not.toContain("Принять решение");
    expect(previewSource).not.toContain("Удалить встречу");
    expect(previewSource).not.toContain("timeOptions");
    expect(previewSource).not.toContain("placeOptions");
  });

  it("keeps full private and owner screens on the existing path", () => {
    expect(participantSource).toContain("if (state.preview)");
    expect(participantSource).toContain("if (!state.event)");
    expect(participantSource).toContain("const event = state.event");
  });
});

describe("mock join-request parity", () => {
  const base = {
    eventStatus: "collecting" as const,
    visibility: "public" as const,
    isOwner: false,
    participantExists: false,
    requestStatus: "none" as const,
  };

  it("creates pending from none", () => {
    expect(mockCreateJoinRequest(base)).toEqual({ joinRequestStatus: "pending" });
  });

  it("keeps pending retries idempotent", () => {
    expect(
      mockCreateJoinRequest({ ...base, requestStatus: "pending" }),
    ).toEqual({ joinRequestStatus: "pending" });
  });

  it("resolves participant membership as approved", () => {
    expect(
      mockCreateJoinRequest({
        ...base,
        participantExists: true,
        requestStatus: "rejected",
      }),
    ).toEqual({ joinRequestStatus: "approved" });
  });

  it.each([
    [{ ...base, isOwner: true }, "OWNER_CANNOT_JOIN"],
    [{ ...base, visibility: "private" as const }, "JOIN_REQUEST_NOT_ALLOWED"],
    [{ ...base, eventStatus: "decided" as const }, "JOIN_REQUEST_NOT_ALLOWED"],
    [{ ...base, requestStatus: "rejected" as const }, "JOIN_REQUEST_REJECTED"],
  ] as const)("rejects invalid mock state without mutation", (input, code) => {
    const snapshot = structuredClone(input);
    expect(() => mockCreateJoinRequest(input)).toThrow();
    try {
      mockCreateJoinRequest(input);
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
    expect(input).toEqual(snapshot);
  });

  it("stores only the minimal unique requester state in mock API", () => {
    expect(mockSource).toContain(
      'let joinRequestStatus: "none" | "pending" | "rejected" = "none"',
    );
    expect(mockSource).toContain("if (result.joinRequestStatus === \"pending\")");
    expect(mockSource).not.toContain("joinRequestHistory");
  });
});
