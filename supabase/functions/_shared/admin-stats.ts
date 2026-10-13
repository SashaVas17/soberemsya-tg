export type AdminStats = {
  generatedAt: string;
  usersTotal: number;
  usersNew7d: number;
  activeToday: number;
  active7d: number;
  active30d: number;
  notificationOpens7d: number;
  meetingsTotal: number;
  meetings7d: number;
  responses7d: number;
  joinRequests7d: number;
  shares7d: number;
  returningUsers7d: number;
  previousWeekUsers: number;
  meetings30d: number;
  meetingsWithResponses30d: number;
  daily: { day: string; active: number; meetings: number; responses: number }[];
};

export type ClientAnalyticsEvent = "share_sent" | "share_fallback";

const DEFAULT_ADMIN_IDS = "1979217645";
const clientEvents = new Set<ClientAnalyticsEvent>(["share_sent", "share_fallback"]);

/** Comma-separated Telegram user ids from TELEGRAM_ADMIN_IDS (owner by default). */
export function parseAdminIds(value: string | undefined) {
  return new Set(
    (value?.trim() ? value : DEFAULT_ADMIN_IDS).split(",").map((id) => id.trim()).filter((id) => /^\d+$/.test(id)),
  );
}

export function isAdminTelegramId(telegramUserId: string | number | null | undefined, adminIds: Set<string>) {
  return telegramUserId !== null && telegramUserId !== undefined && adminIds.has(String(telegramUserId));
}

/** Where an app open came from, by its startapp parameter. */
export function startParamSource(startParam: string | null) {
  if (!startParam) return "direct";
  if (startParam === "ntf" || startParam.startsWith("ntf_")) return "notification";
  if (startParam.startsWith("group_")) return "group";
  if (startParam.startsWith("event_")) return "event";
  return "other";
}

export function parseClientAnalyticsEvent(payload: Record<string, unknown>) {
  const name = payload.name;
  const eventId = payload.eventId;
  if (typeof name !== "string" || !clientEvents.has(name as ClientAnalyticsEvent))
    throw Object.assign(new Error("Некорректное событие."), { status: 400 });
  if (eventId !== undefined && (typeof eventId !== "string" || !/^[A-Za-z0-9_-]{3,80}$/.test(eventId)))
    throw Object.assign(new Error("Некорректное событие."), { status: 400 });
  return { name: name as ClientAnalyticsEvent, eventId: (eventId as string | undefined) ?? null };
}

export function percent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

/** Short plain-text summary for /stats in the bot. */
export function formatStatsText(stats: AdminStats) {
  const share = (part: number, total: number) => {
    const value = percent(part, total);
    return value === null ? "нет данных" : `${value}% (${part} из ${total})`;
  };
  return [
    "Статистика Flockly",
    "",
    `Активные: сегодня ${stats.activeToday}, за 7 дней ${stats.active7d}, за 30 дней ${stats.active30d}`,
    `Пользователи: всего ${stats.usersTotal}, новых за 7 дней ${stats.usersNew7d}`,
    `Встречи: всего ${stats.meetingsTotal}, за 7 дней ${stats.meetings7d}`,
    `За 7 дней: ответов ${stats.responses7d}, заявок ${stats.joinRequests7d}, отправок в чат ${stats.shares7d}, ` +
    `переходов из уведомлений ${stats.notificationOpens7d}`,
    `Вернулись за 7 дней: ${share(stats.returningUsers7d, stats.previousWeekUsers)}`,
    `Встречи с ответами (30 дней): ${share(stats.meetingsWithResponses30d, stats.meetings30d)}`,
  ].join("\n");
}
