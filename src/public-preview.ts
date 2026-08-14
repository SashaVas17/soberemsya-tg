import { ApiError } from "./api-error";
import type {
  EventData,
  JoinRequestStatus,
  PublicEventPreview,
} from "./types";

export type MockPublicRole =
  | "none"
  | "pending"
  | "rejected"
  | "approved"
  | "owner";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Minsk",
});
const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Minsk",
  year: "numeric",
});

type PreviewDate = {
  day: string;
  key: string;
  label: string;
  month: string;
  monthKey: string;
};

function previewDate(startsAt: string): PreviewDate | null {
  const value = new Date(startsAt);
  if (Number.isNaN(value.getTime())) return null;
  const parts = Object.fromEntries(
    datePartsFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const label = dateFormatter.format(value);
  const [day = "", ...monthParts] = label.split(" ");
  return {
    day,
    key: `${parts.year}-${parts.month}-${parts.day}`,
    label,
    month: monthParts.join(" "),
    monthKey: `${parts.year}-${parts.month}`,
  };
}

export function previewDateSummary(startsAtValues: string[]) {
  const dates = startsAtValues
    .map(previewDate)
    .filter((date): date is PreviewDate => date !== null)
    .sort((left, right) => left.key.localeCompare(right.key))
    .filter((date, index, all) => index === 0 || date.key !== all[index - 1].key);
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return null;
  if (first.key === last.key) return first.label;
  if (first.monthKey === last.monthKey)
    return `${first.day}–${last.day} ${first.month}`;
  return `${first.label} – ${last.label}`;
}

export function mockPublicEventAccess(event: EventData, role: MockPublicRole) {
  if (event.visibility === "private" || role === "owner" || role === "approved")
    return { event: structuredClone(event) };
  throw new ApiError(
    "Доступна только публичная информация о встрече.",
    403,
    "PUBLIC_PREVIEW_REQUIRED",
  );
}

export function mockPublicEventPreview(
  event: EventData,
  role: MockPublicRole,
  ownerUserId = "user_owner",
): { preview: PublicEventPreview } {
  if (event.visibility !== "public")
    throw new ApiError("Встреча не найдена или удалена.", 404);
  const participantUserIds = event.participants.map((person) => person.userId);
  const participantCount =
    1 +
    participantUserIds.filter(
      (participantUserId) =>
        participantUserId === null || participantUserId !== ownerUserId,
    ).length;
  const joinRequestStatus: JoinRequestStatus =
    role === "approved"
      ? "approved"
      : role === "pending" || role === "rejected"
        ? role
        : "none";
  return {
    preview: {
      id: event.id,
      visibility: "public",
      title: event.title,
      description: event.description,
      status: event.status,
      dateSummary: previewDateSummary(
        event.timeOptions.map((option) => option.startsAt),
      ),
      budgetLimit: event.budgetLimit,
      participantCount,
      maxParticipants: event.maxParticipants,
      joinRequestStatus,
    },
  };
}
