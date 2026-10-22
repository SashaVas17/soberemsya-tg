import type { MeetingRole } from "./meetings.ts";
import { DEFAULT_TIME_ZONE } from "./cities.ts";
import { dateLocale, type Language } from "./i18n.ts";

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

let segmenter: Intl.Segmenter | null | undefined;

/** Graphemes of a text; code points where Intl.Segmenter is missing (iOS < 14.5). */
function graphemesOf(text: string): string[] {
  if (segmenter === undefined)
    segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
}

/**
 * The letter on a person's avatar circle: the first grapheme that is a letter,
 * in upper case; "" when the name has none. Same as src/initials.ts.
 */
export function nameInitial(name: string): string {
  for (const segment of graphemesOf(name.normalize("NFC"))) {
    if (/\p{L}/u.test(segment)) return segment.toUpperCase();
  }
  return "";
}

/**
 * Avatar letters of the first answered people (up to three) for the meeting
 * card, one per person, "" for a name without a letter so the circles match
 * the count. Only letters leave the server; the people are those the viewer
 * already sees on the meeting's own screen.
 */
export function participantInitials(participants: unknown[], limit = 3): string[] {
  return participants.slice(0, limit).map((person) => {
    const name = typeof person === "object" && person !== null ? (person as { name?: unknown }).name : null;
    return typeof name === "string" ? nameInitial(name) : "";
  });
}

// All active cities share Minsk time for now; per-city zones here come with
// the first city outside it (Stage 4).
const timeZone = DEFAULT_TIME_ZONE;
// en-GB keeps the Russian order "20 October", so day and month split alike.
const formatters = new Map<Language, { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>();

function formattersFor(language: Language) {
  let value = formatters.get(language);
  if (!value) {
    value = {
      date: new Intl.DateTimeFormat(dateLocale(language), { day: "numeric", month: "long", timeZone }),
      time: new Intl.DateTimeFormat(dateLocale(language), { hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZone }),
    };
    formatters.set(language, value);
  }
  return value;
}
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

function calendarDate(startsAt: string, language: Language): CalendarDate | null {
  const value = new Date(startsAt);
  if (Number.isNaN(value.getTime())) return null;
  const label = formattersFor(language).date.format(value);
  const [day = "", ...monthParts] = label.split(" ");
  return {
    key: dateKeyFormatter.format(value),
    label,
    day,
    month: monthParts.join(" "),
  };
}

function timeRangeSummary(options: TimeOption[], language: Language) {
  const dates = options
    .slice()
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
    .map((option) => calendarDate(option.startsAt, language))
    .filter((date): date is CalendarDate => date !== null)
    .filter((date, index, all) => index === 0 || date.key !== all[index - 1].key);
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return null;
  if (first.key === last.key) return first.label;
  if (first.month === last.month) return `${first.day}–${last.day} ${first.month}`;
  return `${first.label} – ${last.label}`;
}

function decidedTimeSummary(option: TimeOption | null, language: Language) {
  if (!option) return null;
  const date = calendarDate(option.startsAt, language);
  if (!date) return null;
  return `${date.label} · ${formattersFor(language).time.format(new Date(option.startsAt))}`;
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

export function meetingListItem(event: MeetingEvent, role: MeetingRole, language: Language = "ru") {
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
    initials: participantInitials(event.participants),
    bestTime,
    /** The chosen time of a decided meeting (its date on the ticket card). */
    finalTime: event.status === "decided" ? finalTime : null,
    timeSummary:
      event.status === "decided"
        ? decidedTimeSummary(finalTime, language)
        : timeRangeSummary(event.timeOptions, language),
    placeSummary:
      event.status === "decided" && finalPlace?.title.trim()
        ? finalPlace.title.trim()
        : null,
    createdAt: event.createdAt,
  };
}
