import { applicationError } from "./errors.ts";

const finalOptionRemovalConstraints = {
  time: "events_final_time_option_same_event_fkey",
  place: "events_final_place_option_same_event_fkey",
} as const;

function isFinalOptionRemovalViolation(error: unknown, constraint: string) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  return record.code === "23503" &&
    typeof record.message === "string" &&
    record.message.includes(`constraint "${constraint}"`);
}

export function finalOptionRemovalHttpError(
  error: unknown,
  kind: keyof typeof finalOptionRemovalConstraints,
) {
  if (isFinalOptionRemovalViolation(error, finalOptionRemovalConstraints[kind])) {
    if (kind === "time")
      return applicationError(
        "FINAL_TIME_OPTION_REMOVE_FORBIDDEN",
        409,
        "Нельзя удалить выбранный итоговый вариант времени. Сначала возобновите сбор ответов.",
      );
    return applicationError(
      "FINAL_PLACE_OPTION_REMOVE_FORBIDDEN",
      409,
      "Нельзя удалить выбранное итоговое место. Сначала возобновите сбор ответов.",
    );
  }
  return new Error("Не удалось выполнить действие.");
}
