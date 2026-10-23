import { DEFAULT_TIME_ZONE } from "./cities.ts";
import { dateLocale, type Language, tr } from "./i18n.ts";
import { reportReasonLabel } from "./moderation.ts";

export type NotificationKind =
  | "response_each"
  | "response_summary"
  | "join_request_new"
  | "join_request_approved"
  | "join_request_rejected"
  | "event_decided"
  | "event_cancelled"
  | "event_updated"
  | "event_reopened"
  | "reminder_24h"
  | "reminder_2h"
  | "report_new"
  | "event_repeated";

export type NotificationMessage = {
  text: string;
  buttonText: string;
  url: string;
};

type Payload = Record<string, unknown>;

// All active cities share Minsk time for now; per-city zones here come with
// the first city outside it (Stage 4).
const timeZone = DEFAULT_TIME_ZONE;
const whenFormatters = new Map<Language, Intl.DateTimeFormat>();

function whenFormatter(language: Language) {
  let formatter = whenFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(dateLocale(language), {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    });
    whenFormatters.set(language, formatter);
  }
  return formatter;
}

function text(payload: Payload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function count(payload: Payload, key: string) {
  const value = Number(payload[key]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function formatMeetingTime(startsAt: string, language: Language = "ru") {
  const value = new Date(startsAt);
  if (Number.isNaN(value.getTime())) return "";
  return whenFormatter(language).format(value);
}

/**
 * "суббота, 20 октября, 18:00 · Парк, Центр" / "Saturday 20 October, 18:00 · …"
 * — the final time and place.
 */
export function formatFinalDetails(
  startsAt: string | null | undefined,
  place?: string | null,
  area?: string | null,
  language: Language = "ru",
) {
  return [
    formatMeetingTime(startsAt ?? "", language),
    [place?.trim(), area?.trim()].filter(Boolean).join(", "),
  ].filter(Boolean).join(" · ");
}

function finalDetails(payload: Payload, language: Language) {
  return formatFinalDetails(text(payload, "startsAt"), text(payload, "place"), text(payload, "area"), language);
}

/** A link to the meeting; a person's share carries their referral code. */
export function eventDeepLink(bot: string, app: string, eventId: string | null, referralCode: string | null = null) {
  const base = `https://t.me/${bot}/${app}`;
  if (!eventId) return base;
  return `${base}?startapp=event_${eventId}${referralCode ? `__r${referralCode}` : ""}`;
}

/**
 * Opens the app on the screen for a new meeting (the button under shared
 * cards); carries the sharer's referral code like their meeting link does.
 */
export function createMeetingLink(bot: string, app: string, referralCode: string | null = null) {
  return `${eventDeepLink(bot, app, null)}?startapp=create${referralCode ? `__r${referralCode}` : ""}`;
}

/**
 * Where a notification button leads: the meeting, or the app for a
 * rejection. The ntf prefix lets analytics count opens from notifications.
 */
export function notificationLink(bot: string, app: string, kind: NotificationKind, eventId: string | null) {
  const base = `https://t.me/${bot}/${app}`;
  // A report opens the administrator's reports screen.
  if (kind === "report_new") return `${base}?startapp=reports`;
  if (kind === "join_request_rejected" || !eventId) return `${base}?startapp=ntf`;
  return `${base}?startapp=ntf_${eventId}`;
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
  // The administrator needs a report even about a cancelled meeting.
  if (kind === "report_new") return false;
  return eventDeleted || eventStatus === "cancelled";
}

/** A meeting title in the quotes of the language: «Кофе» / “Coffee”. */
export function quotedTitle(title: string, language: Language) {
  const value = title || tr(language, "Встреча", "Meeting");
  return language === "en" ? `“${value}”` : `«${value}»`;
}

export function renderNotification(
  kind: NotificationKind,
  payload: Payload,
  url: string,
  language: Language = "ru",
): NotificationMessage {
  const t = (ru: string, en: string) => tr(language, ru, en);
  const title = quotedTitle(text(payload, "title"), language);
  const open = (message: string, buttonText = t("Открыть встречу", "Open meeting")) => ({ text: message, buttonText, url });
  switch (kind) {
    case "response_each": {
      const answered = count(payload, "answered");
      return open(t(
        `Новые ответы на встречу ${title}. Всего ответили: ${answered}.`,
        `New answers to the meeting ${title}. Answered so far: ${answered}.`,
      ));
    }
    case "response_summary": {
      const answered = count(payload, "answered");
      const available = count(payload, "available");
      const declined = count(payload, "declined");
      return open(t(
        `Встреча ${title}: ответили ${answered}. Самое удобное время подходит ${available}, не подходит ${declined}.`,
        `Meeting ${title}: ${answered} answered. The best time suits ${available}, does not suit ${declined}.`,
      ));
    }
    case "join_request_new": {
      const requester = text(payload, "requester") || t("Пользователь Telegram", "A Telegram user");
      return open(
        t(`${requester} хочет присоединиться к встрече ${title}.`, `${requester} wants to join the meeting ${title}.`),
        t("Рассмотреть заявку", "Review the request"),
      );
    }
    case "join_request_approved":
      return open(t(
        `Организатор одобрил вашу заявку на встречу ${title}. Выберите удобное время и место.`,
        `The organizer approved your request to join ${title}. Choose a convenient time and place.`,
      ));
    case "join_request_rejected":
      return open(
        t(
          `Заявку на встречу ${title} не одобрили. Посмотрите другие открытые встречи.`,
          `Your request to join ${title} was not approved. Have a look at other open meetings.`,
        ),
        t("Открыть Flockly", "Open Flockly"),
      );
    case "event_decided": {
      const details = finalDetails(payload, language);
      return open(
        details
          ? t(`Итог встречи ${title}: ${details}.`, `The meeting ${title} is set: ${details}.`)
          : t(`Итог встречи ${title} выбран.`, `The meeting ${title} is set.`),
        t("Подробнее", "Details"),
      );
    }
    case "event_cancelled":
      return open(t(`Встреча ${title} отменена организатором.`, `The organizer cancelled the meeting ${title}.`));
    case "event_updated":
      return open(t(`Организатор обновил описание встречи ${title}.`, `The organizer updated the description of ${title}.`));
    case "event_reopened":
      return open(t(
        `Организатор снова собирает ответы на встречу ${title}. Прежний итог отменён.`,
        `The organizer is collecting answers to ${title} again. The previous result is cancelled.`,
      ));
    case "reminder_24h": {
      const details = finalDetails(payload, language);
      return open(t(
        `Напоминание: завтра встреча ${title}${details ? ` — ${details}` : ""}.`,
        `Reminder: the meeting ${title} is tomorrow${details ? ` — ${details}` : ""}.`,
      ));
    }
    case "reminder_2h": {
      const details = finalDetails(payload, language);
      return open(t(
        `Через 2 часа встреча ${title}${details ? ` — ${details}` : ""}.`,
        `The meeting ${title} starts in 2 hours${details ? ` — ${details}` : ""}.`,
      ));
    }
    case "event_repeated":
      // An open meeting is joined by request, a private one by link.
      return text(payload, "visibility") === "public"
        ? open(t(
          `Организатор снова собирает открытую встречу ${title}. Отправьте заявку, чтобы присоединиться.`,
          `The organizer is gathering the open meeting ${title} again. Send a request to join.`,
        ))
        : open(
          t(
            `Организатор снова собирает встречу ${title}. Отметьте удобное время и место.`,
            `The organizer is gathering ${title} again. Mark the time and place that suit you.`,
          ),
          t("Выбрать время", "Choose a time"),
        );
    case "report_new": {
      const reason = reportReasonLabel(payload.reason, language);
      const name = text(payload, "targetName") || "Telegram";
      const target = text(payload, "targetType") === "user"
        ? t(`на пользователя ${name} (встреча ${title})`, `about the user ${name} (meeting ${title})`)
        : t(`на встречу ${title}`, `about the meeting ${title}`);
      return open(
        t(`Новая жалоба ${target}. Причина: ${reason}.`, `New report ${target}. Reason: ${reason}.`),
        t("Открыть жалобы", "Open reports"),
      );
    }
  }
}

export type TelegramSendOutcome =
  | { outcome: "sent" }
  | { outcome: "retry"; retryAfterSeconds?: number; error: string }
  | { outcome: "blocked"; error: string }
  | { outcome: "failed"; error: string }
  | { outcome: "migrated"; newChatId: number; error: string };

/** Maps a Telegram Bot API sendMessage result to an outbox outcome. */
export function classifyTelegramResult(
  status: number,
  body: {
    ok?: boolean;
    description?: string;
    parameters?: { retry_after?: number; migrate_to_chat_id?: number };
  } | null,
): TelegramSendOutcome {
  if (status === 200 && body?.ok) return { outcome: "sent" };
  const error = `${status} ${body?.description ?? ""}`.trim();
  if (status === 429)
    return { outcome: "retry", retryAfterSeconds: body?.parameters?.retry_after ?? 30, error };
  if (status === 403) return { outcome: "blocked", error };
  // A group became a supergroup: the chat has a new id.
  const newChatId = body?.parameters?.migrate_to_chat_id;
  if (status === 400 && typeof newChatId === "number" && Number.isSafeInteger(newChatId))
    return { outcome: "migrated", newChatId, error };
  if (status >= 500 || status === 0) return { outcome: "retry", error };
  return { outcome: "failed", error };
}
