import type { MeetingListItem } from "./types";

export function mergeMeetingItems(
  current: MeetingListItem[],
  incoming: MeetingListItem[],
) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * The meeting to show first on the home screen: the soonest one that has a
 * time still ahead; without such, the most recently created active meeting.
 * Cancelled meetings are never picked.
 */
export function nearestMeeting(items: MeetingListItem[], now: Date = new Date()) {
  const active = items.filter((item) => item.status !== "cancelled");
  const nowMs = now.getTime();
  const upcoming = active
    .flatMap((item) => {
      const startsAt = item.bestTime ? Date.parse(item.bestTime.startsAt) : NaN;
      return Number.isNaN(startsAt) || startsAt < nowMs ? [] : [{ item, startsAt }];
    })
    .sort((left, right) => left.startsAt - right.startsAt);
  if (upcoming.length) return upcoming[0].item;
  return [...active].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}
