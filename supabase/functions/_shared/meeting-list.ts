import type { MeetingRole } from "./meetings.ts";

type TimeOption = {
  id: string;
  startsAt: string;
  availableCount: number;
};

type PlaceOption = { id: string; title: string };

type MeetingEvent = {
  id: string;
  title: string;
  status: string;
  finalPlaceId: string | null;
  finalTimeOptionId: string | null;
  timeOptions: TimeOption[];
  placeOptions: PlaceOption[];
  participants: unknown[];
  createdAt: string;
};

const timeZone = "Europe/Minsk";
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone,
});
const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone,
});
const dateKeyFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone,
  year: "numeric",
});

type CalendarDate = {
  key: string;
  label: string;
  day: string;
  month: string;
};

function calendarDate(startsAt: string): CalendarDate | null {
  const value = new Date(startsAt);
  if (Number.isNaN(value.getTime())) return null;
  const label = dateFormatter.format(value);
  const [day = "", ...monthParts] = label.split(" ");
  return {
    key: dateKeyFormatter.format(value),
    label,
    day,
    month: monthParts.join(" "),
  };
}

function timeRangeSummary(options: TimeOption[]) {
  const dates = options
    .slice()
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
    .map((option) => calendarDate(option.startsAt))
    .filter((date): date is CalendarDate => date !== null)
    .filter((date, index, all) => index === 0 || date.key !== all[index - 1].key);
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return null;
  if (first.key === last.key) return first.label;
  if (first.month === last.month) return `${first.day}–${last.day} ${first.month}`;
  return `${first.label} – ${last.label}`;
}

function decidedTimeSummary(option: TimeOption | null) {
  if (!option) return null;
  const date = calendarDate(option.startsAt);
  if (!date) return null;
  return `${date.label} · ${timeFormatter.format(new Date(option.startsAt))}`;
}

function bestTimeOption(options: TimeOption[]) {
  return options
    .slice()
    .sort(
      (left, right) =>
        right.availableCount - left.availableCount ||
        left.startsAt.localeCompare(right.startsAt),
    )[0] ?? null;
}

export function meetingListItem(event: MeetingEvent, role: MeetingRole) {
  const bestTime = bestTimeOption(event.timeOptions);
  const finalTime =
    event.timeOptions.find((option) => option.id === event.finalTimeOptionId) ??
    null;
  const finalPlace =
    event.placeOptions.find((option) => option.id === event.finalPlaceId) ?? null;

  return {
    id: event.id,
    title: event.title,
    status: event.status,
    role,
    participantCount: event.participants.length,
    responseCount: event.participants.length,
    bestTime,
    timeSummary:
      event.status === "decided"
        ? decidedTimeSummary(finalTime)
        : timeRangeSummary(event.timeOptions),
    placeSummary:
      event.status === "decided" && finalPlace?.title.trim()
        ? finalPlace.title.trim()
        : null,
    createdAt: event.createdAt,
  };
}
