// Venue catalogue (Stage 2.3): listing, curation input and the OpenStreetMap
// import. OSM data is © OpenStreetMap contributors, ODbL; the app shows the
// attribution wherever imported venues appear.
import { readBoundedBytes } from "./bounded-json.ts";
import { parseCategoryId, parseFeedSearch } from "./categories.ts";

export const VENUE_PAGE_SIZE = 30;
const VENUE_MAX_OFFSET = 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VenueStatus = "pending" | "published" | "hidden";
export type VenueSource = "osm" | "manual";

export type VenueRow = {
  id: string;
  category_id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  price_level: number | null;
  website: string | null;
  opening_hours: string | null;
  source: VenueSource;
  osm_type: string | null;
  osm_id: number | null;
  status: VenueStatus;
  featured: boolean;
};

export const VENUE_COLUMNS =
  "id,category_id,name,address,latitude,longitude,price_level,website,opening_hours,source,osm_type,osm_id,status,featured";

/**
 * Price levels per person. A meeting budget B fits the levels that start at
 * or below B; a venue without a level (a park, an unrated cafe) always fits.
 */
export const PRICE_LEVELS = [
  { level: 1, from: 0 },
  { level: 2, from: 20 },
  { level: 3, from: 50 },
] as const;

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

export function maxPriceLevelForBudget(budget: number) {
  return PRICE_LEVELS.filter((price) => price.from <= budget).at(-1)?.level ?? 1;
}

export function parseVenueBudget(value: string | null): number | null {
  if (value === null || value === "") return null;
  if (!/^(0|[1-9][0-9]{0,6})$/.test(value)) badRequest("Некорректный бюджет.");
  return Number(value);
}

export function parseVenueOffset(value: string | null) {
  if (value === null || value === "") return 0;
  if (!/^(0|[1-9][0-9]{0,3})$/.test(value) || Number(value) > VENUE_MAX_OFFSET)
    badRequest("Некорректная страница.");
  return Number(value);
}

export type VenueListFilters = {
  categoryId: string | null;
  search: string | null;
  maxPriceLevel: number | null;
  offset: number;
};

export function parseVenueListFilters(params: URLSearchParams): VenueListFilters {
  const budget = parseVenueBudget(params.get("budget"));
  return {
    categoryId: parseCategoryId(params.get("category")),
    search: parseFeedSearch(params.get("q")),
    maxPriceLevel: budget === null ? null : maxPriceLevelForBudget(budget),
    offset: parseVenueOffset(params.get("offset")),
  };
}

export function parseVenueStatus(value: unknown): VenueStatus {
  if (value === "pending" || value === "published" || value === "hidden") return value;
  badRequest("Некорректный статус места.");
}

/** An optional venue id of a place option; anything but a uuid is dropped. */
export function optionalVenueId(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value.toLowerCase() : null;
}

export function parseVenueId(value: string) {
  if (!uuidPattern.test(value)) throw Object.assign(new Error("Место не найдено."), { status: 404 });
  return value.toLowerCase();
}

function parsePriceLevel(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value === 1 || value === 2 || value === 3) return value;
  badRequest("Некорректный уровень цен.");
}

function requiredCategory(value: unknown) {
  return parseCategoryId(value) ?? badRequest("Выберите категорию.");
}

/** One line of plain text: control characters dropped, spaces collapsed. */
export function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  // deno-lint-ignore no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  return [...text].slice(0, maxLength).join("").trim();
}

/** An http(s) link of at most 300 characters, or null. */
export function cleanWebsite(value: unknown): string | null {
  // OSM allows several links separated by ";"; the first one is kept.
  const text = cleanText(value, 1000).split(";")[0].trim();
  if (!text || text.length > 300 || /\s/.test(text)) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(text) ? `https://${text}` : null;
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const href = url.href;
    return href.length <= 300 ? href : null;
  } catch {
    return null;
  }
}

export type VenueUpdate = {
  status: VenueStatus;
  categoryId: string;
  priceLevel: number | null;
  featured: boolean;
};

export function parseVenueUpdate(body: Record<string, unknown>): VenueUpdate {
  if (typeof body.featured !== "boolean") badRequest("Некорректные данные места.");
  return {
    status: parseVenueStatus(body.status),
    categoryId: requiredCategory(body.categoryId),
    priceLevel: parsePriceLevel(body.priceLevel),
    featured: body.featured,
  };
}

export type VenueCreate = {
  categoryId: string;
  name: string;
  address: string;
  priceLevel: number | null;
  website: string | null;
};

export function parseVenueCreate(body: Record<string, unknown>): VenueCreate {
  const name = cleanText(body.name, 121);
  if (!name) badRequest("Укажите название места.");
  if ([...name].length > 120) badRequest("Название места длиннее 120 символов.");
  const address = cleanText(body.address, 201);
  if ([...address].length > 200) badRequest("Адрес длиннее 200 символов.");
  const rawWebsite = cleanText(body.website, 1000);
  const website = rawWebsite ? cleanWebsite(rawWebsite) : null;
  if (rawWebsite && !website) badRequest("Ссылка должна быть адресом сайта.");
  return {
    categoryId: requiredCategory(body.categoryId),
    name,
    address,
    priceLevel: parsePriceLevel(body.priceLevel),
    website,
  };
}

