import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanText,
  cleanWebsite,
  maxPriceLevelForBudget,
  nextVenueOffset,
  OSM_CATEGORY_FILTERS,
  OVERPASS_MAX_ELEMENTS,
  overpassFailed,
  overpassQuery,
  overpassTruncated,
  parseOsmImportRequest,
  parseVenueCreate,
  parseVenueId,
  parseVenueIds,
  parseVenueListFilters,
  parseVenueUpdate,
  PRICE_LEVELS as SERVER_PRICE_LEVELS,
  readBoundedJson,
  VENUE_PAGE_SIZE,
  venueHttpError,
  venueResponse,
  venuesFromOverpass,
  type VenueRow,
} from "../supabase/functions/_shared/venues";
import { mockApi } from "../src/mock-api";
import {
  adminVenuesPath,
  clearVenueForNextMeeting,
  isVenueAdded,
  needsOsmAttribution,
  PRICE_LEVELS,
  priceLabel,
  startMeetingAtVenue,
  venueForNextMeeting,
  venuePlaceDraft,
  venuesPath,
} from "../src/venues";
import type { Venue } from "../src/types";
import { readAppSource } from "./app-source";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migrationName = readdirSync("supabase/migrations").find((name) => name.endsWith("_venues.sql"));
const migration = migrationName ? read(`supabase/migrations/${migrationName}`) : "";
const apiSource = read("supabase/functions/telegram-api/index.ts");

function status(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return (error as { status?: number }).status;
  }
  return null;
}

const venue: Venue = {
  id: "venue_1",
  categoryId: "coffee",
  name: "Кофейня",
  address: "улица Немига, 5",
  latitude: 53.9,
  longitude: 27.55,
  priceLevel: 2,
  website: null,
  openingHours: null,
  source: "osm",
  osmUrl: "https://www.openstreetmap.org/node/1",
  featured: false,
};

describe("venue list input", () => {
  it("maps a meeting budget to the price levels that fit it", () => {
    expect(maxPriceLevelForBudget(0)).toBe(1);
    expect(maxPriceLevelForBudget(19)).toBe(1);
    expect(maxPriceLevelForBudget(20)).toBe(2);
    expect(maxPriceLevelForBudget(49)).toBe(2);
    expect(maxPriceLevelForBudget(50)).toBe(3);
    expect(maxPriceLevelForBudget(1000)).toBe(3);
  });

  it("keeps the app price levels in step with the server", () => {
    expect(PRICE_LEVELS.map(({ level, from }) => ({ level, from }))).toEqual(
      SERVER_PRICE_LEVELS.map(({ level, from }) => ({ level, from })),
    );
    expect(priceLabel(null)).toBeNull();
    expect(priceLabel(3)).toBe("от 50 BYN");
  });

  it("parses filters and rejects malformed ones", () => {
    expect(parseVenueListFilters(new URLSearchParams("category=bar&q=  паб  &budget=30&offset=30"))).toEqual({
      categoryId: "bar",
      search: "паб",
      maxPriceLevel: 2,
      offset: 30,
    });
    expect(parseVenueListFilters(new URLSearchParams(""))).toEqual({
      categoryId: null,
      search: null,
      maxPriceLevel: null,
      offset: 0,
    });
    for (const query of ["budget=-1", "budget=1e3", "offset=1001", "offset=-5", "category=Bar", "q=" + "x".repeat(81)])
      expect(status(() => parseVenueListFilters(new URLSearchParams(query)))).toBe(400);
  });

  it("pages by one extra row and stops at the offset limit", () => {
    expect(nextVenueOffset(0, VENUE_PAGE_SIZE + 1)).toBe(VENUE_PAGE_SIZE);
    expect(nextVenueOffset(0, VENUE_PAGE_SIZE)).toBeNull();
    expect(nextVenueOffset(990, VENUE_PAGE_SIZE + 1)).toBeNull();
  });
});

