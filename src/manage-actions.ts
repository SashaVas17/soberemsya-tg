import type { PlaceDraft } from "./create-wizard";

export type ActionLock = { current: boolean };

export const managePayloads = {
  updateDetails: (title: string, description: string) => ({
    action: "update_details" as const,
    title,
    description,
  }),
  addTime: (startsAt: string) => ({ action: "add_time" as const, startsAt }),
  removeTime: (timeOptionId: string, force: boolean) => ({
    action: "remove_time" as const,
    timeOptionId,
    force,
  }),
  addPlace: (place: PlaceDraft) => ({ action: "add_place" as const, place }),
  removePlace: (placeOptionId: string) => ({
    action: "remove_place" as const,
    placeOptionId,
  }),
  decide: (finalTimeOptionId: string, finalPlaceId: string) => ({
    action: "decide" as const,
    finalTimeOptionId,
    finalPlaceId,
  }),
  close: () => ({ action: "close" as const }),
  reopen: () => ({ action: "reopen" as const }),
};

export async function runActionOnce<T>(
  lock: ActionLock,
  action: () => Promise<T>,
) {
  if (lock.current) return null;
  lock.current = true;
  try {
    return await action();
  } finally {
    lock.current = false;
  }
}
