const GOOGLE_CALENDAR_URL = "https://calendar.google.com/calendar/render";

export type CalendarEventDetails = {
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  description?: string;
};

export function googleCalendarTimestamp(value: Date | string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(details: CalendarEventDetails) {
  const url = new URL(GOOGLE_CALENDAR_URL);
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", details.title);
  url.searchParams.set(
    "dates",
    `${googleCalendarTimestamp(details.startsAt)}/${googleCalendarTimestamp(details.endsAt)}`,
  );
  if (details.location) url.searchParams.set("location", details.location);
  if (details.description) url.searchParams.set("details", details.description);
  return url.toString();
}
