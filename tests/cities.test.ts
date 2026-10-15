import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adminCity,
  adminCityResponse,
  cityHttpError,
  cityTimeZone,
  citiesFromRows,
  DEFAULT_CITY_ID,
  DEFAULT_TIME_ZONE,
  parseCityActive,
  parseCityId,
  requireActiveCity,
  resolveUserCity,
  userCityResponse,
  type CityRow,
} from "../supabase/functions/_shared/cities";
import { publicDateSummary } from "../supabase/functions/_shared/public-preview";
import { readAppSource } from "./app-source";

const rows: CityRow[] = [
  { id: "brest", name: "Брест", timezone: "Europe/Minsk", is_active: false, sort_order: 20 },
  { id: "minsk", name: "Минск", timezone: "Europe/Minsk", is_active: true, sort_order: 10 },
  { id: "tokyo", name: "Токио", timezone: "Asia/Tokyo", is_active: true, sort_order: 90 },
];
const cities = citiesFromRows(rows);

function status(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return (error as { status?: number }).status;
  }
  return null;
}

describe("cities", () => {
  it("accepts only slug-like city ids", () => {
    expect(parseCityId("minsk")).toBe("minsk");
    expect(parseCityId("nizhny-novgorod")).toBe("nizhny-novgorod");
    for (const value of ["", "Minsk", "1minsk", "a", "minsk;drop", null, 42, "x".repeat(40)])
      expect(status(() => parseCityId(value))).toBe(400);
  });

  it("orders cities and keeps inactive ones for their time zone", () => {
    expect(cities.map((city) => city.id)).toEqual(["minsk", "brest", "tokyo"]);
    expect(cityTimeZone(cities, "tokyo")).toBe("Asia/Tokyo");
    expect(cityTimeZone(cities, "brest")).toBe("Europe/Minsk");
    expect(cityTimeZone(cities, "unknown")).toBe(DEFAULT_TIME_ZONE);
    expect(cityTimeZone(cities, null)).toBe(DEFAULT_TIME_ZONE);
  });

  it("resolves the viewer's city to an active one, Minsk by default", () => {
    expect(resolveUserCity(cities, "tokyo").id).toBe("tokyo");
    expect(resolveUserCity(cities, "brest").id).toBe(DEFAULT_CITY_ID);
    expect(resolveUserCity(cities, null).id).toBe(DEFAULT_CITY_ID);
    expect(resolveUserCity([], null)).toMatchObject({ id: "minsk", timeZone: "Europe/Minsk" });
  });

  it("lets users choose only active cities", () => {
    expect(requireActiveCity(cities, "tokyo").name).toBe("Токио");
    expect(status(() => requireActiveCity(cities, "brest"))).toBe(400);
    expect(status(() => requireActiveCity(cities, "nowhere"))).toBe(400);
    expect(userCityResponse(cities, "brest")).toEqual({
      city: { id: "minsk", name: "Минск" },
      cities: [{ id: "minsk", name: "Минск" }, { id: "tokyo", name: "Токио" }],
    });
  });

  it("formats public meeting dates in the city's time zone", () => {
    const lateEvening = "2026-11-01T22:30:00.000Z";
    expect(publicDateSummary([lateEvening])).toBe("2 ноября");
    expect(publicDateSummary([lateEvening], "America/New_York")).toBe("1 ноября");
  });
});

describe("cities migration", () => {
  const name = readdirSync("supabase/migrations").find((file) => file.endsWith("_cities.sql"));
  const sql = readFileSync(`supabase/migrations/${name}`, "utf8");

  it("locks the cities table away from browser roles", () => {
    expect(sql).toContain("alter table public.cities enable row level security;");
    expect(sql).toContain("revoke all privileges on table public.cities from public, anon, authenticated;");
  });

  it("opens only Minsk and keeps the five regional centres inactive", () => {
    expect(sql).toContain("('minsk', 'Минск', 'Europe/Minsk', true, 10)");
    for (const id of ["brest", "vitebsk", "gomel", "grodno", "mogilev"])
      expect(sql).toMatch(new RegExp(`\\('${id}', '[^']+', 'Europe/Minsk', false, \\d+\\)`));
  });

  it("gives every meeting a city without changing the creation RPCs", () => {
    expect(sql).toContain("update public.events set city_id = 'minsk' where city_id is null;");
    expect(sql).toContain("alter table public.events alter column city_id set not null;");
    expect(sql).toContain("create or replace trigger events_set_city_from_owner");
    // An explicit city wins; only a missing one is filled.
    expect(sql).toContain("if new.city_id is not null then\n    return new;");
    expect(sql).toContain("new.city_id := coalesce(v_city_id, 'minsk');");
    expect(sql).not.toContain("create_event_atomic");
    expect(sql).not.toMatch(/^\s*drop\s/im);
  });

  it("indexes the feed by city", () => {
    expect(sql).toContain("on public.events (city_id, created_at desc, id desc)");
  });
});

