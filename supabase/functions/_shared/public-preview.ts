import type { Status } from "./domain.ts";

export type JoinRequestStatus = "none" | "pending" | "approved" | "rejected";

export type PublicEventPreview = {
  id: string;
  visibility: "public";
  title: string;
  description: string;
  status: Status;
  dateSummary: string | null;
  budgetLimit: number;
  participantCount: number;
  maxParticipants: number | null;
  joinRequestStatus: JoinRequestStatus;
};

type PreviewEvent = {
  id: string;
  title: string;
  description: string;
  status: Status;
  budgetLimit: number;
  maxParticipants: number | null;
};

const timeZone = "Europe/Minsk";
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone,
});
const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone,
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
  const key = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    day,
    key,
    label,
    month: monthParts.join(" "),
    monthKey: `${parts.year}-${parts.month}`,
  };
}

export function publicDateSummary(startsAtValues: string[]) {
  const dates = [...new Set(startsAtValues)]
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

export function publicParticipantCount(
  ownerUserId: string | null,
  participantUserIds: Array<string | null>,
) {
  if (!ownerUserId) return participantUserIds.length;
  return (
    1 +
    participantUserIds.filter(
      (participantUserId) =>
        participantUserId === null || participantUserId !== ownerUserId,
    ).length
  );
}

export function resolveJoinRequestStatus(
  participantExists: boolean,
  requestStatus: string | null | undefined,
): JoinRequestStatus {
  if (participantExists) return "approved";
  if (requestStatus === "pending" || requestStatus === "rejected")
    return requestStatus;
  return "none";
}

export function buildPublicEventPreview(input: {
  event: PreviewEvent;
  startsAtValues: string[];
  participantUserIds: Array<string | null>;
  ownerUserId: string | null;
  participantExists: boolean;
  requestStatus: string | null | undefined;
}): PublicEventPreview {
  return {
    id: input.event.id,
    visibility: "public",
    title: input.event.title,
    description: input.event.description,
    status: input.event.status,
    dateSummary: publicDateSummary(input.startsAtValues),
    budgetLimit: input.event.budgetLimit,
    participantCount: publicParticipantCount(
      input.ownerUserId,
      input.participantUserIds,
    ),
    maxParticipants: input.event.maxParticipants,
    joinRequestStatus: resolveJoinRequestStatus(
      input.participantExists,
      input.requestStatus,
    ),
  };
}
