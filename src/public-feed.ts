import type { PublicMeetingFeedItem } from "./types";

export function mergePublicMeetings(
  current: PublicMeetingFeedItem[],
  incoming: PublicMeetingFeedItem[],
) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

/** Same limit as the server (FEED_SEARCH_MAX_LENGTH). */
export const FEED_SEARCH_MAX_LENGTH = 80;

export type PublicFeedFilters = {
  category?: string | null;
  q?: string | null;
};

/** Search text as the server reads it: "*" and runs of spaces become one space, ends trimmed. */
export function normalizeFeedSearch(value: string) {
  return value.replace(/[\s*]+/g, " ").trim();
}

export function hasPublicFeedFilters(filters: PublicFeedFilters) {
  return Boolean(filters.category || (filters.q && normalizeFeedSearch(filters.q)));
}

export function publicFeedPath(cursor?: string, filters: PublicFeedFilters = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (filters.category) params.set("category", filters.category);
  const q = filters.q ? normalizeFeedSearch(filters.q) : "";
  if (q) params.set("q", q);
  const query = params.toString();
  return `/public/events${query ? `?${query}` : ""}`;
}
