import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventCreationRequestHash } from "../supabase/functions/_shared/event-creation";
import { cityMapBounds, mapPointsFromRpc, optionalVenueId } from "../supabase/functions/_shared/venues";
import { createEventPayload, type CreateWizardDraft } from "../src/create-wizard";
import { initialMapBounds, mapMeetingTime, mapStyleFor, MAP_STYLE_DARK, MAP_STYLE_LIGHT, meetingFeatures, venueFeatures } from "../src/map";
import { mockApi } from "../src/mock-api";
import { holdVerticalSwipes } from "../src/telegram";
import { venuePlaceDraft } from "../src/venues";
import type { Venue } from "../src/types";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migrationName = readdirSync("supabase/migrations").find((name) => name.endsWith("_map.sql"));
const migration = migrationName ? read(`supabase/migrations/${migrationName}`) : "";
const apiSource = read("supabase/functions/telegram-api/index.ts");
const functionBody = (name: string) => {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  return start < 0 ? "" : migration.slice(start, migration.indexOf("$$;", start));
};

describe("map migration", () => {
  it("links place options to venues without failing creation", () => {
    expect(migration).toContain("add column if not exists venue_id uuid references public.venues(id) on delete set null");
    const link = functionBody("link_place_venues");
    // Only a published venue of the meeting's own city, only this meeting's places.
    expect(link).toContain("v.status = 'published'");
    expect(link).toContain("v.city_id = e.city_id");
    expect(link).toContain("po.event_id = p_event_id");
    // A non-object argument links nothing instead of raising.
    expect(link).toContain("case when jsonb_typeof(p_place_venues) = 'object' then p_place_venues else '{}'::jsonb end");
    expect(link).not.toMatch(/\braise\b/);
  });

  it("creates through the categorized wrappers, linking only on a first create", () => {
    expect(functionBody("create_event_with_venues")).toContain("public.create_event_categorized(");
    const idempotent = functionBody("create_event_idempotent_with_venues");
    expect(idempotent).toContain("public.create_event_idempotent_categorized(");
    expect(idempotent).toMatch(/if not v_replayed then\s+perform public\.link_place_venues/);
  });

  it("shows on the map only the meetings the feed would show", () => {
    const points = functionBody("public_map_points");
    for (const rule of [
      "e.visibility = 'public'",
      "e.deleted_at is null",
      "e.hidden_at is null",
      "e.status = 'collecting'",
      "b.blocker_user_id = p_viewer_user_id and b.blocked_user_id = e.owner_user_id",
      "b.blocker_user_id = e.owner_user_id and b.blocked_user_id = p_viewer_user_id",
    ])
      expect(points).toContain(rule);
    expect(points).toContain("v.status = 'published'");
    // Meetings of a deactivated category are left out, like its venues.
    expect(points).toContain("(e.category_id is null or e.category_id = any(p_category_ids))");
    // Starts from linked places, not from every open meeting of the city.
    expect(points).toContain("e.id in (select po.event_id from public.place_options po where po.venue_id is not null)");
    expect(points).toContain("v.category_id = any(p_category_ids)");
    expect(points).toMatch(/limit 3000/);
    expect(points).toMatch(/limit 500/);
  });

  it("runs as security definer for the service role only, without destructive commands", () => {
    const functions = [...migration.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((match) => match[1]);
    expect(functions).toEqual(["link_place_venues", "create_event_with_venues", "create_event_idempotent_with_venues", "public_map_points"]);
    expect(migration.match(/security definer set search_path = pg_catalog, public/g)).toHaveLength(functions.length);
    for (const name of functions)
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
    expect(migration).not.toMatch(/grant execute on function public\.link_place_venues/);
    expect(migration).not.toMatch(/^\s*drop\s/im);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });
});

describe("map API", () => {
  it("routes the map and a single venue", () => {
    expect(apiSource).toContain('if (path === "/venues" || path === "/map") return ["GET"];');
    expect(apiSource).toContain('if (/^\\/venues\\/[^/]+$/.test(path)) return ["GET"];');
    const venueStart = apiSource.indexOf("async function venueById(");
    expect(apiSource.slice(venueStart, venueStart + 400)).toContain('.eq("status", "published")');
  });

  it("uses the venue-linking RPCs only when a place comes from the catalogue", () => {
    expect(apiSource).toContain('? clientRequestId ? "create_event_idempotent_with_venues" : "create_event_with_venues"');
    expect(apiSource).toContain(': clientRequestId ? "create_event_idempotent_categorized" : "create_event_categorized"');
    // The venue id never reaches create_event_atomic's strict place check.
    expect(apiSource).toContain("p_place_options: places.map(({ venueId: _venueId, ...place }) => place)");
  });

  it("keeps the request hash of creations without catalogue places", async () => {
    const base = {
      title: "X", description: "", budgetLimit: 10, visibility: "private", maxParticipants: null,
      startsAt: ["2030-01-01T10:00:00.000Z"], places: [{ title: "Кафе", area: "", estimatedBudget: 10 }],
    };
    const plain = await eventCreationRequestHash(base);
    expect(await eventCreationRequestHash({ ...base, places: [{ ...base.places[0], venueId: null }] })).toBe(plain);
    expect(await eventCreationRequestHash({ ...base, places: [{ ...base.places[0], venueId: "a" }] })).not.toBe(plain);
  });

  it("accepts only uuids as place venue ids", () => {
    expect(optionalVenueId("6F1C1E1A-1111-4222-8333-444455556666")).toBe("6f1c1e1a-1111-4222-8333-444455556666");
    for (const value of ["venue_1", "", null, 7, "6f1c1e1a-1111-4222-8333-44445555666"]) expect(optionalVenueId(value)).toBeNull();
  });

  it("keeps only well-formed map points", () => {
    expect(mapPointsFromRpc({
      venues: [["v1", 53.9, 27.5, "bar", true], ["v2", "53.9", 27.5, "bar", false], ["v3", 53.9, 27.5, "bar"]],
      meetings: [
        { id: "e1", title: "T", categoryId: null, latitude: 53.9, longitude: 27.5, venueName: "Бар", startsAt: null },
        { id: "e2", title: "T", latitude: "x", longitude: 27.5 },
      ],
    })).toEqual({
      venues: [["v1", 53.9, 27.5, "bar", true]],
      meetings: [{ id: "e1", title: "T", categoryId: null, latitude: 53.9, longitude: 27.5, venueName: "Бар", startsAt: null }],
    });
    expect(mapPointsFromRpc(null)).toEqual({ venues: [], meetings: [] });
    expect(cityMapBounds("minsk")).toEqual({ south: 53.8, west: 27.37, north: 53.99, east: 27.76 });
    expect(cityMapBounds("brest")).toEqual(cityMapBounds("minsk"));
  });
});

const venue: Venue = {
  id: "6f1c1e1a-1111-4222-8333-444455556666", categoryId: "bar", name: "Бар", address: "ул. 1",
  latitude: 53.9, longitude: 27.5, priceLevel: null, website: null, openingHours: null,
  source: "osm", osmUrl: null, featured: false,
};

describe("catalogue places in the wizard", () => {
  const draft = (places: CreateWizardDraft["places"]): CreateWizardDraft => ({
    title: "X", description: "", budgetLimit: 10, visibility: "public", maxParticipants: null,
    timeOptions: ["2030-01-01T10:00:00.000Z"], places,
  });

  it("sends a venue id only for a place picked from the catalogue", () => {
    const picked = venuePlaceDraft(venue, "30");
    expect(picked.venueId).toBe(venue.id);
    const payload = createEventPayload(draft([
      { ...picked, estimatedBudget: 30 },
      { title: "Своё", area: "", estimatedBudget: 10 },
      { title: "Изменённое", area: "", estimatedBudget: 10, venueId: undefined },
    ]));
    expect(payload.placeOptions).toEqual([
      { title: "Бар", area: "ул. 1", estimatedBudget: 30, venueId: venue.id },
      { title: "Своё", area: "", estimatedBudget: 10 },
      { title: "Изменённое", area: "", estimatedBudget: 10 },
    ]);
  });

  it("drops the link when the organizer edits the name or the address", () => {
    const wizard = read("src/screens/CreateEvent.tsx");
    expect(wizard).toContain("{ ...item, title: event.target.value, venueId: undefined }");
    expect(wizard).toContain("{ ...item, area: event.target.value, venueId: undefined }");
  });
});

describe("map in the app", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds GeoJSON with longitude first", () => {
    expect(venueFeatures([["v1", 53.9, 27.5, "bar", true]]).features[0]).toEqual({
      type: "Feature",
      geometry: { type: "Point", coordinates: [27.5, 53.9] },
      properties: { id: "v1", categoryId: "bar", featured: true },
    });
    expect(meetingFeatures([{ id: "e1", title: "T", categoryId: null, latitude: 53.9, longitude: 27.5, venueName: "", startsAt: null }])
      .features[0].geometry.coordinates).toEqual([27.5, 53.9]);
  });

  it("opens on the points, or on the city when there are none", () => {
    const bounds = { south: 53.8, west: 27.37, north: 53.99, east: 27.76 };
    expect(initialMapBounds({ venues: [], meetings: [], bounds })).toEqual([[27.37, 53.8], [27.76, 53.99]]);
    expect(initialMapBounds({
      venues: [["v1", 53.9, 27.5, "bar", false], ["v2", 53.95, 27.6, "bar", false]],
      meetings: [{ id: "e1", title: "T", categoryId: null, latitude: 53.85, longitude: 27.55, venueName: "", startsAt: null }],
      bounds,
    })).toEqual([[27.5, 53.85], [27.6, 53.95]]);
  });

  it("follows the app theme and shows times in Minsk", () => {
    expect(mapStyleFor("dark")).toBe(MAP_STYLE_DARK);
    expect(mapStyleFor("light")).toBe(MAP_STYLE_LIGHT);
    expect(mapStyleFor(undefined)).toBe(MAP_STYLE_LIGHT);
    expect(mapMeetingTime("2030-06-01T15:00:00Z")).toMatch(/1 июня.*18:00/);
    expect(mapMeetingTime(null)).toBe("");
    expect(mapMeetingTime("nope")).toBe("");
  });

  it("holds Telegram's swipe-to-close while the map is open, on clients that support it", () => {
    const disable = vi.fn();
    const enable = vi.fn();
    vi.stubGlobal("window", {
      Telegram: { WebApp: { disableVerticalSwipes: disable, enableVerticalSwipes: enable, isVersionAtLeast: (v: string) => v <= "7.7" } },
    });
    const release = holdVerticalSwipes();
    expect(disable).toHaveBeenCalledOnce();
    release();
    expect(enable).toHaveBeenCalledOnce();
    vi.stubGlobal("window", { Telegram: { WebApp: { disableVerticalSwipes: disable, isVersionAtLeast: () => false } } });
    holdVerticalSwipes()();
    expect(disable).toHaveBeenCalledOnce();
  });

  it("survives style switches and opens only the meeting under a tap", () => {
    const map = read("src/ui/VenueMap.tsx");
    // A diffed setStyle would drop the point layers without firing style.load.
    expect(map.match(/setStyle\(.*\{ diff: false \}\);/g)).toHaveLength(2);
    expect(map).not.toContain("isStyleLoaded()");
    // One click handler: meetings first, so the venue under them is not opened too.
    expect(map.match(/instance\.on\("click"/g)).toHaveLength(1);
    expect(map).toContain('["meeting-points", "venue-points", "venue-clusters"]');
    const places = read("src/screens/PlacesScreen.tsx");
    expect(places).toContain("class MapChunkBoundary extends Component");
    expect(places).toContain('if (view === "list") void load();');
  });

  it("loads maplibre only with the map and bundles its worker", () => {
    const places = read("src/screens/PlacesScreen.tsx");
    expect(places).toContain('lazy(() => import("../ui/VenueMap"))');
    expect(places).not.toMatch(/from "maplibre-gl"/);
    const map = read("src/ui/VenueMap.tsx");
    expect(map).toContain('import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";');
    expect(map).toContain("setWorkerUrl(mapWorkerUrl);");
    expect(map).toContain("useEffect(() => holdVerticalSwipes(), []);");
    expect(read("vite.config.ts")).toContain('worker: { format: "es" }');
  });

  it("serves mock map points with the demo meeting at a venue", async () => {
    const points = await mockApi.mapPoints();
    expect(points.venues.length).toBeGreaterThan(0);
    expect(points.venues.every(([, latitude, longitude]) => Number.isFinite(latitude) && Number.isFinite(longitude))).toBe(true);
    expect(points.meetings).toHaveLength(1);
    expect((await mockApi.mapPoints("walk")).meetings).toEqual([]);
    expect((await mockApi.venue("venue_1")).venue.name).toBe("Кофейня на Немиге");
  });
});
