import { locale, plural, t } from "./i18n";

// The date block of a meeting card ("ticket"): the day large, the month and
// weekday small, and how soon it is in words. Dates are shown in the
// device's time zone, like everywhere else in the app.

export type TicketDate = {
  day: string;
  month: string;
  weekday: string;
  time: string;
  /** «Сегодня», «Завтра», «Через 3 дня»; null for a past date. */
  soon: string | null;
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "окт." → "окт": short month and weekday names lose the trailing dot. */
const short = (value: string) => value.replace(/\.$/, "");

export function ticketDate(startsAt: string, now: Date = new Date()): TicketDate | null {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const soon =
    days < 0 ? null
      : days === 0 ? t("Сегодня")
        : days === 1 ? t("Завтра")
          : t("Через {days}", { days: plural(days, "день", "дня", "дней") });
  return {
    day: String(date.getDate()),
    month: short(new Intl.DateTimeFormat(locale(), { month: "short" }).format(date)),
    weekday: short(new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(date)),
    time: new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date),
    soon,
  };
}
