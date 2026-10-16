import type { AdminStats } from "./types";
import { t } from "./i18n";

/** "45% (9 из 20)", or "нет данных" when there is nothing to divide by. */
export function shareText(part: number, total: number) {
  if (total <= 0) return t("нет данных");
  return t("{percent}% ({part} из {total})", { percent: Math.round((part / total) * 100), part, total });
}

/** "2026-10-13" → "13.10" */
export function shortDay(day: string) {
  const [, month, date] = day.split("-");
  return month && date ? `${date}.${month}` : day;
}

/** Bar width in percent of the busiest day; 0 when every day is empty. */
export function barWidth(value: number, daily: AdminStats["daily"]) {
  const max = Math.max(0, ...daily.map((day) => day.active));
  return max > 0 ? Math.round((value / max) * 100) : 0;
}
