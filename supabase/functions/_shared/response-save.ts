import { applicationError } from "./errors.ts";

const responseSaveTokens = new Set([
  "EVENT_UNAVAILABLE",
  "RESPONSE_CLOSED",
  "PUBLIC_JOIN_REQUIRED",
  "PUBLIC_OWNER_CANNOT_RESPOND",
  "TIME_OPTION_UNAVAILABLE",
  "RESPONSE_INVALID_BUDGET",
  "RESPONSE_ACTOR_UNAVAILABLE",
]);

export function responseSaveErrorToken(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== "P0001" || typeof record.message !== "string") return null;
  return responseSaveTokens.has(record.message) ? record.message : null;
}

export function responseSaveHttpError(error: unknown) {
  switch (responseSaveErrorToken(error)) {
    case "EVENT_UNAVAILABLE":
      return Object.assign(new Error("Встреча не найдена или удалена."), {
        status: 404,
      });
    case "RESPONSE_CLOSED":
      return Object.assign(new Error("Сбор ответов уже закрыт."), { status: 409 });
    case "PUBLIC_JOIN_REQUIRED":
      return applicationError(
        "PUBLIC_JOIN_REQUIRED",
        403,
        "Сначала отправьте заявку и дождитесь одобрения организатора.",
      );
    case "PUBLIC_OWNER_CANNOT_RESPOND":
      return applicationError(
        "PUBLIC_OWNER_CANNOT_RESPOND",
        403,
        "Организатор не может отвечать как участник открытой встречи.",
      );
    case "TIME_OPTION_UNAVAILABLE":
      return Object.assign(
        new Error("Один из вариантов времени больше недоступен."),
        { status: 400 },
      );
    case "RESPONSE_INVALID_BUDGET":
      return Object.assign(new Error("Укажите корректный бюджет."), { status: 400 });
    default:
      return new Error("Не удалось выполнить действие.");
  }
}
