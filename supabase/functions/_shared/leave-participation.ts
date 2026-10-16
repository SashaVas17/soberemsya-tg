import { applicationError } from "./errors.ts";

const leaveParticipationTokens = new Set([
  "EVENT_UNAVAILABLE",
  "OWNER_CANNOT_LEAVE",
  "PARTICIPATION_UNAVAILABLE",
  "PARTICIPATION_ACTOR_UNAVAILABLE",
]);

export function leaveParticipationErrorToken(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== "P0001" || typeof record.message !== "string") return null;
  return leaveParticipationTokens.has(record.message) ? record.message : null;
}

export function leaveParticipationHttpError(error: unknown) {
  switch (leaveParticipationErrorToken(error)) {
    case "EVENT_UNAVAILABLE":
      return Object.assign(new Error("Встреча не найдена или удалена."), {
        status: 404,
      });
    case "OWNER_CANNOT_LEAVE":
      return applicationError(
        "OWNER_CANNOT_LEAVE",
        403,
        "Организатор не может покинуть свою встречу.",
      );
    case "PARTICIPATION_UNAVAILABLE":
      return Object.assign(new Error("Вы не участвуете в этой встрече."), {
        status: 404,
      });
    default:
      return new Error("Не удалось выполнить действие.");
  }
}
