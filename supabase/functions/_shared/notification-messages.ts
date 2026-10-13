export type NotificationKind =
  | "response_each"
  | "response_summary"
  | "join_request_new"
  | "join_request_approved"
  | "join_request_rejected"
  | "event_decided"
  | "event_cancelled"
  | "event_updated"
  | "reminder_24h"
  | "reminder_2h";

export type NotificationMessage = {
  text: string;
  buttonText: string;
  url: string;
};

type Payload = Record<string, unknown>;

const timeZone = "Europe/Minsk";
const whenFormatter = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone,
});

function text(payload: Payload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function count(payload: Payload, key: string) {
  const value = Number(payload[key]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function formatMeetingTime(startsAt: string) {
  const value = new Date(startsAt);
  if (Number.isNaN(value.getTime())) return "";
  return whenFormatter.format(value);
}

function where(payload: Payload) {
  return [text(payload, "place"), text(payload, "area")].filter(Boolean).join(", ");
}

function finalDetails(payload: Payload) {
  return [formatMeetingTime(text(payload, "startsAt")), where(payload)].filter(Boolean).join(" · ");
}

export function eventDeepLink(bot: string, app: string, eventId: string | null) {
  const base = `https://t.me/${bot}/${app}`;
  return eventId ? `${base}?startapp=event_${eventId}` : base;
}

/**
 * Notifications that no longer make sense once their meeting is cancelled
 * or deleted. A cancellation notice itself is still delivered.
 */
export function isNotificationStale(
  kind: NotificationKind,
  eventStatus: string | null,
  eventDeleted: boolean,
) {
  if (kind === "event_cancelled") return eventDeleted;
  return eventDeleted || eventStatus === "cancelled";
}

export function renderNotification(
  kind: NotificationKind,
  payload: Payload,
  url: string,
): NotificationMessage {
  const title = `«${text(payload, "title") || "Встреча"}»`;
  const open = (message: string, buttonText = "Открыть встречу") => ({ text: message, buttonText, url });
  switch (kind) {
    case "response_each":
      return open(`Новые ответы на встречу ${title}. Всего ответили: ${count(payload, "answered")}.`);
    case "response_summary": {
      const answered = count(payload, "answered");
      const available = count(payload, "available");
      const declined = count(payload, "declined");
      return open(
        `Встреча ${title}: ответили ${answered}. Самое удобное время подходит ${available}, не подходит ${declined}.`,
      );
    }
    case "join_request_new":
      return open(
        `${text(payload, "requester") || "Пользователь Telegram"} хочет присоединиться к встрече ${title}.`,
        "Рассмотреть заявку",
      );
    case "join_request_approved":
      return open(`Организатор одобрил вашу заявку на встречу ${title}. Выберите удобное время и место.`);
    case "join_request_rejected":
      return open(`Заявку на встречу ${title} не одобрили. Посмотрите другие открытые встречи.`, "Открыть «Соберёмся»");
    case "event_decided": {
      const details = finalDetails(payload);
      return open(`Итог встречи ${title}${details ? `: ${details}` : " выбран"}.`, "Подробнее");
    }
    case "event_cancelled":
      return open(`Встреча ${title} отменена организатором.`);
    case "event_updated":
      return open(`Организатор обновил описание встречи ${title}.`);
    case "reminder_24h": {
      const details = finalDetails(payload);
      return open(`Напоминание: завтра встреча ${title}${details ? ` — ${details}` : ""}.`);
    }
    case "reminder_2h": {
      const details = finalDetails(payload);
      return open(`Через 2 часа встреча ${title}${details ? ` — ${details}` : ""}.`);
    }
  }
}

export type TelegramSendOutcome =
  | { outcome: "sent" }
  | { outcome: "retry"; retryAfterSeconds?: number; error: string }
  | { outcome: "blocked"; error: string }
  | { outcome: "failed"; error: string };

/** Maps a Telegram Bot API sendMessage result to an outbox outcome. */
export function classifyTelegramResult(
  status: number,
  body: { ok?: boolean; description?: string; parameters?: { retry_after?: number } } | null,
): TelegramSendOutcome {
  if (status === 200 && body?.ok) return { outcome: "sent" };
  const error = `${status} ${body?.description ?? ""}`.trim();
  if (status === 429)
    return { outcome: "retry", retryAfterSeconds: body?.parameters?.retry_after ?? 30, error };
  if (status === 403) return { outcome: "blocked", error };
  if (status >= 500 || status === 0) return { outcome: "retry", error };
  return { outcome: "failed", error };
}