describe("venue curation input", () => {
  it("accepts a full update and rejects partial or invalid ones", () => {
    expect(parseVenueUpdate({ status: "published", categoryId: "bar", priceLevel: 2, featured: true })).toEqual({
      status: "published",
      categoryId: "bar",
      priceLevel: 2,
      featured: true,
    });
    expect(parseVenueUpdate({ status: "hidden", categoryId: "bar", priceLevel: null, featured: false }).priceLevel).toBeNull();
    for (const body of [
      { status: "deleted", categoryId: "bar", priceLevel: 1, featured: false },
      { status: "published", categoryId: null, priceLevel: 1, featured: false },
      { status: "published", categoryId: "bar", priceLevel: 4, featured: false },
      { status: "published", categoryId: "bar", priceLevel: "2", featured: false },
      { status: "published", categoryId: "bar", priceLevel: 1 },
    ])
      expect(status(() => parseVenueUpdate(body))).toBe(400);
  });

  it("cleans a hand-added venue", () => {
    expect(parseVenueCreate({ categoryId: "food", name: "  Ресторан\n«Х» ", address: " ул. Y, 1 ", priceLevel: 3, website: "example.by" })).toEqual({
      categoryId: "food",
      name: "Ресторан «Х»",
      address: "ул. Y, 1",
      priceLevel: 3,
      website: "https://example.by/",
    });
    expect(parseVenueCreate({ categoryId: "food", name: "X", website: "" }).website).toBeNull();
    expect(status(() => parseVenueCreate({ categoryId: "food", name: "  " }))).toBe(400);
    expect(status(() => parseVenueCreate({ categoryId: "food", name: "x".repeat(121) }))).toBe(400);
    expect(status(() => parseVenueCreate({ categoryId: "food", name: "X", website: "javascript:alert(1)" }))).toBe(400);
  });

  it("accepts only uuids as venue ids", () => {
    const id = "6f1c1e1a-1111-4222-8333-444455556666";
    expect(parseVenueId(id.toUpperCase())).toBe(id);
    expect(status(() => parseVenueId("venue_1"))).toBe(404);
    expect(parseVenueIds({ ids: [id, id] })).toEqual([id]);
    expect(status(() => parseVenueIds({ ids: [] }))).toBe(400);
    expect(status(() => parseVenueIds({ ids: ["x"] }))).toBe(400);
    expect(status(() => parseVenueIds({ ids: Array.from({ length: 201 }, () => id) }))).toBe(400);
  });

  it("maps database tokens to safe messages", () => {
    expect(venueHttpError({ code: "P0001", message: "VENUE_NOT_FOUND" })).toMatchObject({ status: 404 });
    expect(venueHttpError({ code: "P0001", message: "VENUE_CATEGORY_INVALID" })).toMatchObject({ status: 400 });
    expect((venueHttpError({ code: "23514", message: "secret detail" }) as Error).message).toBe("Не удалось выполнить действие.");
  });
});

