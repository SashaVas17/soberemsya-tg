import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  applyMockResponse,
} from "../src/participant-voting";
import {
  assertEventAvailable,
  assertVotingOpen,
  authorizeParticipantResponse,
} from "../supabase/functions/_shared/domain";
import { errorResponse } from "../supabase/functions/_shared/http";
import type { EventData, TelegramUser } from "../src/types";

const user: TelegramUser = {
  id: "user_current",
  telegramUserId: "1001",
  username: "current",
  firstName: "Анна",
  lastName: null,
  photoUrl: null,
};

const response = {
  area: "Центр",
  budget: 30,
  preferences: "Тихое место",
  restrictions: "",
  availableTimeOptionIds: ["time_1"],
};

function meeting(overrides: Partial<EventData> = {}): EventData {
  return {
    id: "evt_public",
    title: "Открытая встреча",
    description: "",
    budgetLimit: 30,
    visibility: "public",
    maxParticipants: 6,
    status: "collecting",
    finalPlaceId: null,
    finalTimeOptionId: null,
    timeOptions: [
      { id: "time_1", startsAt: "2026-10-15T16:00:00.000Z", availableCount: 0 },
    ],
    placeOptions: [],
    participants: [],
    canManage: false,
    myResponse: null,
    ...overrides,
  };
}

function participant(id = "participant_current") {
  return {
    id,
    userId: user.id,
    name: user.firstName,
    area: "",
    budget: 0,
    preferences: "",
    restrictions: "",
    availableTimeOptionIds: [],
    unavailableTimeOptionIds: [],
  };
}

function captureError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error as Error & { code?: string; status?: number };
  }
  throw new Error("Expected authorization to fail");
}

describe("public response authorization", () => {
  it("allows a private first response to create a participant", () => {
    expect(authorizeParticipantResponse({ visibility: "private", ownerUserId: null, currentUserId: user.id, participantId: null })).toBe("insert-private");
  });

  it("updates an existing private participant", () => {
    expect(authorizeParticipantResponse({ visibility: "private", ownerUserId: null, currentUserId: user.id, participantId: "participant_1" })).toBe("update");
  });

  it("treats missing legacy visibility as private", () => {
    expect(authorizeParticipantResponse({ visibility: undefined, ownerUserId: null, currentUserId: user.id, participantId: null })).toBe("insert-private");
  });

  it("rejects a public user without participant membership", () => {
    const error = captureError(() => authorizeParticipantResponse({ visibility: "public", ownerUserId: "owner", currentUserId: user.id, participantId: null }));
    expect(error).toMatchObject({ code: "PUBLIC_JOIN_REQUIRED", status: 403 });
    expect(error.message).toBe("Сначала отправьте заявку и дождитесь одобрения организатора.");
  });

  it("allows an approved public participant to update", () => {
    expect(authorizeParticipantResponse({ visibility: "public", ownerUserId: "owner", currentUserId: user.id, participantId: "participant_1" })).toBe("update");
  });

  it("keeps repeated public edits on the update path", () => {
    const input = { visibility: "public", ownerUserId: "owner", currentUserId: user.id, participantId: "participant_1" };
    expect(authorizeParticipantResponse(input)).toBe("update");
    expect(authorizeParticipantResponse(input)).toBe("update");
  });

  it("rejects the public owner even if an owner participant row exists", () => {
    const error = captureError(() => authorizeParticipantResponse({ visibility: "public", ownerUserId: user.id, currentUserId: user.id, participantId: "owner_participant" }));
    expect(error).toMatchObject({ code: "PUBLIC_OWNER_CANNOT_RESPOND", status: 403 });
    expect(error.message).toBe("Организатор не может отвечать как участник открытой встречи.");
  });

  it("cannot bypass a full public meeting through saveResponse authorization", () => {
    expect(() => authorizeParticipantResponse({ visibility: "public", ownerUserId: "owner", currentUserId: user.id, participantId: null })).toThrow();
  });
});

describe("safe application error responses", () => {
  it.each([
    ["PUBLIC_JOIN_REQUIRED", "Сначала отправьте заявку и дождитесь одобрения организатора."],
    ["PUBLIC_OWNER_CANNOT_RESPOND", "Организатор не может отвечать как участник открытой встречи."],
  ] as const)("returns the whitelisted %s code", async (expectedCode, message) => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const error = captureError(() => authorizeParticipantResponse({ visibility: "public", ownerUserId: expectedCode === "PUBLIC_OWNER_CANNOT_RESPOND" ? user.id : "owner", currentUserId: user.id, participantId: null }));
    const result = errorResponse(error);
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ error: message, code: expectedCode });
  });

  it("does not expose raw database error codes", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const result = errorResponse(Object.assign(new Error("duplicate"), { code: "23505" }));
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ error: "Не удалось выполнить действие." });
  });
});

