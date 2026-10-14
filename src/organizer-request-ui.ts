import { ApiError, hasApiErrorCode } from "./api-error";
import type { OrganizerJoinRequest } from "./types";
import { locale, t } from "./i18n";

export type OrganizerRequestActionLock = {
  current: Set<string>;
};

export function formatJoinRequestCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("Дата не указана");
  return new Intl.DateTimeFormat(locale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatJoinRequestUsername(username: string | null) {
  if (!username) return null;
  return `@${username.replace(/^@+/, "")}`;
}

export function removePendingJoinRequest(
  requests: OrganizerJoinRequest[],
  requestId: string,
) {
  return requests.filter((request) => request.requestId !== requestId);
}

export function shouldReloadJoinRequests(error: unknown) {
  return (
    hasApiErrorCode(error, "JOIN_REQUEST_NOT_PENDING") ||
    (error instanceof ApiError && error.status === 404)
  );
}

export function joinRequestActionErrorMessage(error: unknown) {
  if (hasApiErrorCode(error, "EVENT_FULL"))
    return t("На встрече уже нет свободных мест");
  if (hasApiErrorCode(error, "JOIN_REQUESTS_CLOSED"))
    return t("Сбор ответов уже завершён");
  if (hasApiErrorCode(error, "NOT_EVENT_OWNER"))
    return t("У вас больше нет доступа к управлению встречей.");
  if (hasApiErrorCode(error, "JOIN_REQUEST_NOT_ALLOWED"))
    return t("Заявки для этой встречи недоступны.");
  if (hasApiErrorCode(error, "OWNER_CANNOT_JOIN"))
    return t("Организатора нельзя добавить как участника.");
  return t("Не удалось выполнить действие. Попробуйте ещё раз.");
}

export async function runOrganizerRequestActionOnce<T>(
  lock: OrganizerRequestActionLock,
  requestId: string,
  action: () => Promise<T>,
) {
  if (lock.current.has(requestId)) return null;
  lock.current.add(requestId);
  try {
    return await action();
  } finally {
    lock.current.delete(requestId);
  }
}
