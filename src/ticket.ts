import { locale, plural, t } from "./i18n";

// The date block of a meeting card ("ticket"): the day large, the month and
// weekday small, and how soon it is in words. Dates are shown in the
// device's time zone, like everywhere else in the app.

export type TicketDate = {
  day: string;
  month: string;
  weekday: string;
  time: string;
  /** «Сегодня», «Завтра», «Через 3 дня»; null once the time has passed. */
  soon: string | null;
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "окт." → "окт": short month and weekday names lose the trailing dot. */
const short = (value: string) => value.replace(/\.$/, "");

// One set of formatters per locale: a list renders many cards.
const formatters = new Map<string, { month: Intl.DateTimeFormat; weekday: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>();
function formattersFor(code: string) {
  let set = formatters.get(code);
  if (!set) {
    set = {
      month: new Intl.DateTimeFormat(code, { month: "short" }),
      weekday: new Intl.DateTimeFormat(code, { weekday: "short" }),
      time: new Intl.DateTimeFormat(code, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    };
    formatters.set(code, set);
  }
  return set;
}

export function ticketDate(startsAt: string, now: Date = new Date()): TicketDate | null {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const format = formattersFor(locale());
  const soon =
    date.getTime() < now.getTime() ? null
      : days === 0 ? t("Сегодня")
        : days === 1 ? t("Завтра")
          : t("Через {days}", { days: plural(days, "день", "дня", "дней") });
  return {
    day: String(date.getDate()),
    month: short(format.month.format(date)),
    weekday: short(format.weekday.format(date)),
    time: format.time.format(date),
    soon,
  };
}
