import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { apiErrorFromBody, hasApiErrorCode } from "../src/api-error";
import {
  mockPublicEventAccess,
  mockPublicEventPreview,
  previewDateSummary,
  type MockPublicRole,
} from "../src/public-preview";
import type { EventData } from "../src/types";
import {
  assertEventAvailable,
  assertFullEventReadAccess,
} from "../supabase/functions/_shared/domain";
import { errorResponse } from "../supabase/functions/_shared/http";
import {
  buildPublicEventPreview,
  publicDateSummary,
  publicParticipantCount,
  resolveJoinRequestStatus,
} from "../supabase/functions/_shared/public-preview";

const backendSource = readFileSync(
  "supabase/functions/telegram-api/index.ts",
  "utf8",
);
const appSource = readFileSync("src/App.tsx", "utf8");
const apiSource = readFileSync("src/api.ts", "utf8");
const migrationSource = readFileSync(
  "supabase/migrations/20260814104624_open_meetings_foundation.sql",
  "utf8",
);

const baseEvent: EventData = {
  id: "evt_public",
  title: "Открытая встреча",
  description: "Описание без приватных данных",
  budgetLimit: 40,
  visibility: "public",
  maxParticipants: 6,
  status: "collecting",
  finalPlaceId: null,
  finalTimeOptionId: null,
  timeOptions: [
    {
      id: "time_secret",
      startsAt: "2026-08-15T16:30:00.000Z",
      availableCount: 4,
    },
  ],
  placeOptions: [
    {
      id: "place_secret",
      title: "Секретное место",
      area: "Секретный район",
      estimatedBudget: 30,
    },
  ],
  participants: [],
  canManage: false,
  myResponse: null,
};

const previewInput = (overrides: Record<string, unknown> = {}) => ({
  event: {
    id: "evt_public",
    title: "Открытая встреча",
    description: "Описание",
    status: "collecting" as const,
    budgetLimit: 40,
    maxParticipants: 6,
  },
  startsAtValues: ["2026-08-15T16:30:00.000Z"],
  participantUserIds: ["user_approved"],
  ownerUserId: "user_owner",
  participantExists: false,
  requestStatus: null,
  ...overrides,
});

function captureError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error as Error & { code?: string; status?: number };
  }
  throw new Error("Expected operation to fail");
}

describe("full public event read authorization", () => {
  it("keeps full access for a private known-ID user", () => {
    expect(() => assertFullEventReadAccess({ visibility: "private", ownerUserId: "owner", currentUserId: "attacker", participantExists: false })).not.toThrow();
  });

  it("keeps full access for a public owner", () => {
    expect(() => assertFullEventReadAccess({ visibility: "public", ownerUserId: "owner", currentUserId: "owner", participantExists: false })).not.toThrow();
  });

  it("keeps full access for an existing public participant", () => {
    expect(() => assertFullEventReadAccess({ visibility: "public", ownerUserId: "owner", currentUserId: "participant", participantExists: true })).not.toThrow();
  });

  it("rejects a no-request public user with the safe preview code", () => {
    const error = captureError(() => assertFullEventReadAccess({ visibility: "public", ownerUserId: "owner", currentUserId: "stranger", participantExists: false }));
    expect(error).toMatchObject({ code: "PUBLIC_PREVIEW_REQUIRED", status: 403 });
    expect(error.message).toBe("Доступна только публичная информация о встрече.");
  });

  it("serializes PUBLIC_PREVIEW_REQUIRED through the server whitelist", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const error = captureError(() => assertFullEventReadAccess({ visibility: "public", ownerUserId: "owner", currentUserId: "stranger", participantExists: false }));
    const response = errorResponse(error);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Доступна только публичная информация о встрече.",
      code: "PUBLIC_PREVIEW_REQUIRED",
    });
  });

  it.each(["pending", "rejected"])("does not treat a %s request as full membership", () => {
    expect(() => assertFullEventReadAccess({ visibility: "public", ownerUserId: "owner", currentUserId: "requester", participantExists: false })).toThrow();
  });

  it("does not treat an approved join request without a participant as full membership", () => {
    expect(resolveJoinRequestStatus(false, "approved")).toBe("none");
    expect(() => assertFullEventReadAccess({ visibility: "public", ownerUserId: "owner", currentUserId: "requester", participantExists: false })).toThrow();
  });

  it("cannot bypass the full gate with a directly known public ID", () => {
    const fullRead = backendSource.slice(
      backendSource.indexOf("async function fullEventForRequest"),
      backendSource.indexOf("async function publicEventPreview"),
    );
    expect(fullRead).toContain('.eq("event_id", eventId).eq("user_id", userId)');
    expect(fullRead).toContain("assertFullEventReadAccess");
  });

  it("runs the public full gate before sensitive full payload loading", () => {
    const fullRead = backendSource.slice(
      backendSource.indexOf("async function fullEventForRequest"),
      backendSource.indexOf("async function publicEventPreview"),
    );
    expect(fullRead.indexOf("assertFullEventReadAccess")).toBeLessThan(
      fullRead.indexOf("eventPayload"),
    );
  });

  it("loads the event row only once before an authorized full payload", () => {
    const fullRead = backendSource.slice(
      backendSource.indexOf("async function fullEventForRequest"),
      backendSource.indexOf("async function publicEventPreview"),
    );
    expect(fullRead.match(/loadFullEventRow/g)).toHaveLength(1);
    expect(fullRead).toContain("eventPayload(eventId, userId, event)");
  });
});

