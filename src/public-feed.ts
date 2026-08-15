import type { PublicMeetingFeedItem } from "./types";

export function mergePublicMeetings(
  current: PublicMeetingFeedItem[],
  incoming: PublicMeetingFeedItem[],
) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