describe("OpenStreetMap import", () => {
  it("builds one bounded Overpass query per category of a configured city", () => {
    const query = overpassQuery("minsk", "bar");
    expect(query).toContain("[out:json]");
    expect(query).toContain('nwr["amenity"~"^(bar|pub|biergarten|nightclub)$"]["name"](53.8,27.37,53.99,27.76);');
    expect(query).toMatch(/out center tags \d+;$/);
    expect(OSM_CATEGORY_FILTERS.other).toBeUndefined();
    expect(status(() => parseOsmImportRequest({ categoryId: "other" }, "minsk"))).toBe(400);
    expect(status(() => parseOsmImportRequest({ categoryId: "bar" }, "brest"))).toBe(400);
    expect(parseOsmImportRequest({ categoryId: "bar" }, "minsk")).toEqual({ categoryId: "bar" });
  });

  it("turns elements into clean import rows and skips unusable ones", () => {
    const items = venuesFromOverpass({
      elements: [
        { type: "node", id: 1, lat: 53.9, lon: 27.55, tags: { name: "Cafe", "name:ru": "Кафе", "addr:street": "улица Немига", "addr:housenumber": "5", website: "cafe.by;other.by", opening_hours: "Mo-Su 08:00-22:00" } },
        { type: "node", id: 1, lat: 53.9, lon: 27.55, tags: { name: "Дубль" } },
        { type: "way", id: 2, center: { lat: 53.91, lon: 27.56 }, tags: { name: "Парк\u0007  Горького", "contact:website": "http://park.by" } },
        { type: "relation", id: 3, tags: { name: "Без центра" } },
        { type: "node", id: 4, lat: 53.9, lon: 27.5, tags: { amenity: "cafe" } },
        { type: "area", id: 5, tags: { name: "Не тот тип" } },
        { type: "node", id: -6, tags: { name: "Плохой id" } },
        { type: "node", id: 7, lat: 200, lon: 27.5, tags: { name: "Плохие координаты", website: "javascript:alert(1)" } },
        null,
      ],
    }, "coffee");
    expect(items).toEqual([
      { osm_type: "node", osm_id: 1, category_id: "coffee", name: "Кафе", address: "улица Немига, 5", latitude: 53.9, longitude: 27.55, website: "https://cafe.by/", opening_hours: "Mo-Su 08:00-22:00" },
      { osm_type: "way", osm_id: 2, category_id: "coffee", name: "Парк Горького", address: "", latitude: 53.91, longitude: 27.56, website: "http://park.by/", opening_hours: null },
      { osm_type: "relation", osm_id: 3, category_id: "coffee", name: "Без центра", address: "", latitude: null, longitude: null, website: null, opening_hours: null },
      { osm_type: "node", osm_id: 7, category_id: "coffee", name: "Плохие координаты", address: "", latitude: null, longitude: null, website: null, opening_hours: null },
    ]);
    expect(venuesFromOverpass({}, "coffee")).toEqual([]);
  });

  it("keeps imported text within the table limits", () => {
    expect([...cleanText("я".repeat(500), 120)]).toHaveLength(120);
    expect(cleanWebsite("https://" + "a".repeat(300) + ".by")).toBeNull();
    expect(cleanWebsite("https://user:pass@example.by")).toBeNull();
    expect(cleanWebsite("ftp://example.by")).toBeNull();
    const [item] = venuesFromOverpass({ elements: [{ type: "node", id: 9, lat: 1, lon: 1, tags: { name: "X", opening_hours: "y".repeat(300), "addr:street": "s".repeat(300), "addr:housenumber": "1" } }] }, "bar");
    expect([...item.opening_hours ?? ""]).toHaveLength(200);
    expect([...item.address].length).toBeLessThanOrEqual(200);
  });

  it("reports an answer that reached the Overpass output limit", () => {
    expect(overpassTruncated({ elements: Array.from({ length: OVERPASS_MAX_ELEMENTS }) })).toBe(true);
    expect(overpassTruncated({ elements: [] })).toBe(false);
    expect(overpassQuery("minsk", "coffee")).toContain(`out center tags ${OVERPASS_MAX_ELEMENTS};`);
    expect(apiSource).toContain("truncated: overpassTruncated(answer)");
  });

  it("treats Overpass remarks about errors as a failed answer", () => {
    expect(overpassFailed({ elements: [] })).toBe(false);
    expect(overpassFailed({ elements: [], remark: "runtime error: Query timed out" })).toBe(true);
    expect(overpassFailed({ remark: "x" })).toBe(true);
    expect(overpassFailed(null)).toBe(true);
  });

  it("stops reading an answer past the size limit", async () => {
    await expect(readBoundedJson(new Response('{"elements":[]}'), 100)).resolves.toEqual({ elements: [] });
    await expect(readBoundedJson(new Response("x".repeat(200)), 100)).rejects.toThrow("too large");
    await expect(readBoundedJson(new Response("{}", { headers: { "content-length": "999" } }), 100)).rejects.toThrow("too large");
  });

  it("links imported venues to OpenStreetMap", () => {
    const row: VenueRow = {
      id: "v", category_id: "bar", name: "X", address: "", latitude: null, longitude: null, price_level: null,
      website: null, opening_hours: null, source: "osm", osm_type: "way", osm_id: 42, status: "published", featured: false,
    };
    expect(venueResponse(row).osmUrl).toBe("https://www.openstreetmap.org/way/42");
    expect(venueResponse(row)).not.toHaveProperty("status");
    expect(venueResponse({ ...row, source: "manual", osm_type: null, osm_id: null }).osmUrl).toBeNull();
  });
});

describe("venues migration", () => {
  it("exists and adds the restaurant category", () => {
    expect(migrationName).toBeTruthy();
    expect(migration).toContain("('food', 'Ресторан', 15)");
  });

  it("closes the table to the browser and lets only the service role read it", () => {
    expect(migration).toContain("alter table public.venues enable row level security;");
    expect(migration).toContain("revoke all privileges on table public.venues from public, anon, authenticated;");
    expect(migration).toContain("grant select on table public.venues to service_role;");
    expect(migration).not.toMatch(/grant (insert|update|delete)[^;]*venues/i);
  });

  it("runs every RPC as security definer with a fixed search path, for the service role only", () => {
    const functions = [...migration.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((match) => match[1]);
    expect(functions).toEqual(["admin_import_venues", "admin_create_venue", "admin_update_venue", "admin_publish_venues"]);
    expect(migration.match(/security definer set search_path = pg_catalog, public/g)).toHaveLength(functions.length);
    for (const name of functions) {
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
    }
  });

  it("lets a venue of a deactivated category be hidden without moving it", () => {
    const start = migration.indexOf("create or replace function public.admin_update_venue(");
    const body = migration.slice(start, migration.indexOf("$$;", start));
    expect(body).toContain("v.id = p_venue_id and v.category_id = p_category_id");
  });

  it("keeps curated fields on re-import and never deletes venues", () => {
    const conflict = migration.slice(migration.indexOf("on conflict on constraint venues_osm_key"), migration.indexOf("returning (v.xmax = 0)"));
    expect(conflict).not.toMatch(/\b(status|category_id|price_level|featured)\s*=/);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).not.toMatch(/^\s*drop\s/im);
  });
});

