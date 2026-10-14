import type { EditablePlaceDraft } from "./app-types";
import { normalizeFeedSearch } from "./public-feed";
import type { Venue, VenuePriceLevel, VenueStatus } from "./types";

// Same levels as the server (PRICE_LEVELS in _shared/venues.ts). estimate is
// the per-person budget a chosen venue puts into the meeting's place option.
export const PRICE_LEVELS: { level: VenuePriceLevel; label: string; from: number; estimate: number }[] = [
  { level: 1, label: "до 20 BYN", from: 0, estimate: 15 },
  { level: 2, label: "20–50 BYN", from: 20, estimate: 35 },
  { level: 3, label: "от 50 BYN", from: 50, estimate: 60 },
];

/** The highest price level a meeting budget fits (same rule as the server). */
export function maxPriceLevelForBudget(budget: number): VenuePriceLevel {
  return PRICE_LEVELS.filter((price) => price.from <= budget).at(-1)?.level ?? 1;
}

export function priceLabel(level: VenuePriceLevel | null) {
  return PRICE_LEVELS.find((price) => price.level === level)?.label ?? null;
}

export const OSM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright";

/** ODbL asks for the attribution wherever imported data is shown. */
export function needsOsmAttribution(venues: Pick<Venue, "source">[]) {
  return venues.some((venue) => venue.source === "osm");
}

export type VenueFilters = {
  category?: string | null;
  q?: string | null;
  /** Meeting budget in BYN; 0 or missing means no budget filter. */
  budget?: number | null;
};

function venueParams(filters: VenueFilters, offset: number) {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  const q = filters.q ? normalizeFeedSearch(filters.q) : "";
  if (q) params.set("q", q);
  if (filters.budget && filters.budget > 0) params.set("budget", String(Math.floor(filters.budget)));
  if (offset > 0) params.set("offset", String(offset));
  return params;
}

export function venuesPath(filters: VenueFilters = {}, offset = 0) {
  const query = venueParams(filters, offset).toString();
  return `/venues${query ? `?${query}` : ""}`;
}

export function adminVenuesPath(status: VenueStatus, filters: VenueFilters = {}, offset = 0) {
  const params = venueParams(filters, offset);
  params.set("status", status);
  return `/admin/venues?${params.toString()}`;
}

export function mergeVenues<T extends { id: string }>(current: T[], incoming: T[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * A place option for the creation wizard. The place budget is the level's
 * typical price, but never above the meeting budget the venue was picked
 * for; without a price level the meeting budget is used.
 */
export function venuePlaceDraft(venue: Venue, meetingBudget: string): EditablePlaceDraft {
  const price = PRICE_LEVELS.find((level) => level.level === venue.priceLevel);
  const budget = Number(meetingBudget);
  const estimate = price && budget > 0 ? Math.min(price.estimate, Math.max(price.from, budget)) : price?.estimate;
  return {
    title: venue.name,
    area: venue.address,
    estimatedBudget: estimate === undefined ? meetingBudget : String(estimate),
  };
}

const sameText = (left: string, right: string) =>
  left.trim().toLocaleLowerCase("ru") === right.trim().toLocaleLowerCase("ru");

/** Branches of a chain share a name, so the address tells them apart. */
export function isVenueAdded(venue: Venue, places: Pick<EditablePlaceDraft, "title" | "area">[]) {
  return places.some((place) => sameText(place.title, venue.name) && sameText(place.area, venue.address));
}

// «Создать встречу» on a venue card opens the wizard with that venue. The
// wizard reads the venue while it sets up and then clears it, so a later
// visit to the wizard starts empty.
let venueForNewMeeting: Venue | null = null;

export function startMeetingAtVenue(venue: Venue) {
  venueForNewMeeting = venue;
}

export function venueForNextMeeting() {
  return venueForNewMeeting;
}

export function clearVenueForNextMeeting() {
  venueForNewMeeting = null;
}
