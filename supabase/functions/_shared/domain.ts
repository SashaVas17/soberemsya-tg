import { applicationError } from "./errors.ts";

export type Status = "collecting" | "place_selection" | "decided" | "cancelled";

export type ParticipantResponseAction = "insert-private" | "update";

export function assertFullEventReadAccess(input: {
  visibility?: string | null;
  ownerUserId: string | null;
  currentUserId: string;
  participantExists: boolean;
}) {
  if (
    input.visibility !== "public" ||
    input.ownerUserId === input.currentUserId ||
    input.participantExists
  )
    return;

  throw applicationError(
    "PUBLIC_PREVIEW_REQUIRED",
    403,
    "Доступна только публичная информация о встрече.",
  );
}

export function authorizeParticipantResponse(input: {
  visibility?: string | null;
  ownerUserId: string | null;
  currentUserId: string;
  participantId: string | null;
}): ParticipantResponseAction {
  const visibility = input.visibility === "public" ? "public" : "private";
  if (visibility === "private")
    return input.participantId ? "update" : "insert-private";

  if (input.ownerUserId === input.currentUserId)
    throw applicationError(
      "PUBLIC_OWNER_CANNOT_RESPOND",
      403,
      "Организатор не может отвечать как участник открытой встречи.",
    );

  if (!input.participantId)
    throw applicationError(
      "PUBLIC_JOIN_REQUIRED",
      403,
      "Сначала отправьте заявку и дождитесь одобрения организатора.",
    );

  return "update";
}

export function assertVotingOpen(status: Status) {
  if (status !== "collecting") throw Object.assign(new Error("Сбор ответов уже закрыт."), { status: 409 });
}

export function assertOwner(ownerUserId: string | null, currentUserId: string) {
  if (!ownerUserId || ownerUserId !== currentUserId) throw Object.assign(new Error("У вас нет доступа к управлению этой встречей."), { status: 403 });
}

export function participantIdentityKey(eventId: string, userId: string) {
  if (!eventId || !userId) throw new Error("Event and user are required");
  return `${eventId}:${userId}`;
}

export function assertEventAvailable<T extends object>(event: T | null): asserts event is T {
  if (!event || ("deleted_at" in event && event.deleted_at))
    throw Object.assign(new Error("Встреча не найдена или удалена."), {
      code: "EVENT_UNAVAILABLE",
      status: 404,
    });
}

export function parseEventStartParam(startParam: string | null) {
  if (!startParam) return null;
  const match = startParam.match(/^event_([A-Za-z0-9_-]{3,80})$/);
  if (!match) throw Object.assign(new Error("Некорректная ссылка на встречу."), { status: 400 });
  return match[1];
}