export function parseVenueIds(body: Record<string, unknown>): string[] {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) badRequest("Выберите места.");
  return [...new Set(ids.map((value) => {
    if (typeof value !== "string" || !uuidPattern.test(value)) badRequest("Выберите места.");
    return value.toLowerCase();
  }))];
}

export function osmUrl(row: Pick<VenueRow, "osm_type" | "osm_id">) {
  return row.osm_type && row.osm_id ? `https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}` : null;
}

export function venueResponse(row: VenueRow) {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    priceLevel: row.price_level,
    website: row.website,
    openingHours: row.opening_hours,
    source: row.source,
    osmUrl: osmUrl(row),
    featured: row.featured,
  };
}

export function adminVenueResponse(row: VenueRow) {
  return { ...venueResponse(row), status: row.status };
}

/** Next offset when the page was full, otherwise null. */
export function nextVenueOffset(offset: number, rowsReturned: number, pageSize = VENUE_PAGE_SIZE) {
  const next = offset + pageSize;
  return rowsReturned > pageSize && next <= VENUE_MAX_OFFSET ? next : null;
}

function errorToken(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; message?: unknown };
  return record.code === "P0001" && typeof record.message === "string" ? record.message : null;
}

export function venueHttpError(error: unknown) {
  switch (errorToken(error)) {
    case "VENUE_NOT_FOUND":
      return Object.assign(new Error("Место не найдено."), { status: 404 });
    case "VENUE_CATEGORY_INVALID":
      return Object.assign(new Error("Эта категория недоступна."), { status: 400 });
    case "VENUE_CITY_INVALID":
      return Object.assign(new Error("Этот город пока недоступен."), { status: 400 });
    case "VENUE_IMPORT_INVALID":
      return Object.assign(new Error("Проверьте данные и попробуйте ещё раз."), { status: 400 });
    default:
      return new Error("Не удалось выполнить действие.");
  }
}

// OpenStreetMap import ------------------------------------------------------

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** Tried in order when the main server refuses or does not answer (it answered 406 to the Edge Function). */
export const OVERPASS_URLS = [
  OVERPASS_URL,
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;
export const OVERPASS_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const OVERPASS_MAX_ELEMENTS = 5000;

/** south, west, north, east: the city with its ring road and a margin. */
export const OSM_CITY_BBOX: Record<string, readonly [number, number, number, number]> = {
  minsk: [53.8, 27.37, 53.99, 27.76],
};

/**
 * Overpass filters per meeting category. Only named objects are imported;
 * "other" has no OSM counterpart. Kept narrow on purpose: everything still
 * goes through manual curation.
 */
export const OSM_CATEGORY_FILTERS: Record<string, readonly string[]> = {
  coffee: ['["amenity"="cafe"]'],
  food: ['["amenity"="restaurant"]'],
  bar: ['["amenity"~"^(bar|pub|biergarten|nightclub)$"]'],
  sport: ['["leisure"~"^(sports_centre|bowling_alley|ice_rink)$"]'],
  boardgames: ['["shop"="games"]'],
  walk: ['["leisure"="park"]'],
  cinema: ['["amenity"="cinema"]'],
  concert: ['["amenity"~"^(theatre|concert_hall|music_venue|arts_centre)$"]'],
  outdoor: [
    '["leisure"~"^(water_park|trampoline_park|escape_game)$"]',
    '["sport"~"^(karting|paintball|climbing|laser_tag)$"]',
    '["tourism"="theme_park"]',
  ],
};

/** Initial map view of a city: its import box, or Minsk for a city without one. */
export function cityMapBounds(cityId: string) {
  const [south, west, north, east] = OSM_CITY_BBOX[cityId] ?? OSM_CITY_BBOX.minsk;
  return { south, west, north, east };
}

export type MapVenuePoint = [id: string, latitude: number, longitude: number, categoryId: string, featured: boolean];

export type MapMeeting = {
  id: string;
  title: string;
  categoryId: string | null;
  latitude: number;
  longitude: number;
  venueName: string;
  startsAt: string | null;
};

/** The public_map_points answer, with anything malformed left out. */
export function mapPointsFromRpc(value: unknown): { venues: MapVenuePoint[]; meetings: MapMeeting[] } {
  const record = value && typeof value === "object" ? value as { venues?: unknown; meetings?: unknown } : {};
  const venues = (Array.isArray(record.venues) ? record.venues : []).filter((point): point is MapVenuePoint =>
    Array.isArray(point) && point.length === 5 && typeof point[0] === "string" &&
    typeof point[1] === "number" && typeof point[2] === "number" &&
    typeof point[3] === "string" && typeof point[4] === "boolean");
  const meetings = (Array.isArray(record.meetings) ? record.meetings : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const meeting = item as Record<string, unknown>;
    if (typeof meeting.id !== "string" || typeof meeting.title !== "string" ||
      typeof meeting.latitude !== "number" || typeof meeting.longitude !== "number") return [];
    return [{
      id: meeting.id,
      title: meeting.title,
      categoryId: typeof meeting.categoryId === "string" ? meeting.categoryId : null,
      latitude: meeting.latitude,
      longitude: meeting.longitude,
      venueName: typeof meeting.venueName === "string" ? meeting.venueName : "",
      startsAt: typeof meeting.startsAt === "string" ? meeting.startsAt : null,
    }];
  });
  return { venues, meetings };
}

