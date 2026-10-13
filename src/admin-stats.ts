import type { AdminStats } from "./types";

/** "45% (9 из 20)", or "нет данных" when there is nothing to divide by. */
export function shareText(part: number, total: number) {
  if (total <= 0) return "нет данных";
  return `${Math.round((part / total) * 100)}% (${part} из ${total})`;
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
