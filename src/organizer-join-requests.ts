import { ApiError } from "./api-error";
import type {
  EventStatus,
  JoinRequestDecisionResponse,
  MeetingVisibility,
  OrganizerJoinRequestsResponse,
  Participant,
} from "./types";

export type MockOrganizerJoinRequestRecord = {
  id: string;
  eventId: string;
  requesterUserId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type MockOrganizerRequesterProfile = {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
};

export type MockOrganizerJoinRequestState = {
  event: {
    id: string;
    ownerUserId: string | null;
    visibility: MeetingVisibility;
    status: EventStatus;
    maxParticipants: number | null;
    deleted: boolean;
  };
  requests: MockOrganizerJoinRequestRecord[];
  profiles: MockOrganizerRequesterProfile[];
  participants: Participant[];
};

export type MockJoinRequestDecisionResult = {
  state: MockOrganizerJoinRequestState;
  response: JoinRequestDecisionResponse;
};

function clone(state: MockOrganizerJoinRequestState) {
  return structuredClone(state);
}

function displayName(profile: MockOrganizerRequesterProfile) {
  return [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(" ")
    .trim() || "Пользователь Telegram";
}

function unavailableEvent(): never {
  throw new ApiError("Встреча не найдена или удалена.", 404);
}

function unavailableRequest(): never {
  throw new ApiError("Заявка не найдена.", 404);
}

function conflict(code: "JOIN_REQUEST_NOT_PENDING" | "JOIN_REQUESTS_CLOSED"): never {
  throw new ApiError(
    code === "JOIN_REQUESTS_CLOSED"
      ? "Сбор заявок уже закрыт."
      : "Заявка уже обработана.",
    409,
    code,
  );
}

function internalState(): never {
  throw new Error("Join request state is inconsistent.");
}

function authorize(
  state: MockOrganizerJoinRequestState,
  eventId: string,
  actorUserId: string,
) {
  if (state.event.deleted || state.event.id !== eventId) unavailableEvent();
  if (state.event.ownerUserId !== actorUserId)
    throw new ApiError(
      "У вас нет доступа к управлению этой встречей.",
      403,
      "NOT_EVENT_OWNER",
    );
  if (state.event.visibility !== "public")
    throw new ApiError(
      "Заявки доступны только для открытых встреч.",
      409,
      "JOIN_REQUEST_NOT_ALLOWED",
    );
}

function scopedRequest(
  state: MockOrganizerJoinRequestState,
  eventId: string,
  requestId: string,
) {
  const request = state.requests.find(
    (item) => item.id === requestId && item.eventId === eventId,
  );
  if (!request) unavailableRequest();
  return request;
}

function participantFor(
  state: MockOrganizerJoinRequestState,
  eventId: string,
  requesterUserId: string,
) {
  return state.participants.find(
    (participant) =>
      participant.userId === requesterUserId && state.event.id === eventId,
  );
}

export function listJoinRequests(
  state: MockOrganizerJoinRequestState,
  eventId: string,
  actorUserId: string,
): OrganizerJoinRequestsResponse {
  authorize(state, eventId, actorUserId);
  return {
    requests: state.requests
      .filter((request) => request.eventId === eventId && request.status === "pending")
      .map((request) => {
        const profile = state.profiles.find(
          (item) => item.id === request.requesterUserId,
        );
        if (!profile) internalState();
        return {
          requestId: request.id,
          status: "pending" as const,
          createdAt: request.createdAt,
          requester: {
            displayName: displayName(profile),
            username: profile.username,
          },
        };
      }),
  };
}

export function approveJoinRequest(
  input: MockOrganizerJoinRequestState,
  eventId: string,
  requestId: string,
  actorUserId: string,
): MockJoinRequestDecisionResult {
  authorize(input, eventId, actorUserId);
  const state = clone(input);
  const request = scopedRequest(state, eventId, requestId);
  const participant = participantFor(state, eventId, request.requesterUserId);

  if (request.status === "approved") {
    if (!participant) internalState();
    return { state, response: { requestId, status: "approved" } };
  }
  if (request.status === "rejected") {
    if (state.event.status !== "collecting") conflict("JOIN_REQUESTS_CLOSED");
    conflict("JOIN_REQUEST_NOT_PENDING");
  }
  if (participant) internalState();
  if (state.event.status !== "collecting") conflict("JOIN_REQUESTS_CLOSED");
  if (request.requesterUserId === state.event.ownerUserId)
    throw new ApiError(
      "Организатор не может присоединиться к своей встрече.",
      403,
      "OWNER_CANNOT_JOIN",
    );

  const profile = state.profiles.find((item) => item.id === request.requesterUserId);
  if (!profile) internalState();
  const participantCount = state.participants.filter(
    (item) => item.userId === null || item.userId !== state.event.ownerUserId,
  ).length;
  if (
    state.event.maxParticipants !== null &&
    1 + participantCount >= state.event.maxParticipants
  )
    throw new ApiError(
      "На встрече уже нет свободных мест",
      409,
      "EVENT_FULL",
    );

  state.participants.push({
    id: crypto.randomUUID(),
    userId: request.requesterUserId,
    name: displayName(profile),
    area: "",
    budget: 0,
    preferences: "",
    restrictions: "",
    availableTimeOptionIds: [],
    unavailableTimeOptionIds: [],
  });
  request.status = "approved";
  return { state, response: { requestId, status: "approved" } };
}

export function rejectJoinRequest(
  input: MockOrganizerJoinRequestState,
  eventId: string,
  requestId: string,
  actorUserId: string,
): MockJoinRequestDecisionResult {
  authorize(input, eventId, actorUserId);
  const state = clone(input);
  const request = scopedRequest(state, eventId, requestId);
  if (request.status === "approved") conflict("JOIN_REQUEST_NOT_PENDING");
  if (request.status === "rejected") {
    if (participantFor(state, eventId, request.requesterUserId)) internalState();
    return { state, response: { requestId, status: "rejected" } };
  }
  request.status = "rejected";
  return { state, response: { requestId, status: "rejected" } };
}
