const optionAdditionTokens = new Set([
  "EVENT_UNAVAILABLE",
  "NOT_EVENT_OWNER",
  "TIME_OPTION_LIMIT_REACHED",
  "PLACE_OPTION_LIMIT_REACHED",
]);

export function optionAdditionErrorToken(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== "P0001" || typeof record.message !== "string") return null;
  return optionAdditionTokens.has(record.message) ? record.message : null;
}

export function optionAdditionHttpError(error: unknown) {
  switch (optionAdditionErrorToken(error)) {
    case "EVENT_UNAVAILABLE":
      return Object.assign(new Error("Встреча не найдена."), { status: 404 });
    case "NOT_EVENT_OWNER":
      return Object.assign(
        new Error("У вас нет доступа к управлению этой встречей."),
        { status: 403 },
      );
    case "TIME_OPTION_LIMIT_REACHED":
      return Object.assign(
        new Error("Нельзя добавить больше 50 вариантов времени."),
        { status: 409 },
      );
    case "PLACE_OPTION_LIMIT_REACHED":
      return Object.assign(
        new Error("Нельзя добавить больше 50 вариантов мест."),
        { status: 409 },
      );
    default:
      return new Error("Не удалось выполнить действие.");
  }
}
