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
 * The time a meeting is expected at. A decided meeting has only its chosen
 * time (none when only a place was chosen); while answers are collected, the
 * most popular option still ahead stands in (a past one says nothing about
 * when the meeting will be). Servers before 2026-10-22 send neither finalTime
 * nor upcomingTime: then the popular option is the best guess.
 */
export function meetingTime(
  item: Pick<MeetingListItem, "status" | "bestTime" | "finalTime" | "upcomingTime">,
) {
  if (item.status === "decided" && item.finalTime !== undefined) return item.finalTime;
  return item.finalTime ?? (item.upcomingTime !== undefined ? item.upcomingTime : item.bestTime);
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
      const time = meetingTime(item);
      const startsAt = time ? Date.parse(time.startsAt) : NaN;
      return Number.isNaN(startsAt) || startsAt < nowMs ? [] : [{ item, startsAt }];
    })
    .sort((left, right) => left.startsAt - right.startsAt);
  if (upcoming.length) return upcoming[0].item;
  return [...active].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}