describe("venue routes", () => {
  it("serves the catalogue to everyone and curation to administrators only", () => {
    expect(apiSource).toContain('if (path === "/venues" || path === "/map") return ["GET"];');
    expect(apiSource).toContain('if (path === "/admin/venues") return ["GET", "POST"];');
    expect(apiSource).toContain('if (/^\\/admin\\/venues\\/[^/]+$/.test(path)) return ["PATCH"];');
    for (const handler of ["adminVenues", "adminUpdateVenue", "adminPublishVenues", "adminImportVenues"]) {
      const start = apiSource.indexOf(`async function ${handler}(`);
      expect(start).toBeGreaterThan(0);
      expect(apiSource.slice(start, start + 400)).toContain("if (!isAdmin(auth)) return adminNotFound();");
    }
    // People see published venues of active categories, curated picks first;
    // the curation list keeps a stable name order for paging.
    expect(apiSource).toMatch(/status: "published",\s+filters,\s+categoryIds: categories\.map\(\(category\) => category\.id\),\s+featuredFirst: true,/);
    expect(apiSource).toContain("venueRows({ cityId: city.id, status, filters, featuredFirst: false })");
    // An import into a deactivated category is refused before calling Overpass.
    const importStart = apiSource.indexOf("async function adminImportVenues(");
    const importBody = apiSource.slice(importStart, apiSource.indexOf("function apiPath(", importStart));
    expect(importBody.indexOf("categoryById(categories, categoryId)")).toBeLessThan(importBody.indexOf("fetchOverpass("));
  });
});

describe("venues in the app", () => {
  afterEach(() => clearVenueForNextMeeting());

  it("builds list paths with only the filters that are set", () => {
    expect(venuesPath()).toBe("/venues");
    expect(venuesPath({ category: "bar", q: "  паб  ", budget: 30 }, 30)).toBe("/venues?category=bar&q=%D0%BF%D0%B0%D0%B1&budget=30&offset=30");
    expect(venuesPath({ budget: 0 })).toBe("/venues");
    expect(adminVenuesPath("pending")).toBe("/admin/venues?status=pending");
  });

  it("turns a venue into a place option", () => {
    expect(venuePlaceDraft(venue, "40")).toEqual({ title: "Кофейня", area: "улица Немига, 5", estimatedBudget: "35", venueId: "venue_1" });
    expect(venuePlaceDraft({ ...venue, priceLevel: null }, "30").estimatedBudget).toBe("30");
    // Never above the meeting budget the venue was picked for, never below the level.
    expect(venuePlaceDraft(venue, "20").estimatedBudget).toBe("20");
    expect(venuePlaceDraft({ ...venue, priceLevel: 3 }, "50").estimatedBudget).toBe("50");
    expect(venuePlaceDraft({ ...venue, priceLevel: 1 }, "10").estimatedBudget).toBe("10");
    expect(venuePlaceDraft({ ...venue, priceLevel: 3 }, "0").estimatedBudget).toBe("60");
    expect(isVenueAdded(venue, [{ title: " кофейня ", area: "Улица Немига, 5" }])).toBe(true);
    // Another branch of the same chain is a different venue.
    expect(isVenueAdded(venue, [{ title: "Кофейня", area: "проспект Победителей, 1" }])).toBe(false);
    expect(isVenueAdded(venue, [{ title: "Другое", area: "улица Немига, 5" }])).toBe(false);
  });

  it("hands a venue to the next creation wizard once", () => {
    expect(venueForNextMeeting()).toBeNull();
    startMeetingAtVenue(venue);
    expect(venueForNextMeeting()).toBe(venue);
    clearVenueForNextMeeting();
    expect(venueForNextMeeting()).toBeNull();
  });

  it("shows the OSM attribution only next to imported venues", () => {
    expect(needsOsmAttribution([venue])).toBe(true);
    expect(needsOsmAttribution([{ source: "manual" }])).toBe(false);
    expect(read("src/ui/Venues.tsx")).toContain("© участники OpenStreetMap");
  });

  it("lists published mock venues by category and budget", async () => {
    const all = await mockApi.venues();
    expect(all.items.length).toBeGreaterThan(0);
    expect(all.items[0].featured).toBe(true);
    expect(all.items.every((item) => !("status" in item))).toBe(true);
    const cheap = await mockApi.venues({ budget: 10 });
    expect(cheap.items.every((item) => item.priceLevel === null || item.priceLevel === 1)).toBe(true);
    expect((await mockApi.venues({ category: "walk" })).items.map((item) => item.name)).toEqual(["Парк Горького"]);
  });

  it("routes the places tab and the admin catalogue", () => {
    const app = readAppSource();
    expect(app).toContain('path === "/places"');
    expect(app).toContain('path === "/admin/venues" && auth.isAdmin');
    const wizard = read("src/screens/CreateEvent.tsx");
    expect(wizard).toContain("<VenuePicker");
    expect(wizard).toContain("useEffect(() => clearVenueForNextMeeting(), [])");
  });
});
