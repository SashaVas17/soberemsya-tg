import { applicationError } from "./errors.ts";

const removeEventParticipantTokens = new Set([
  "EVENT_UNAVAILABLE",
  "NOT_EVENT_OWNER",
  "PARTICIPANT_UNAVAILABLE",
  "OWNER_PARTICIPANT_CANNOT_REMOVE",
  "PARTICIPANT_REMOVAL_ACTOR_UNAVAILABLE",
]);

export function removeEventParticipantErrorToken(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== "P0001" || typeof record.message !== "string") return null;
  return removeEventParticipantTokens.has(record.message) ? record.message : null;
}

export function removeEventParticipantHttpError(error: unknown) {
  switch (removeEventParticipantErrorToken(error)) {
    case "EVENT_UNAVAILABLE":
      return Object.assign(new Error("Встреча не найдена или удалена."), {
        status: 404,
      });
    case "NOT_EVENT_OWNER":
      return applicationError(
        "NOT_EVENT_OWNER",
        403,
        "У вас нет доступа к управлению этой встречей.",
      );
    case "PARTICIPANT_UNAVAILABLE":
      return Object.assign(new Error("Участник не найден."), { status: 404 });
    case "OWNER_PARTICIPANT_CANNOT_REMOVE":
      return applicationError(
        "OWNER_PARTICIPANT_CANNOT_REMOVE",
        403,
        "Организатора нельзя исключить из собственной встречи.",
      );
    default:
      return new Error("Не удалось выполнить действие.");
  }
}
