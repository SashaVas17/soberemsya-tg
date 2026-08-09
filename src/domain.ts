import type { EventData, TimeOption } from "./types";

export function formatSlot(startsAt: string) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(startsAt));
}

export function formatDateRange(timeOptions: { startsAt: string }[]) {
  if (!timeOptions.length) return null;
  const days = [...new Set(timeOptions.map((item) => new Date(item.startsAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })))];
  return days.length === 1 ? days[0] : `${days[0]} - ${days.at(-1)}`;
}

export function buildGoogleCalendarUrl(input: {
  title: string;
  description: string;
  location: string;
  startsAt: string;
  durationMs?: number;
}) {
  const toGoogleDate = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(input.startsAt);
  const end = new Date(start.getTime() + (input.durationMs ?? 2 * 60 * 60 * 1000));
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    details: input.description,
    location: input.location,
    dates: `${toGoogleDate(start)}/${toGoogleDate(end)}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  return `${count} ${mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many}`;
}

export function bestSlot(event: Pick<EventData, "timeOptions">): TimeOption | null {
  return event.timeOptions.slice().sort((a, b) => b.availableCount - a.availableCount || a.startsAt.localeCompare(b.startsAt))[0] ?? null;
}

export function areaLeaders(event: Pick<EventData, "participants">) {
  const counts = new Map<string, number>();
  for (const person of event.participants) if (person.area.trim()) counts.set(person.area.trim(), (counts.get(person.area.trim()) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  return [...counts.entries()].filter(([, count]) => count === max).sort((a, b) => a[0].localeCompare(b[0]));
}