export function osmImportCategories() {
  return Object.keys(OSM_CATEGORY_FILTERS);
}

export function parseOsmImportRequest(body: Record<string, unknown>, cityId: string) {
  const categoryId = requiredCategory(body.categoryId);
  if (!OSM_CATEGORY_FILTERS[categoryId]) badRequest("Для этой категории импорт из OpenStreetMap не настроен.");
  if (!OSM_CITY_BBOX[cityId]) badRequest("Для этого города импорт из OpenStreetMap не настроен.");
  return { categoryId };
}

export function overpassQuery(cityId: string, categoryId: string) {
  const bbox = OSM_CITY_BBOX[cityId];
  const filters = OSM_CATEGORY_FILTERS[categoryId];
  if (!bbox || !filters) throw new Error("OSM import is not configured.");
  const box = bbox.join(",");
  const selectors = filters.map((filter) => `nwr${filter}["name"](${box});`).join("");
  return `[out:json][timeout:90];(${selectors});out center tags ${OVERPASS_MAX_ELEMENTS};`;
}

export type OsmImportItem = {
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  category_id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  opening_hours: string | null;
};

type OverpassElement = {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown };
  tags?: Record<string, unknown>;
};

function coordinate(value: unknown, limit: number) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

function osmAddress(tags: Record<string, unknown>) {
  const street = cleanText(tags["addr:street"], 120) || cleanText(tags["addr:place"], 120);
  const house = cleanText(tags["addr:housenumber"], 20);
  return cleanText([street, street ? house : ""].filter(Boolean).join(", "), 200);
}

/** Overpass stops at the output limit silently: an answer that reached it may miss venues. */
export function overpassTruncated(answer: unknown) {
  const elements = (answer as { elements?: unknown } | null)?.elements;
  return Array.isArray(elements) && elements.length >= OVERPASS_MAX_ELEMENTS;
}

/** Import rows from an Overpass JSON answer; unusable elements are skipped. */
export function venuesFromOverpass(answer: unknown, categoryId: string): OsmImportItem[] {
  const elements = answer && typeof answer === "object" && Array.isArray((answer as { elements?: unknown }).elements)
    ? (answer as { elements: OverpassElement[] }).elements
    : [];
  const seen = new Set<string>();
  const items: OsmImportItem[] = [];
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const type = element.type;
    if (type !== "node" && type !== "way" && type !== "relation") continue;
    if (typeof element.id !== "number" || !Number.isSafeInteger(element.id) || element.id <= 0) continue;
    const key = `${type}/${element.id}`;
    if (seen.has(key)) continue;
    const tags = element.tags && typeof element.tags === "object" ? element.tags : {};
    const name = cleanText(tags["name:ru"], 120) || cleanText(tags.name, 120);
    if (!name) continue;
    const latitude = coordinate(type === "node" ? element.lat : element.center?.lat, 90);
    const longitude = coordinate(type === "node" ? element.lon : element.center?.lon, 180);
    const hasPoint = latitude !== null && longitude !== null;
    seen.add(key);
    items.push({
      osm_type: type,
      osm_id: element.id,
      category_id: categoryId,
      name,
      address: osmAddress(tags),
      latitude: hasPoint ? latitude : null,
      longitude: hasPoint ? longitude : null,
      website: cleanWebsite(tags.website) ?? cleanWebsite(tags["contact:website"]),
      opening_hours: cleanText(tags.opening_hours, 200) || null,
    });
  }
  return items;
}

/**
 * Overpass answers 200 with a "remark" when a query timed out or ran out of
 * memory, and the elements are then incomplete.
 */
export function overpassFailed(answer: unknown) {
  if (!answer || typeof answer !== "object") return true;
  const remark = (answer as { remark?: unknown }).remark;
  return !Array.isArray((answer as { elements?: unknown }).elements) ||
    (typeof remark === "string" && /error/i.test(remark));
}

/** Reads an Overpass answer, failing once it grows past the limit. */
export async function readBoundedJson(response: Response, limitBytes: number): Promise<unknown> {
  const bytes = await readBoundedBytes(response, limitBytes, () => new Error("Response body is too large."));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
