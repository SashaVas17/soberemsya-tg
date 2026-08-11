export type Status = "collecting" | "place_selection" | "decided" | "cancelled";

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

export function assertEventAvailable<T extends { deleted_at?: string | null }>(event: T | null): asserts event is T {
  if (!event || event.deleted_at)
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
