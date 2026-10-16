import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api-error";
import {
  approveJoinRequest,
  listJoinRequests,
  rejectJoinRequest,
  type MockOrganizerJoinRequestState,
} from "../src/organizer-join-requests";

const eventId = "evt_public";
const ownerId = "user_owner";
const requesterId = "user_requester";
const requestId = "11111111-1111-4111-8111-111111111111";

function state(
  overrides: Partial<MockOrganizerJoinRequestState["event"]> = {},
): MockOrganizerJoinRequestState {
  return {
    event: {
      id: eventId,
      ownerUserId: ownerId,
      visibility: "public",
      status: "collecting",
      maxParticipants: null,
      deleted: false,
      ...overrides,
    },
    requests: [
      {
        id: requestId,
        eventId,
        requesterUserId: requesterId,
        status: "pending",
        createdAt: "2026-08-14T10:00:00.000Z",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        eventId,
        requesterUserId: "user_rejected",
        status: "rejected",
        createdAt: "2026-08-14T09:00:00.000Z",
      },
    ],
    profiles: [
      {
        id: requesterId,
        firstName: "Анна",
        lastName: "Иванова",
        username: "anna",
      },
      {
        id: "user_rejected",
        firstName: "Игорь",
        lastName: null,
        username: null,
      },
    ],
    participants: [],
  };
}

function expectApiError(
  operation: () => unknown,
  status: number,
  code?: string,
) {
  try {
    operation();
    throw new Error("Expected operation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, ...(code ? { code } : {}) });
  }
}

describe("organizer join request mock parity", () => {
  it("lists only pending requests with safe requester fields", () => {
    const response = listJoinRequests(state(), eventId, ownerId);

    expect(response).toEqual({
      requests: [
        {
          requestId,
          status: "pending",
          createdAt: "2026-08-14T10:00:00.000Z",
          requester: {
            displayName: "Анна Иванова",
            username: "anna",
          },
        },
      ],
    });
    expect(JSON.stringify(response)).not.toContain(requesterId);
  });

  it("allows pending-list inspection after collecting closes", () => {
    const response = listJoinRequests(
      state({ status: "decided" }),
      eventId,
      ownerId,
    );

    expect(response.requests).toHaveLength(1);
  });

  it("uses a neutral display name and preserves a null username", () => {
    const input = state();
    input.profiles[0] = {
      id: requesterId,
      firstName: "",
      lastName: null,
      username: null,
    };

    expect(listJoinRequests(input, eventId, ownerId).requests[0].requester)
      .toEqual({
        displayName: "Пользователь Telegram",
        username: null,
      });
  });

  it("mirrors deleted, private and non-owner authorization", () => {
    expectApiError(
      () => listJoinRequests(state({ deleted: true }), eventId, ownerId),
      404,
    );
    expectApiError(
      () => listJoinRequests(state({ visibility: "private" }), eventId, ownerId),
      409,
      "JOIN_REQUEST_NOT_ALLOWED",
    );
    expectApiError(
      () => listJoinRequests(state(), eventId, "user_other"),
      403,
      "NOT_EVENT_OWNER",
    );
  });

  it("approves once and treats an authoritative retry as idempotent", () => {
    const first = approveJoinRequest(state(), eventId, requestId, ownerId);
    const second = approveJoinRequest(
      first.state,
      eventId,
      requestId,
      ownerId,
    );

    expect(first.response).toEqual({ requestId, status: "approved" });
    expect(second.response).toEqual({ requestId, status: "approved" });
    expect(second.state.participants).toHaveLength(1);
    expect(second.state.participants[0].userId).toBe(requesterId);
    expect(second.state.requests[0].status).toBe("approved");
  });

  it("rejects without participant mutation and repeats stably", () => {
    const first = rejectJoinRequest(state(), eventId, requestId, ownerId);
    const second = rejectJoinRequest(
      first.state,
      eventId,
      requestId,
      ownerId,
    );

    expect(second.response).toEqual({ requestId, status: "rejected" });
    expect(second.state.requests[0].status).toBe("rejected");
    expect(second.state.participants).toEqual([]);
  });

  it("does not reverse either terminal action", () => {
    const approved = approveJoinRequest(state(), eventId, requestId, ownerId);
    expectApiError(
      () => rejectJoinRequest(approved.state, eventId, requestId, ownerId),
      409,
      "JOIN_REQUEST_NOT_PENDING",
    );

    const rejected = rejectJoinRequest(state(), eventId, requestId, ownerId);
    expectApiError(
      () => approveJoinRequest(rejected.state, eventId, requestId, ownerId),
      409,
      "JOIN_REQUEST_NOT_PENDING",
    );
  });

  it("isolates request IDs from another event", () => {
    expectApiError(
      () => approveJoinRequest(state(), "evt_other", requestId, ownerId),
      404,
    );
    expectApiError(
      () => rejectJoinRequest(state(), "evt_other", requestId, ownerId),
      404,
    );
  });

  it("keeps a full-capacity request pending", () => {
    const input = state({ maxParticipants: 2 });
    input.participants.push({
      id: "participant_existing",
      userId: "user_existing",
      name: "Ирина",
      area: "",
      budget: 0,
      preferences: "",
      restrictions: "",
      availableTimeOptionIds: [],
      unavailableTimeOptionIds: [],
    });

    expectApiError(
      () => approveJoinRequest(input, eventId, requestId, ownerId),
      409,
      "EVENT_FULL",
    );
    expect(input.requests[0].status).toBe("pending");
    expect(input.participants).toHaveLength(1);
  });

  it("treats pending membership and rejected membership as inconsistent", () => {
    const input = state();
    input.participants.push({
      id: "participant_requester",
      userId: requesterId,
      name: "Анна Иванова",
      area: "",
      budget: 0,
      preferences: "",
      restrictions: "",
      availableTimeOptionIds: [],
      unavailableTimeOptionIds: [],
    });

    expect(() =>
      approveJoinRequest(input, eventId, requestId, ownerId),
    ).toThrow("Join request state is inconsistent.");

    input.requests[0].status = "rejected";
    expect(() =>
      rejectJoinRequest(input, eventId, requestId, ownerId),
    ).toThrow("Join request state is inconsistent.");
  });

  it("keeps closed approval unavailable while reject remains allowed", () => {
    const closed = state({ status: "place_selection" });
    expectApiError(
      () => approveJoinRequest(closed, eventId, requestId, ownerId),
      409,
      "JOIN_REQUESTS_CLOSED",
    );

    const rejected = rejectJoinRequest(closed, eventId, requestId, ownerId);
    expect(rejected.response.status).toBe("rejected");
  });

  it("never approves an owner request but permits a safe rejection", () => {
    const input = state();
    input.requests[0].requesterUserId = ownerId;
    input.profiles[0].id = ownerId;

    expectApiError(
      () => approveJoinRequest(input, eventId, requestId, ownerId),
      403,
      "OWNER_CANNOT_JOIN",
    );
    const rejected = rejectJoinRequest(input, eventId, requestId, ownerId);
    expect(rejected.response).toEqual({ requestId, status: "rejected" });
    expect(rejected.state.participants).toEqual([]);
  });
});
