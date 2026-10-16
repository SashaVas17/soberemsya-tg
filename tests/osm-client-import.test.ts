import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compactOverpassElements, fetchOverpassElements } from "../src/osm-import.ts";
import {
  OVERPASS_MAX_ELEMENTS,
  OVERPASS_URLS,
  overpassClientSource,
  overpassQuery,
  parseOsmClientElements,
  venuesFromOverpass,
} from "../supabase/functions/_shared/venues.ts";

const urls = ["https://a.example/api/interpreter", "https://b.example/api/interpreter"];
const cafe = { type: "node", id: 1, lat: 53.9, lon: 27.56, tags: { name: "Кофейня", amenity: "cafe" }, extra: "x" };

function fakeFetch(answers: Array<Response | Error>) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body) });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer!;
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("venue import asked from the administrator's app", () => {
  it("tries the next Overpass server after a failure and sends the query as form data", async () => {
    const { fetcher, calls } = fakeFetch([
      new Response("bad gateway", { status: 502 }),
      Response.json({ elements: [cafe] }),
    ]);
    const elements = await fetchOverpassElements(urls, "[out:json];node(1);out;", fetcher);
    expect(elements).toEqual([{ type: "node", id: 1, lat: 53.9, lon: 27.56, center: undefined, tags: cafe.tags }]);
    expect(calls.map((call) => call.url)).toEqual(urls);
    expect(new URLSearchParams(calls[0].body).get("data")).toBe("[out:json];node(1);out;");
  });

  it("explains what every server answered when all fail", async () => {
    const { fetcher } = fakeFetch([
      new Response("x", { status: 504 }),
      Response.json({ elements: [], remark: "runtime error: timeout" }),
    ]);
    await expect(fetchOverpassElements(urls, "q", fetcher)).rejects.toThrow(
      "OpenStreetMap не ответил (a.example 504, b.example ошибка в ответе). Попробуйте через несколько минут.",
    );
    const offline = fakeFetch([new TypeError("Failed to fetch"), new DOMException("Timed out", "TimeoutError")]);
    await expect(fetchOverpassElements(urls, "q", offline.fetcher)).rejects.toThrow("a.example нет связи, b.example нет ответа");
  });

  it("uploads only the fields the server reads", () => {
    expect(compactOverpassElements([cafe, null, "x"])).toEqual([
      { type: "node", id: 1, lat: 53.9, lon: 27.56, center: undefined, tags: cafe.tags },
    ]);
  });
});

describe("server side of the app-asked import", () => {
  it("gives the app the servers and a query per category of the city", () => {
    const source = overpassClientSource("minsk");
    expect(source?.urls).toEqual([...OVERPASS_URLS]);
    expect(source?.queries.coffee).toBe(overpassQuery("minsk", "coffee"));
    expect(overpassClientSource("nowhere")).toBeNull();
  });

  it("accepts an uploaded answer within the limit and checks every element as before", () => {
    expect(parseOsmClientElements(undefined)).toBeNull();
    expect(parseOsmClientElements([cafe])).toEqual([cafe]);
    expect(() => parseOsmClientElements({ elements: [] })).toThrow("Некорректный ответ OpenStreetMap.");
    expect(() => parseOsmClientElements(new Array(OVERPASS_MAX_ELEMENTS + 1).fill(cafe)))
      .toThrow("Слишком много мест в ответе OpenStreetMap.");
    const items = venuesFromOverpass({ elements: [cafe, { type: "node", id: -1, tags: { name: "x" } }, { type: "bad" }] }, "coffee");
    expect(items.map((item) => item.osm_id)).toEqual([1]);
  });

  it("reads a large body only after the administrator check", () => {
    const api = readFileSync("supabase/functions/telegram-api/index.ts", "utf8");
    const handler = api.slice(api.indexOf("async function adminImportVenues"));
    expect(handler.indexOf("if (!isAdmin(auth)) return adminNotFound();"))
      .toBeLessThan(handler.indexOf("readJsonObject(request, OSM_IMPORT_BODY_LIMIT_BYTES)"));
    expect(handler).toContain("const answer = elements ? { elements } : await fetchOverpass(overpassQuery(city.id, categoryId));");
  });
});