describe("public preview shape and privacy", () => {
  const preview = buildPublicEventPreview(previewInput());

  it("returns the approved exact field set", () => {
    expect(Object.keys(preview)).toEqual([
      "id",
      "visibility",
      "title",
      "description",
      "status",
      "dateSummary",
      "budgetLimit",
      "participantCount",
      "maxParticipants",
      "joinRequestStatus",
    ]);
  });

  it("returns title and description", () => {
    expect(preview).toMatchObject({ title: "Открытая встреча", description: "Описание" });
  });

  it("returns only date-level information", () => {
    expect(preview.dateSummary).toBe("15 августа");
    expect(JSON.stringify(preview)).not.toContain("16:30");
  });

  it("contains no location", () => {
    expect(preview).not.toHaveProperty("location");
    expect(preview).not.toHaveProperty("area");
  });

  it("returns only the event-level budget", () => {
    expect(preview.budgetLimit).toBe(40);
    expect(preview).not.toHaveProperty("participantBudget");
  });

  it("returns maxParticipants unchanged", () => {
    expect(preview.maxParticipants).toBe(6);
  });

  it("contains no participant IDs or user IDs", () => {
    expect(preview).not.toHaveProperty("participants");
    expect(preview).not.toHaveProperty("userId");
    expect(preview).not.toHaveProperty("ownerUserId");
  });

  it("contains no participant names or personal fields", () => {
    for (const field of ["name", "preferences", "restrictions", "myResponse"])
      expect(preview).not.toHaveProperty(field);
  });

  it("contains no availability fields or counts", () => {
    expect(preview).not.toHaveProperty("timeOptions");
    expect(preview).not.toHaveProperty("availableCount");
    expect(preview).not.toHaveProperty("availabilityVotes");
  });

  it("contains no place titles, areas or IDs", () => {
    expect(preview).not.toHaveProperty("placeOptions");
    expect(preview).not.toHaveProperty("finalPlaceId");
  });

  it("contains no exact timestamps or time option IDs", () => {
    expect(preview).not.toHaveProperty("startsAt");
    expect(preview).not.toHaveProperty("finalTimeOptionId");
  });

  it("contains no organizer flag or creation timestamp", () => {
    expect(preview).not.toHaveProperty("canManage");
    expect(preview).not.toHaveProperty("createdAt");
  });

  it("dedicated preview query does not load sensitive relations", () => {
    const source = backendSource.slice(
      backendSource.indexOf("async function publicEventPreview"),
      backendSource.indexOf("async function createEvent"),
    );
    expect(source).toContain('select("starts_at")');
    expect(source).toContain('select("user_id")');
    expect(source).not.toContain('db.from("place_options")');
    expect(source).not.toContain('db.from("availability_votes")');
    expect(source).not.toContain("eventPayload(");
  });
});

describe("preview date summary", () => {
  it("formats one Minsk date", () => {
    expect(publicDateSummary(["2026-08-15T16:30:00.000Z"])).toBe("15 августа");
  });

  it("formats a same-month range", () => {
    expect(publicDateSummary(["2026-08-17T10:00:00.000Z", "2026-08-15T10:00:00.000Z"])).toBe("15–17 августа");
  });

  it("formats a cross-month range", () => {
    expect(publicDateSummary(["2026-08-30T10:00:00.000Z", "2026-09-02T10:00:00.000Z"])).toBe("30 августа – 2 сентября");
  });

  it("returns null without a valid date", () => {
    expect(publicDateSummary([])).toBeNull();
    expect(publicDateSummary(["invalid"])).toBeNull();
  });

  it("keeps mock and backend formatters aligned", () => {
    const dates = ["2026-08-30T10:00:00.000Z", "2026-09-02T10:00:00.000Z"];
    expect(previewDateSummary(dates)).toBe(publicDateSummary(dates));
  });
});

