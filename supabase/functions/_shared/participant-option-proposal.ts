const proposalTokens = new Set([
  "EVENT_UNAVAILABLE",
  "OPTION_PROPOSAL_ACTOR_UNAVAILABLE",
  "OPTION_PROPOSAL_NOT_ALLOWED",
  "OPTION_PROPOSAL_CLOSED",
  "TIME_OPTION_LIMIT_REACHED",
  "PLACE_OPTION_LIMIT_REACHED",
  "TIME_OPTION_INVALID",
  "PLACE_OPTION_INVALID",
]);

export function participantOptionProposalErrorToken(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code !== "P0001" || typeof record.message !== "string") return null;
  return proposalTokens.has(record.message) ? record.message : null;
}

export function participantOptionProposalHttpError(error: unknown) {
  switch (participantOptionProposalErrorToken(error)) {
    case "EVENT_UNAVAILABLE":
      return Object.assign(new Error("Встреча не найдена или удалена."), { status: 404 });
    case "OPTION_PROPOSAL_NOT_ALLOWED":
      return Object.assign(
        new Error("Предлагать варианты могут только участники встречи."),
        { status: 403 },
      );
    case "OPTION_PROPOSAL_CLOSED":
      return Object.assign(
        new Error("Нельзя предлагать варианты после завершения сбора ответов."),
        { status: 409 },
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
    case "TIME_OPTION_INVALID":
      return Object.assign(new Error("Некорректная дата."), { status: 400 });
    case "PLACE_OPTION_INVALID":
      return Object.assign(new Error("Укажите корректное место."), { status: 400 });
    default:
      return new Error("Не удалось выполнить действие.");
  }
}
