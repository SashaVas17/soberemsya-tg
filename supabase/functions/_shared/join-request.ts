import { applicationError } from "./errors.ts";

export type JoinRequestActionResponse = {
  joinRequestStatus: "pending" | "approved";
};

export type CreateJoinRequestRow = {
  request_id: string | null;
  status: string;
  outcome: string;
};

type JoinRequestHttpResult = {
  body: JoinRequestActionResponse;
  status: 200 | 201;
};

const createJoinRequestTokens = new Set([
  "EVENT_UNAVAILABLE",
  "JOIN_REQUEST_NOT_ALLOWED",
  "REQUESTER_UNAVAILABLE",
  "OWNER_CANNOT_JOIN",
  "JOIN_REQUEST_REJECTED",
  "JOIN_REQUEST_STATE_INCONSISTENT",
]);

export function createJoinRequestErrorToken(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== "P0001" || typeof record.message !== "string") return null;
  return createJoinRequestTokens.has(record.message) ? record.message : null;
}

export function createJoinRequestHttpError(error: unknown) {
  switch (createJoinRequestErrorToken(error)) {
    case "EVENT_UNAVAILABLE":
      return Object.assign(new Error("Встреча не найдена или удалена."), {
        status: 404,
      });
    case "JOIN_REQUEST_NOT_ALLOWED":
      return applicationError(
        "JOIN_REQUEST_NOT_ALLOWED",
        409,
        "Сейчас нельзя отправить заявку на эту встречу.",
      );
    case "OWNER_CANNOT_JOIN":
      return applicationError(
        "OWNER_CANNOT_JOIN",
        403,
        "Организатор не может отправить заявку на свою встречу.",
      );
    case "JOIN_REQUEST_REJECTED":
      return applicationError(
        "JOIN_REQUEST_REJECTED",
        409,
        "Ваша заявка не была одобрена.",
      );
    default:
      return new Error("Не удалось выполнить действие.");
  }
}

export function createJoinRequestHttpResult(
  row: CreateJoinRequestRow | null,
): JoinRequestHttpResult {
  if (row?.outcome === "created_pending" && row.status === "pending")
    return { body: { joinRequestStatus: "pending" }, status: 201 };
  if (row?.outcome === "existing_pending" && row.status === "pending")
    return { body: { joinRequestStatus: "pending" }, status: 200 };
  if (row?.outcome === "already_participant" && row.status === "approved")
    return { body: { joinRequestStatus: "approved" }, status: 200 };
  throw new Error("Не удалось выполнить действие.");
}