describe("participant count and join status", () => {
  it("includes the owner once", () => {
    expect(publicParticipantCount("owner", ["participant_1", "participant_2"])).toBe(3);
  });

  it("does not double-count a legacy owner participant row", () => {
    expect(publicParticipantCount("owner", ["owner", "participant_1"])).toBe(2);
  });

  it("counts a legacy null-user participant", () => {
    expect(publicParticipantCount("owner", [null, "participant_1"])).toBe(3);
  });

  it("counts rows as-is when a legacy event has no owner", () => {
    expect(publicParticipantCount(null, [null, "participant_1"])).toBe(2);
  });

  it("resolves no request", () => {
    expect(resolveJoinRequestStatus(false, null)).toBe("none");
  });

  it("resolves a pending request", () => {
    expect(resolveJoinRequestStatus(false, "pending")).toBe("pending");
  });

  it("resolves a rejected request", () => {
    expect(resolveJoinRequestStatus(false, "rejected")).toBe("rejected");
  });

  it("prioritizes participant membership as approved", () => {
    expect(resolveJoinRequestStatus(true, "rejected")).toBe("approved");
  });

  it("maps an inconsistent approved request without membership to none", () => {
    expect(resolveJoinRequestStatus(false, "approved")).toBe("none");
  });
});

describe("preview route, frontend and mock boundaries", () => {
  it("registers preview before the generic full event route", () => {
    expect(backendSource.indexOf("const previewMatch")).toBeLessThan(
      backendSource.indexOf("const eventMatch"),
    );
  });

  it("keeps deleted full and preview events unavailable", () => {
    expect(() => assertEventAvailable(null)).toThrow("не найдена");
    expect(() => assertEventAvailable({ deleted_at: "2026-08-15" })).toThrow("не найдена");
    expect(backendSource).toContain('.is("deleted_at", null).maybeSingle<PreviewEventRow>()');
  });

  it("keeps private preview unavailable", () => {
    const source = backendSource.slice(
      backendSource.indexOf("async function publicEventPreview"),
      backendSource.indexOf("async function createEvent"),
    );
    expect(source).toContain('event.visibility !== "public"');
    expect(source).toContain("status: 404");
  });

  it("keeps api.event full-only and adds a separate preview method", () => {
    expect(apiSource).toContain("request<{ event: EventData }>");
    expect(apiSource).toContain("publicEventPreview");
    expect(apiSource).toContain("request<{ preview: PublicEventPreview }>");
  });

  it("ParticipantEvent explicitly falls back only for PUBLIC_PREVIEW_REQUIRED", () => {
    const source = appSource.slice(
      appSource.indexOf("function ParticipantEvent("),
      appSource.indexOf("function MyEvents("),
    );
    expect(source).toContain("useParticipantEvent(eventId)");
    expect(appSource).toContain('hasApiErrorCode(reason, "PUBLIC_PREVIEW_REQUIRED")');
    expect(source).toContain("<PublicPreviewScreen");
  });

  it("Manage remains a full EventData consumer", () => {
    const source = appSource.slice(
      appSource.indexOf("function Manage("),
      appSource.indexOf("function Result("),
    );
    expect(source).toContain("useEvent(eventId)");
    expect(source).not.toContain("publicEventPreview");
    expect(source).not.toContain("PublicPreviewScreen");
  });

  it("Result remains a full EventData consumer", () => {
    const source = appSource.slice(
      appSource.indexOf("function Result("),
      appSource.indexOf("function telegramAppConfig("),
    );
    expect(source).toContain("useEvent(eventId)");
    expect(source).not.toContain("publicEventPreview");
    expect(source).not.toContain("PublicPreviewScreen");
  });

  it("typed ApiError preserves the whitelisted preview code", () => {
    const error = apiErrorFromBody(403, { error: "Безопасное сообщение", code: "PUBLIC_PREVIEW_REQUIRED" });
    expect(error).toMatchObject({ message: "Безопасное сообщение", status: 403, code: "PUBLIC_PREVIEW_REQUIRED" });
    expect(hasApiErrorCode(error, "PUBLIC_PREVIEW_REQUIRED")).toBe(true);
  });

  it("raw database codes never become frontend application codes", () => {
    const error = apiErrorFromBody(409, { error: "duplicate", code: "23505" });
    expect(error.code).toBeUndefined();
    expect(hasApiErrorCode(error, "PUBLIC_PREVIEW_REQUIRED")).toBe(false);
  });

  it.each([
    ["none", false],
    ["pending", false],
    ["rejected", false],
    ["approved", true],
    ["owner", true],
  ] as Array<[MockPublicRole, boolean]>)("mock role %s matches full-access behavior", (role, allowed) => {
    if (allowed)
      expect(mockPublicEventAccess(baseEvent, role).event.id).toBe(baseEvent.id);
    else
      expect(() => mockPublicEventAccess(baseEvent, role)).toThrow();
  });

  it.each(["none", "pending", "rejected", "approved", "owner"] as MockPublicRole[])("mock role %s receives preview-only shape", (role) => {
    const { preview } = mockPublicEventPreview(baseEvent, role);
    expect(preview.visibility).toBe("public");
    expect(preview).not.toHaveProperty("timeOptions");
    expect(preview).not.toHaveProperty("placeOptions");
    expect(preview).not.toHaveProperty("participants");
  });

  it("keeps the foundation migration unchanged in scope", () => {
    expect(migrationSource).toContain("create table if not exists public.join_requests");
    expect(backendSource).not.toContain("apply_migration");
  });
});
