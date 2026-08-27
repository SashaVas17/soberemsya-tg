import { describe, expect, it } from "vitest";
import {
  organizerEventPayload,
  participantEventPayload,
  privateInviteEventPayload,
  resolveEventViewerRole,
  type EventPayloadSource,
} from "../supabase/functions/_shared/event-payload";
import { authorizeParticipantResponse } from "../supabase/functions/_shared/domain";

function source(currentUserId: string): EventPayloadSource {
  return {
    event: {
      id: "evt_private",
      owner_user_id: "owner",
      title: "Встреча команды",
      description: "Поговорим о планах",
      budget_limit: 45,
      visibility: "private",
      max_participants: null,
      status: "collecting",
      final_place_id: null,
      final_time_option_id: null,
      created_at: "2026-08-17T12:00:00.000Z",
    },
    times: [{ id: "time_1", starts_at: "2026-08-21T16:00:00.000Z" }],
    places: [{ id: "place_1", title: "Публика", area: "Немига", estimated_budget: 45 }],
    participants: [
      {
        id: "participant_owner",
        user_id: "owner",
        name: "Организатор",
        area: "Центр",
        budget: 50,
        preferences: "У окна",
        restrictions: "Без орехов",
      },
      {
        id: "participant_member",
        user_id: "member",
        name: "Ирина",
        area: "Немига",
        budget: 35,
        preferences: "Тихий стол",
        restrictions: "Без лактозы",
      },
    ],
    votes: [
      { participant_id: "participant_owner", time_option_id: "time_1", is_available: true },
      { participant_id: "participant_member", time_option_id: "time_1", is_available: false },
    ],
    placeVotes: [
      { participant_id: "participant_owner", place_option_id: "place_1" },
      { participant_id: "participant_member", place_option_id: "place_1" },
    ],
    currentUserId,
  };
}

function serialized(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function expectNoKeys(value: unknown, forbidden: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) expectNoKeys(item, forbidden);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      expect(forbidden).not.toContain(key);
      expectNoKeys(item, forbidden);
    }
  }
}

describe("role-scoped event payloads", () => {
  it("keeps organizer management data detailed", () => {
    const payload = serialized(organizerEventPayload(source("owner")));
    expect(payload.canManage).toBe(true);
    expect(payload.participants).toEqual([
      expect.objectContaining({
        id: "participant_owner",
        userId: "owner",
        name: "Организатор",
        budget: 50,
        preferences: "У окна",
        availableTimeOptionIds: ["time_1"],
      }),
      expect.objectContaining({
        id: "participant_member",
        userId: "member",
        restrictions: "Без лактозы",
        unavailableTimeOptionIds: ["time_1"],
      }),
    ]);
  });

  it("returns only social data for a private or approved participant while preserving own edit data", () => {
    const payload = serialized(participantEventPayload(source("member")));
    expect(payload.canManage).toBe(false);
    expect(payload.participants).toEqual([
      { name: "Организатор", area: "Центр" },
      { name: "Ирина", area: "Немига" },
    ]);
    expect(payload.myResponse).toEqual({
      name: "Ирина",
      area: "Немига",
      budget: 35,
      preferences: "Тихий стол",
      restrictions: "Без лактозы",
      availableTimeOptionIds: [],
      unavailableTimeOptionIds: ["time_1"],
      selectedPlaceOptionIds: ["place_1"],
    });
    expectNoKeys(payload.participants, [
      "id",
      "userId",
      "user_id",
      "budget",
      "preferences",
      "restrictions",
      "availableTimeOptionIds",
      "unavailableTimeOptionIds",
    ]);
    expectNoKeys(payload.myResponse, ["id", "userId", "user_id"]);
  });

  it("keeps private invitees name-only while allowing their first response", () => {
    const payload = serialized(privateInviteEventPayload(source("invitee")));
    expect(payload).toMatchObject({
      title: "Встреча команды",
      budgetLimit: 45,
      timeOptions: [{ id: "time_1", availableCount: 1 }],
      placeOptions: [{ id: "place_1", title: "Публика" }],
      canManage: false,
      myResponse: null,
      participants: [{ name: "Организатор" }, { name: "Ирина" }],
    });
    expectNoKeys(payload.participants, [
      "id",
      "userId",
      "user_id",
      "area",
      "budget",
      "preferences",
      "restrictions",
      "availableTimeOptionIds",
      "unavailableTimeOptionIds",
    ]);
    expect(
      authorizeParticipantResponse({
        visibility: "private",
        ownerUserId: "owner",
        currentUserId: "invitee",
        participantId: null,
      }),
    ).toBe("insert-private");
  });

  it("keeps public strangers on the existing safe preview boundary", () => {
    expect(() =>
      resolveEventViewerRole({
        visibility: "public",
        ownerUserId: "owner",
        currentUserId: "stranger",
        participantExists: false,
      }),
    ).toThrow("Доступна только публичная информация о встрече.");
  });
});
