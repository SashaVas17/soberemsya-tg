import { bytesToHex } from "./telegram.ts";

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
  "CREATE_EVENT_IDEMPOTENCY_CONFLICT",
]);

const clientRequestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type EventCreationFingerprint = {
  title: string;
  description: string;
  budgetLimit: number;
  visibility: string;
  maxParticipants: number | null;
  startsAt: string[];
  places: { title: string; area: string; estimatedBudget: number }[];
};

export function parseClientRequestId(value: unknown) {
  if (value === undefined || value === null) return null;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!clientRequestIdPattern.test(normalized))
    throw Object.assign(new Error("Некорректный идентификатор запроса."), { status: 400 });
  return normalized;
}

export async function eventCreationRequestHash(input: EventCreationFingerprint) {
  const canonical = JSON.stringify([
    input.title,
    input.description,
    input.budgetLimit,
    input.visibility,
    input.maxParticipants,
    input.startsAt,
    input.places.map((place) => [place.title, place.area, place.estimatedBudget]),
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return bytesToHex(digest);
}

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
    case "CREATE_EVENT_IDEMPOTENCY_CONFLICT":
      return Object.assign(
        new Error("Этот запрос уже использован для другой встречи. Попробуйте создать встречу ещё раз."),
        { status: 409 },
      );
    default:
      return new Error("Не удалось выполнить действие.");
  }
}
