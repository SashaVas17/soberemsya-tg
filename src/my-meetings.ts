import type { MeetingListItem } from "./types";

export function mergeMeetingItems(
  current: MeetingListItem[],
  incoming: MeetingListItem[],
) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
