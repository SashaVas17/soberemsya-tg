import { ApiError } from "./api-error";
import type {
  EventStatus,
  JoinRequestActionResponse,
  JoinRequestStatus,
} from "./types";

export type JoinRequestSubmissionLock = { current: boolean };

export type PublicJoinRequestView = {
  actionLabel: string | null;
  message: string;
  supportingText: string | null;
};

export function publicJoinRequestView(
  status: EventStatus,
  joinRequestStatus: JoinRequestStatus,
): PublicJoinRequestView {
  if (status === "cancelled")
    return {
      actionLabel: null,
      message: "Встреча отменена",
      supportingText: null,
    };
  if (joinRequestStatus === "pending")
    return {
      actionLabel: null,
      message: "Заявка отправлена",
      supportingText: "Ожидайте решения организатора",
    };
  if (joinRequestStatus === "rejected")
    return {
      actionLabel: null,
      message: "Заявка не одобрена",
      supportingText: null,
    };
  if (joinRequestStatus === "approved")
    return {
      actionLabel: null,
      message: "Вы уже участник встречи",
      supportingText: "Открываем полную информацию…",
    };
  if (status !== "collecting")
    return {
      actionLabel: null,
      message:
        status === "decided" ? "Решение уже принято" : "Сбор заявок завершён",
      supportingText: null,
    };
  return {
    actionLabel: "Хочу присоединиться",
    message: "Доступна публичная информация о встрече.",
    supportingText: null,
  };
}

export async function createJoinRequestOnce<T>(
  eventId: string,
  lock: JoinRequestSubmissionLock,
  createJoinRequest: (id: string) => Promise<T>,
) {
  if (lock.current) return null;
  lock.current = true;
  try {
    return await createJoinRequest(eventId);
  } finally {
    lock.current = false;
  }
}

export type MockJoinRequestInput = {
  eventStatus: EventStatus;
  visibility: "private" | "public";
  isOwner: boolean;
  participantExists: boolean;
  requestStatus: "none" | "pending" | "rejected";
};

export function mockCreateJoinRequest(
  input: MockJoinRequestInput,
): JoinRequestActionResponse {
  if (input.visibility !== "public" || input.eventStatus !== "collecting")
    throw new ApiError(
      "Сейчас нельзя отправить заявку на эту встречу.",
      409,
      "JOIN_REQUEST_NOT_ALLOWED",
    );
  if (input.isOwner)
    throw new ApiError(
      "Организатор не может отправить заявку на свою встречу.",
      403,
      "OWNER_CANNOT_JOIN",
    );
  if (input.participantExists)
    return { joinRequestStatus: "approved" };
  if (input.requestStatus === "rejected")
    throw new ApiError(
      "Ваша заявка не была одобрена.",
      409,
      "JOIN_REQUEST_REJECTED",
    );
  return { joinRequestStatus: "pending" };
}
