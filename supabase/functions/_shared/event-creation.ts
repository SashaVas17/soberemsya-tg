const eventCreationTokens = new Set([
  "CREATE_EVENT_ACTOR_INVALID",
  "CREATE_EVENT_INPUT_INVALID",
  "CREATE_EVENT_TITLE_INVALID",
  "CREATE_EVENT_BUDGET_INVALID",
  "CREATE_EVENT_VISIBILITY_INVALID",
  "CREATE_EVENT_CAPACITY_INVALID",
  "CREATE_EVENT_TIME_OPTIONS_INVALID",
  "CREATE_EVENT_TIME_OPTIONS_LIMIT",
  "CREATE_EVENT_PLACE_OPTIONS_INVALID",
  "CREATE_EVENT_PLACE_OPTIONS_LIMIT",
]);

export function eventCreationErrorToken(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== "P0001" || typeof record.message !== "string") return null;
  return eventCreationTokens.has(record.message) ? record.message : null;
}

export function eventCreationHttpError(error: unknown) {
  switch (eventCreationErrorToken(error)) {
    case "CREATE_EVENT_TITLE_INVALID":
      return Object.assign(new Error("Укажите корректное название встречи."), { status: 400 });
    case "CREATE_EVENT_BUDGET_INVALID":
      return Object.assign(new Error("Укажите корректный бюджет."), { status: 400 });
    case "CREATE_EVENT_VISIBILITY_INVALID":
      return Object.assign(new Error("Некорректный тип встречи."), { status: 400 });
    case "CREATE_EVENT_CAPACITY_INVALID":
      return Object.assign(
        new Error("Лимит участников должен быть целым числом от 2 до 50."),
        { status: 400 },
      );
    case "CREATE_EVENT_TIME_OPTIONS_INVALID":
      return Object.assign(
        new Error("Добавьте хотя бы один вариант даты и времени."),
        { status: 400 },
      );
    case "CREATE_EVENT_TIME_OPTIONS_LIMIT":
      return Object.assign(
        new Error("Укажите не более 50 вариантов времени."),
        { status: 400 },
      );
    case "CREATE_EVENT_PLACE_OPTIONS_INVALID":
      return Object.assign(new Error("Укажите корректные варианты мест."), { status: 400 });
    case "CREATE_EVENT_PLACE_OPTIONS_LIMIT":
      return Object.assign(
        new Error("Укажите не более 50 вариантов мест."),
        { status: 400 },
      );
    default:
      return new Error("Не удалось выполнить действие.");
  }
}
