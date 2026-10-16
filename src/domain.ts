import { locale } from "./i18n";
import type { EventData, TimeOption } from "./types";

export function formatSlot(startsAt: string) {
  return new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(startsAt));
}

export { plural } from "./i18n";

export function bestSlot(event: Pick<EventData, "timeOptions">): TimeOption | null {
  return event.timeOptions.slice().sort((a, b) => b.availableCount - a.availableCount || a.startsAt.localeCompare(b.startsAt))[0] ?? null;
}

export function areaLeaders(event: Pick<EventData, "participants">) {
  const counts = new Map<string, number>();
  for (const person of event.participants) {
    const area = person.area?.trim();
    if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const max = Math.max(0, ...counts.values());
  return [...counts.entries()].filter(([, count]) => count === max).sort((a, b) => a[0].localeCompare(b[0]));
}
