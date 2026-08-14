import { applicationError } from "./errors.ts";

export type OrganizerJoinRequest = {
  requestId: string;
  status: "pending";
  createdAt: string;
  requester: {
    displayName: string;
    username: string | null;
  };
};

export type OrganizerJoinRequestsResponse = {
  requests: OrganizerJoinRequest[];
};

export type JoinRequestDecisionResponse = {
  requestId: string;
  status: "approved" | "rejected";
};

export type JoinRequestListRow = {
  id: string;
  status: string;
  created_at: string;
  requester_user_id: string;
};

export type RequesterProfileRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  username: string | null;
};

export type JoinRequestRetryState = {
  status: string;
  requesterUserId: string;
  participantExists: boolean;
} | null;

export type JoinRequestDecisionAction = "approve" | "reject";
export type JoinRequestRetrySource = "not_pending" | "closed";

const approveTokens = new Set([
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
]);

const rejectTokens = new Set([
  "EVENT_UNAVAILABLE",
  "NOT_EVENT_OWNER",
  "JOIN_REQUEST_NOT_ALLOWED",
  "JOIN_REQUEST_UNAVAILABLE",
  "JOIN_REQUEST_NOT_PENDING",
]);

function unavailableEvent() {
  return Object.assign(new Error("Встреча не найдена или удалена."), {
    status: 404,
  });
}

function unavailableRequest() {
  return Object.assign(new Error("Заявка не найдена."), { status: 404 });
}

function internalStateError() {
  return new Error("Join request state is inconsistent.");
}

export function organizerDisplayName(profile: Pick<RequesterProfileRow, "first_name" | "last_name">) {
  return [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || "Пользователь Telegram";
}

export function organizerJoinRequestsResponse(
  rows: JoinRequestListRow[],
  profiles: RequesterProfileRow[],
): OrganizerJoinRequestsResponse {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  return {
    requests: rows
      .filter((row) => row.status === "pending")
      .map((row) => {
        const profile = profilesById.get(row.requester_user_id);
        if (!profile) throw new Error("Join request requester profile is unavailable.");
        return {
          requestId: row.id,
          status: "pending" as const,
          createdAt: row.created_at,
          requester: {
            displayName: organizerDisplayName(profile),
            username: profile.username,
          },
        };
      }),
  };
}

export function joinRequestDecisionErrorToken(
  error: unknown,
  action: JoinRequestDecisionAction,
) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== "P0001" || typeof record.message !== "string") return null;
  const tokens = action === "approve" ? approveTokens : rejectTokens;
  return tokens.has(record.message) ? record.message : null;
}

export function joinRequestDecisionHttpError(token: string | null) {
  switch (token) {
    case "EVENT_UNAVAILABLE":
      return unavailableEvent();
    case "NOT_EVENT_OWNER":
      return applicationError(
        "NOT_EVENT_OWNER",
        403,
        "У вас нет доступа к управлению этой встречей.",
      );
    case "JOIN_REQUEST_NOT_ALLOWED":
      return applicationError(
        "JOIN_REQUEST_NOT_ALLOWED",
        409,
        "Заявки доступны только для открытых встреч.",
      );
    case "JOIN_REQUESTS_CLOSED":
      return applicationError(
        "JOIN_REQUESTS_CLOSED",
        409,
        "Сбор заявок уже закрыт.",
      );
    case "JOIN_REQUEST_UNAVAILABLE":
      return unavailableRequest();
    case "JOIN_REQUEST_NOT_PENDING":
      return applicationError(
        "JOIN_REQUEST_NOT_PENDING",
        409,
        "Заявка уже обработана.",
      );
    case "OWNER_CANNOT_JOIN":
      return applicationError(
        "OWNER_CANNOT_JOIN",
        403,
        "Организатор не может присоединиться к своей встрече.",
      );
    case "EVENT_FULL":
      return applicationError(
        "EVENT_FULL",
        409,
        "На встрече уже нет свободных мест",
      );
    default:
      return internalStateError();
  }
}

export function joinRequestDecisionResponse(
  requestId: string,
  status: "approved" | "rejected",
): JoinRequestDecisionResponse {
  return { requestId, status };
}

export function resolveJoinRequestDecisionRetry(
  action: JoinRequestDecisionAction,
  requestId: string,
  state: JoinRequestRetryState,
  source: JoinRequestRetrySource,
): JoinRequestDecisionResponse {
  if (!state) throw unavailableRequest();

  if (action === "approve" && state.status === "approved") {
    if (!state.participantExists) throw internalStateError();
    return joinRequestDecisionResponse(requestId, "approved");
  }

  if (action === "reject" && state.status === "rejected") {
    if (state.participantExists) throw internalStateError();
    return joinRequestDecisionResponse(requestId, "rejected");
  }

  if (state.status === "pending" && state.participantExists)
    throw internalStateError();

  if (source === "closed")
    throw joinRequestDecisionHttpError("JOIN_REQUESTS_CLOSED");

  throw joinRequestDecisionHttpError("JOIN_REQUEST_NOT_PENDING");
}
