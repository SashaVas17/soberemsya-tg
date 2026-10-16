import type { EventData } from "./types";

export type LeaveActionLock = { current: boolean };

export function canLeaveMeeting(
  event: Pick<EventData, "myResponse" | "canManage">,
) {
  return event.myResponse !== null && !event.canManage;
}

export async function leaveMeetingOnce<T>(
  eventId: string,
  lock: LeaveActionLock,
  leave: (eventId: string) => Promise<T>,
) {
  if (lock.current) return null;
  lock.current = true;
  try {
    return await leave(eventId);
  } finally {
    lock.current = false;
  }
}
