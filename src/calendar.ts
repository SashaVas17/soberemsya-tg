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

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function icsCalendarText(details: CalendarEventDetails) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Soberemsya//Telegram Mini App//RU",
    "BEGIN:VEVENT",
    `DTSTART:${googleCalendarTimestamp(details.startsAt)}`,
    `DTEND:${googleCalendarTimestamp(details.endsAt)}`,
    `SUMMARY:${escapeIcsText(details.title)}`,
    `LOCATION:${escapeIcsText(details.location ?? "")}`,
  ];
  if (details.description) lines.push(`DESCRIPTION:${escapeIcsText(details.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function downloadCalendarIcs(details: CalendarEventDetails) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([icsCalendarText(details)], { type: "text/calendar;charset=utf-8" }),
  );
  link.download = "soberemsya.ics";
  link.click();
  URL.revokeObjectURL(link.href);
}