describe("mock response parity", () => {
  it("creates once and then updates the same private participant", () => {
    const initial = meeting({ visibility: "private", maxParticipants: null });
    const created = applyMockResponse(initial, user, response);
    const edited = applyMockResponse(created, user, { ...response, area: "Немига" });
    expect(created.participants).toHaveLength(1);
    expect(edited.participants).toHaveLength(1);
    expect(edited.participants[0]).toMatchObject({ id: created.participants[0].id, area: "Немига" });
  });

  it("updates an approved public participant without creating a duplicate", () => {
    const initial = meeting({ participants: [participant()] });
    const first = applyMockResponse(initial, user, response);
    const second = applyMockResponse(first, user, { ...response, budget: 45 });
    expect(first.participants).toHaveLength(1);
    expect(second.participants).toHaveLength(1);
    expect(second.participants[0]).toMatchObject({ id: "participant_current", budget: 45 });
  });

  it("does not mutate participants or votes when public membership is missing", () => {
    const initial = meeting({ timeOptions: [{ id: "time_1", startsAt: "2026-10-15T16:00:00.000Z", availableCount: 4 }] });
    expect(() => applyMockResponse(initial, user, response)).toThrow();
    expect(initial.participants).toEqual([]);
    expect(initial.timeOptions[0].availableCount).toBe(4);
  });

  it("does not mutate participants or votes for a public owner", () => {
    const initial = meeting({ canManage: true });
    expect(() => applyMockResponse(initial, user, response)).toThrow();
    expect(initial.participants).toEqual([]);
    expect(initial.timeOptions[0].availableCount).toBe(0);
  });

  it("does not modify an unrelated participant after failed authorization", () => {
    const other = { ...participant("participant_other"), userId: "user_other" };
    const initial = meeting({ participants: [other] });
    expect(() => applyMockResponse(initial, user, response)).toThrow();
    expect(initial.participants).toEqual([other]);
  });
});

describe("saveResponse architecture guard", () => {
  const source = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
  const saveResponse = source.slice(source.indexOf("async function saveResponse"), source.indexOf("async function manageEvent"));

  it("loads status, visibility and owner in the existing event query", () => {
    expect(saveResponse).toContain('select("status,visibility,owner_user_id")');
    expect(saveResponse.match(/db\.from\("events"\)/g)).toHaveLength(1);
  });

  it("authorizes before options and every participant or vote write", () => {
    const authorization = saveResponse.indexOf("authorizeParticipantResponse");
    expect(authorization).toBeGreaterThan(saveResponse.indexOf("assertVotingOpen"));
    for (const write of ['db.from("time_options")', 'db.from("participants").update', 'db.from("participants").insert', 'db.from("availability_votes").delete', 'db.from("availability_votes").insert'])
      expect(authorization).toBeLessThan(saveResponse.indexOf(write));
  });

  it("keeps membership authoritative and does not query join requests", () => {
    expect(saveResponse).toContain('.eq("event_id", eventId).eq("user_id", auth.user.id)');
    expect(saveResponse).not.toContain("join_requests");
  });

  it("keeps participant insertion behind the private-only authorization action", () => {
    expect(saveResponse).toContain('authorization === "update"');
    expect(authorizeParticipantResponse({ visibility: "private", ownerUserId: null, currentUserId: user.id, participantId: null })).toBe("insert-private");
    expect(() => authorizeParticipantResponse({ visibility: "public", ownerUserId: "owner", currentUserId: user.id, participantId: null })).toThrow();
  });

  it("preserves deleted and closed-event guards before public authorization", () => {
    expect(saveResponse.indexOf('.is("deleted_at", null)')).toBeLessThan(saveResponse.indexOf("authorizeParticipantResponse"));
    expect(saveResponse.indexOf("assertVotingOpen")).toBeLessThan(saveResponse.indexOf("authorizeParticipantResponse"));
    expect(() => assertEventAvailable(null)).toThrow("не найдена");
    expect(() => assertVotingOpen("place_selection")).toThrow("закрыт");
    expect(() => assertVotingOpen("decided")).toThrow("закрыт");
    expect(() => assertVotingOpen("cancelled")).toThrow("закрыт");
    expect(() => assertVotingOpen("collecting")).not.toThrow();
  });
});