describe("cities in the API and the app", () => {
  const backend = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
  const appSource = readAppSource();
  const apiSource = readFileSync("src/api.ts", "utf8");

  it("serves the viewer's city and accepts only active cities", () => {
    expect(backend).toContain('if (path === "/me/city") return ["GET", "PUT"];');
    expect(backend).toContain('if (path === "/me/city") return await userCity(request, auth);');
    expect(backend).toContain("const city = requireActiveCity(cities, cityId);");
  });

  it("filters the open meetings feed by the viewer's city and lists the choices", () => {
    expect(backend).toContain("p_city_id: city.id,");
    expect(backend).toContain("...userCityResponse(cities, city.id),\n    categories,");
    expect(backend).toContain("...cityFields,");
    expect(backend).toContain("timeZone: city.timeZone,");
    expect(backend).not.toContain('searchParams.get("city")');
  });

  it("caches the rarely changing cities list in a warm function", () => {
    expect(backend).toContain("const REFERENCE_DATA_TTL_MS = 60_000;");
    expect(backend).toContain("const loadCities = cachedFor(REFERENCE_DATA_TTL_MS, async () => {");
  });

  it("shows the city in the feed and lets users switch when several are open", () => {
    expect(apiSource).toContain('request<UserCity>("/me/city"');
    expect(appSource).toContain('className="city-chip city-picker"');
    expect(appSource).toContain("cityChoices.length > 1");
    expect(appSource).toContain("await api.userCity(cityId)");
    // A late answer for the previous city never overwrites the new list.
    expect(appSource).toContain("if (requestId !== latestRequest.current) return;");
  });
});

describe("regional centres in «Каталог мест»", () => {
  const cities = citiesFromRows(rows);
  const own = resolveUserCity(cities, null);

  it("lets the administrator pick a closed city and falls back to their own", () => {
    expect(adminCity(cities, "brest", own)).toMatchObject({ id: "brest", isActive: false });
    expect(adminCity(cities, undefined, own).id).toBe("minsk");
    expect(adminCity(cities, "", own).id).toBe("minsk");
    expect(() => adminCity(cities, "gomel", own)).toThrow("Такого города нет.");
    expect(() => adminCity(cities, "../x", own)).toThrow();
    expect(adminCityResponse(cities[1])).toEqual({ id: "brest", name: "Брест", isActive: false });
  });

  it("parses the open-city request and maps database errors", () => {
    expect(parseCityActive({ cityId: "brest", isActive: true })).toEqual({ cityId: "brest", isActive: true });
    expect(() => parseCityActive({ cityId: "brest", isActive: "yes" })).toThrow();
    expect(cityHttpError({ message: "CITY_DEFAULT_REQUIRED" })).toMatchObject({ status: 400 });
    expect(cityHttpError({ message: "CITY_INVALID" })).toMatchObject({ status: 404 });
    expect(cityHttpError(new Error("boom")).message).toBe("Не удалось изменить город.");
  });

  it("keeps Minsk open and lets closed cities get hand-added venues", () => {
    const sql = readFileSync("supabase/migrations/20261015142642_regional_cities.sql", "utf8");
    expect(sql).toContain("p_city_id = 'minsk' and not p_is_active");
    expect(sql).toContain("grant execute on function public.admin_set_city_active(text, boolean) to service_role");
    expect(sql).not.toMatch(/c\.id = p_city_id and c\.is_active/);
  });
});
